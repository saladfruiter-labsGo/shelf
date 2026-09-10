import { randomUUID } from 'node:crypto'
import { db } from '../db.js'

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
const setSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
)
const delSetting = db.prepare('DELETE FROM settings WHERE key = ?')

/** Configuração persistida tem prioridade sobre o ambiente do container. */
export function cfg(key: string): string {
  const row = getSetting.get(key) as { value: string } | undefined
  return row?.value?.trim() || process.env[key] || ''
}

export function setCfg(key: string, value: string): void {
  if (value) setSetting.run(key, value)
  else delSetting.run(key)
}

export function ensureSecret(key: string): string {
  const current = cfg(key)
  if (current) return current
  const secret = randomUUID().replace(/-/g, '')
  setSetting.run(key, secret)
  return secret
}
