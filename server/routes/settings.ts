import { Hono } from 'hono'
import { db } from '../db.js'

const app = new Hono()

const ALLOWED_KEYS = ['TMDB_API_KEY', 'RAWG_API_KEY', 'GOOGLE_BOOKS_KEY'] as const

/**
 * Só as chaves públicas desta tela saem no GET. A tabela `settings` também
 * guarda segredos de integração (Plex, Last.fm, Kavita, ITAD...), que nunca
 * devem chegar ao navegador — esses ficam mascarados em /api/integrations.
 */
function getPublicSettings(): Record<string, string> {
  const result: Record<string, string> = {}
  for (const key of ALLOWED_KEYS) {
    const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined
    if (row) result[key] = row.value
  }
  return result
}

app.get('/', (c) => {
  return c.json(getPublicSettings())
})

app.patch('/', async (c) => {
  const body = (await c.req.json()) as Record<string, string>

  const upsert = db.prepare(
    'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
  )
  const remove = db.prepare('DELETE FROM settings WHERE key = ?')

  for (const key of ALLOWED_KEYS) {
    if (!(key in body)) continue
    const val = body[key]?.trim() ?? ''
    if (val) {
      upsert.run(key, val)
    } else {
      remove.run(key)
    }
  }

  return c.json(getPublicSettings())
})

export default app
