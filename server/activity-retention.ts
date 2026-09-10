import type Database from 'better-sqlite3'
import { db } from './db.js'

const HOUR_MS = 60 * 60 * 1000
const DAY_MS = 24 * HOUR_MS

function intSetting(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10)
  return Number.isFinite(parsed) ? Math.min(max, Math.max(min, parsed)) : fallback
}

const rawRetentionDays = intSetting('ACTIVITY_RAW_RETENTION_DAYS', 30, 1, 3650)
const intervalHours = intSetting('ACTIVITY_RETENTION_INTERVAL_HOURS', 24, 1, 168)

let enabled = false
let timer: NodeJS.Timeout | null = null

/**
 * Remove apenas o payload bruto de diagnóstico. Os campos normalizados usados
 * pelo feed, biblioteca musical, estatísticas e export continuam preservados.
 */
export function pruneActivityPayloads(
  database: Database.Database = db,
  now = new Date(),
  retentionDays = rawRetentionDays,
): number {
  const days = Math.min(3650, Math.max(1, Math.trunc(retentionDays)))
  const cutoff = new Date(now.getTime() - days * DAY_MS).toISOString()
  return Number(database.prepare(`
    UPDATE activity_events SET raw = NULL
    WHERE raw IS NOT NULL AND julianday(occurred_at) < julianday(?)
  `).run(cutoff).changes)
}

export function startActivityRetention(): void {
  if (process.env.ACTIVITY_RETENTION_ENABLED === '0' || enabled) return
  enabled = true
  const intervalMs = intervalHours * HOUR_MS

  const tick = () => {
    try {
      const pruned = pruneActivityPayloads()
      if (pruned > 0) console.log(`[retention] ${pruned} payload(s) bruto(s) removido(s).`)
    } catch (error) {
      console.error(`[retention] falha: ${(error as Error).message}`)
    } finally {
      if (enabled) {
        timer = setTimeout(tick, intervalMs)
        timer.unref()
      }
    }
  }

  timer = setTimeout(tick, 15_000)
  timer.unref()
}

export function stopActivityRetention(): void {
  enabled = false
  if (timer) clearTimeout(timer)
  timer = null
}
