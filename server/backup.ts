import { readdir, stat, unlink } from 'node:fs/promises'
import path from 'node:path'
import type Database from 'better-sqlite3'
import { coreDb } from './core-db.js'
import { backupRoot, currentUserId, db, instanceHasUsers, personalDatabases } from './db.js'
import {
  writeVerifiedDatabaseBackup,
  type BackupReason,
  type DatabaseBackupInfo,
} from './database-backup.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS
const BACKUP_PATTERN = /^shelf-(automatic|before-import|before-migration|manual)-.+\.db$/

/** Raiz dos backups: o banco do dono fica aqui; cada conta e o núcleo têm subpasta. */
export const backupDir = backupRoot
const coreBackupDir = path.join(backupRoot, 'core')

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

const running = new Map<string, Promise<DatabaseBackupInfo>>()
let lastError: { at: string; message: string } | null = null
let schedulerEnabled = false
let schedulerTimer: NodeJS.Timeout | null = null

async function storedBackups(dir = backupDir): Promise<StoredBackup[]> {
  const names = await readdir(dir).catch(error => {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw error
  })
  const rows: StoredBackup[] = []
  for (const filename of names) {
    const match = filename.match(BACKUP_PATTERN)
    if (!match) continue
    const filePath = path.resolve(dir, filename)
    // Não segue nomes que escapem do diretório configurado.
    if (path.dirname(filePath) !== path.resolve(dir)) continue
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
export async function pruneBackups(now = new Date(), dir = backupDir): Promise<void> {
  const files = await storedBackups(dir)
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

/** O banco pessoal de quem está no contexto e a pasta onde os backups dele moram. */
function currentTarget(): { conn: Database.Database; dir: string } {
  const userId = currentUserId()
  if (userId == null || !instanceHasUsers()) return { conn: db, dir: backupDir }
  const target = personalDatabases().find(entry => entry.userId === userId)
  if (!target) throw new Error('Banco pessoal não encontrado')
  return { conn: target.conn, dir: target.backupDir }
}

async function backupInto(conn: Database.Database, dir: string, reason: BackupReason): Promise<DatabaseBackupInfo> {
  const pending = running.get(dir)
  if (pending) return pending
  const task = (async () => {
    try {
      const info = await writeVerifiedDatabaseBackup(conn, dir, reason)
      await pruneBackups(new Date(), dir)
      lastError = null
      return info
    } catch (error) {
      lastError = { at: new Date().toISOString(), message: (error as Error).message }
      throw error
    } finally {
      running.delete(dir)
    }
  })()
  running.set(dir, task)
  return task
}

/** Backup do banco de quem pediu (manual ou antes de uma importação). */
export async function createDatabaseBackup(reason: BackupReason): Promise<DatabaseBackupInfo> {
  const { conn, dir } = currentTarget()
  return backupInto(conn, dir, reason)
}

/** Ciclo automático: o núcleo (contas, feed, mensagens) e o banco de cada pessoa. */
async function backupEverything(reason: BackupReason): Promise<DatabaseBackupInfo[]> {
  const infos: DatabaseBackupInfo[] = []
  for (const target of personalDatabases()) infos.push(await backupInto(target.conn, target.backupDir, reason))
  infos.push(await backupInto(coreDb, coreBackupDir, reason))
  return infos
}

export async function backupStatus() {
  const { dir } = currentTarget()
  const files = await storedBackups(dir)
  return {
    enabled: process.env.BACKUP_ENABLED !== '0',
    directory: dir,
    interval_hours: intervalHours,
    retention: { daily_days: dailyDays, weekly_weeks: weeklyWeeks, safety_copies: safetyCopies },
    latest: files[0] ?? null,
    count: files.length,
    running: running.has(dir),
    last_error: lastError,
  }
}

/** Inicia depois do servidor; se já existe cópia recente, espera o próximo ciclo. */
export function startBackupScheduler(): void {
  if (process.env.BACKUP_ENABLED === '0' || schedulerEnabled) return
  schedulerEnabled = true

  const intervalMs = intervalHours * HOUR_MS
  const tick = async () => {
    try {
      const latest = (await storedBackups()).find(f => f.reason === 'automatic')
      if (!latest || Date.now() - latest.mtime_ms >= intervalMs) {
        const infos = await backupEverything('automatic')
        for (const info of infos) console.log(`[backup] snapshot verificado: ${info.filename}`)
      }
    } catch (error) {
      console.error(`[backup] falha: ${(error as Error).message}`)
    } finally {
      if (schedulerEnabled) {
        schedulerTimer = setTimeout(tick, intervalMs)
        schedulerTimer.unref()
      }
    }
  }

  schedulerTimer = setTimeout(tick, 10_000)
  schedulerTimer.unref()
}

/** Cancela o próximo ciclo e espera uma cópia já iniciada terminar. */
export async function stopBackupScheduler(): Promise<void> {
  schedulerEnabled = false
  if (schedulerTimer) clearTimeout(schedulerTimer)
  schedulerTimer = null
  await Promise.allSettled([...running.values()])
}
