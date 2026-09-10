import { Hono } from 'hono'
import { db } from '../db.js'

const app = new Hono()

const ALLOWED_KEYS = ['TMDB_API_KEY', 'RAWG_API_KEY', 'GOOGLE_BOOKS_KEY'] as const
type AllowedKey = typeof ALLOWED_KEYS[number]
type KeyState = { set: boolean; masked: string }

function mask(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}

/**
 * O GET só informa se cada chave está salva e uma máscara curta. A tabela
 * `settings` também guarda outros segredos de integração; nenhum valor
 * completo deve voltar ao navegador.
 */
function getPublicSettings(): Record<AllowedKey, KeyState> {
  const result = {} as Record<AllowedKey, KeyState>
  for (const key of ALLOWED_KEYS) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    const value = row?.value ?? ''
    result[key] = { set: !!value, masked: mask(value) }
  }
  return result
}

app.get('/', (c) => {
  return c.json(getPublicSettings())
})

app.patch('/', async (c) => {
  const body = (await c.req.json()) as Record<string, unknown>

  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const remove = db.prepare('DELETE FROM settings WHERE key = ?')

  for (const key of ALLOWED_KEYS) {
    if (body[`${key}_clear`] === true) {
      remove.run(key)
      continue
    }
    const val = typeof body[key] === 'string' ? body[key].trim() : ''
    if (val) upsert.run(key, val)
  }

  return c.json(getPublicSettings())
})

export default app
