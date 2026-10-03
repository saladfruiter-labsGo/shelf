import { randomUUID } from 'node:crypto'
import { core, coreDb } from '../core-db.js'
import { currentUserId, db, instanceHasUsers, legacyDb } from '../db.js'

/**
 * Chaves da instância: credenciais de metadados que servem a todo mundo e que
 * só um administrador configura. Ficam no banco núcleo. Todo o resto
 * (Steam, Plex, Last.fm, Kavita, Telegram, estados de sincronização...) é
 * pessoal e mora no banco de cada usuário.
 */
export const INSTANCE_KEYS = [
  'TMDB_API_KEY', 'RAWG_API_KEY', 'GOOGLE_BOOKS_KEY',
  'IGDB_CLIENT_ID', 'IGDB_CLIENT_SECRET', 'IGDB_TOKEN',
  'ITAD_API_KEY', 'ITAD_COUNTRY',
] as const
const instanceKeys = new Set<string>(INSTANCE_KEYS)

export function isInstanceKey(key: string): boolean {
  return instanceKeys.has(key)
}

const getInstance = core('SELECT value FROM instance_settings WHERE key = ?')
const setInstance = core(
  'INSERT INTO instance_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
)
const delInstance = core('DELETE FROM instance_settings WHERE key = ?')

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
const setSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
)
const delSetting = db.prepare('DELETE FROM settings WHERE key = ?')

/**
 * Até aqui as chaves da instância moravam no `settings` do banco único. Elas
 * passam para o núcleo uma vez e saem do banco pessoal, para que nenhum
 * segredo exista em dois lugares.
 */
function moveInstanceKeysToCore(): void {
  const placeholders = INSTANCE_KEYS.map(() => '?').join(', ')
  const rows = legacyDb.prepare(`SELECT key, value FROM settings WHERE key IN (${placeholders})`)
    .all(...INSTANCE_KEYS) as { key: string; value: string }[]
  if (!rows.length) return
  coreDb.transaction(() => {
    const keep = core('INSERT OR IGNORE INTO instance_settings (key, value) VALUES (?, ?)')
    for (const row of rows) keep.run(row.key, row.value)
  })()
  legacyDb.prepare(`DELETE FROM settings WHERE key IN (${placeholders})`).run(...INSTANCE_KEYS)
}
moveInstanceKeysToCore()

/**
 * Variáveis de ambiente do container só valem para a instância e para o
 * dono — senão um token do Plex posto no compose valeria para todas as contas.
 */
function envFallback(key: string): string {
  if (isInstanceKey(key)) return process.env[key] ?? ''
  if (!instanceHasUsers()) return process.env[key] ?? ''
  const userId = currentUserId()
  if (userId == null) return ''
  const owner = core("SELECT id FROM users WHERE role = 'owner'").get() as { id: number } | undefined
  return owner?.id === userId ? process.env[key] ?? '' : ''
}

/** Configuração persistida tem prioridade sobre o ambiente do container. */
export function cfg(key: string): string {
  type Row = { value: string } | undefined
  let row: Row
  if (isInstanceKey(key)) {
    row = getInstance.get(key) as Row
    // Sem contas ainda, o banco único continua valendo (instalação antiga, testes).
    if (!row?.value?.trim() && !instanceHasUsers()) row = getSetting.get(key) as Row
  } else {
    row = getSetting.get(key) as Row
  }
  return row?.value?.trim() || envFallback(key)
}

export function setCfg(key: string, value: string): void {
  if (isInstanceKey(key)) {
    if (value) setInstance.run(key, value)
    else delInstance.run(key)
    // Sem contas, `cfg` ainda enxerga o banco único: a cópia antiga sai junto.
    if (!instanceHasUsers()) delSetting.run(key)
    return
  }
  if (value) setSetting.run(key, value)
  else delSetting.run(key)
}

export function ensureSecret(key: string): string {
  const current = cfg(key)
  if (current) return current
  const secret = randomUUID().replace(/-/g, '')
  setCfg(key, secret)
  return secret
}
