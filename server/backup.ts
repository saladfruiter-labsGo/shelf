import { readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import { db, dataDir } from './db.js'
import {
  writeVerifiedDatabaseBackup,
  type BackupReason,
  type DatabaseBackupInfo,
} from './database-backup.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const BACKUP_PATTERN = /^shelf-(automatic|before-import|before-migration|manual)-.+\.db$/

export const backupDir = path.resolve(process.env.BACKUP_DIR ?? path.join(dataDir, 'backups'))

function intSetting(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

const intervalHours = intSetting('BACKUP_INTERVAL_HOURS', 24, 1, 168)
const dailyDays = intSetting('BACKUP_RETENTION_DAYS', 14, 1, 365)
const weeklyWeeks = intSetting('BACKUP_RETENTION_WEEKLY', 8, 0, 104)
const safetyCopies = intSetting('BACKUP_RETENTION_SAFETY', 5, 1, 50)

interface StoredBackup extends DatabaseBackupInfo {
  mtime_ms: number
}

let running: Promise<DatabaseBackupInfo> | null = null
let lastError: { at: string; message: string } | null = null

async function storedBackups(): Promise<StoredBackup[]> {
  const names = await readdir(backupDir).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
  const rows: StoredBackup[] = []
  for (const filename of names) {
    const match = filename.match(BACKUP_PATTERN)
    if (!match) continue
    const filePath = path.resolve(backupDir, filename)
    // Não segue nomes que escapem do diretório configurado.
    if (path.dirname(filePath) !== backupDir) continue
    const file = await stat(filePath)
    if (!file.isFile()) continue
    rows.push({
      filename,
      path: filePath,
      reason: match[1] as BackupReason,
      created_at: file.mtime.toISOString(),
      size_bytes: file.size,
      mtime_ms: file.mtimeMs,
    })
  }
  return rows.sort((a, b) => b.mtime_ms - a.mtime_ms)
}

function isoWeekKey(date: Date): string {
  const utc = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()))
  utc.setUTCDate(utc.getUTCDate() + 4 - (utc.getUTCDay() || 7))
  const yearStart = new Date(Date.UTC(utc.getUTCFullYear(), 0, 1))
  const week = Math.ceil((((utc.getTime() - yearStart.getTime()) / DAY_MS) + 1) / 7)
  return `${utc.getUTCFullYear()}-${String(week).padStart(2, '0')}`
}

/** Mantém os diários recentes, uma cópia semanal antiga e poucos snapshots de segurança. */
export async function pruneBackups(now = new Date()): Promise<void> {
  const files = await storedBackups()
  const keep = new Set<string>()
  const recentCutoff = now.getTime() - dailyDays * DAY_MS

  const automatic = files.filter(f => f.reason === 'automatic')
  for (const file of automatic) if (file.mtime_ms >= recentCutoff) keep.add(file.path)

  const weeks = new Set<string>()
  for (const file of automatic) {
    const key = isoWeekKey(new Date(file.mtime_ms))
    if (weeks.has(key) || weeks.size >= weeklyWeeks) continue
    weeks.add(key)
    keep.add(file.path)
  }

  for (const reason of ['before-import', 'before-migration', 'manual'] as const) {
    files.filter(f => f.reason === reason).slice(0, safetyCopies).forEach(f => keep.add(f.path))
  }

  for (const file of files) {
    if (!keep.has(file.path)) await unlink(file.path)
  }
}

export async function createDatabaseBackup(reason: BackupReason): Promise<DatabaseBackupInfo> {
  if (running) return running
  running = (async () => {
    try {
      const info = await writeVerifiedDatabaseBackup(db, backupDir, reason)
      await pruneBackups()
      lastError = null
      return info
    } catch (error) {
      lastError = { at: new Date().toISOString(), message: (error as Error).message }
      throw error
    } finally {
      running = null
    }
  })()
  return running
}

export async function backupStatus() {
  const files = await storedBackups()
  return {
    enabled: process.env.BACKUP_ENABLED !== '0',
    directory: backupDir,
    interval_hours: intervalHours,
    retention: { daily_days: dailyDays, weekly_weeks: weeklyWeeks, safety_copies: safetyCopies },
    latest: files[0] ?? null,
    count: files.length,
    running: running != null,
    last_error: lastError,
  }
}

/** Inicia depois do servidor; se já existe cópia recente, espera o próximo ciclo. */
export function startBackupScheduler(): void {
  if (process.env.BACKUP_ENABLED === '0') return

  const intervalMs = intervalHours * HOUR_MS
  const tick = async () => {
    try {
      const latest = (await storedBackups()).find(f => f.reason === 'automatic')
      if (!latest || Date.now() - latest.mtime_ms >= intervalMs) {
        const info = await createDatabaseBackup('automatic')
        console.log(`[backup] snapshot verificado: ${info.filename}`)
      }
    } catch (error) {
      console.error(`[backup] falha: ${(error as Error).message}`)
    } finally {
      const timer = setTimeout(tick, intervalMs)
      timer.unref()
    }
  }

  const first = setTimeout(tick, 10_000)
  first.unref()
}
