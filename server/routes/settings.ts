import { Hono } from 'hono'
import { db } from '../db.js'

const app = new Hono()

const ALLOWED_KEYS = ['TMDB_API_KEY', 'RAWG_API_KEY', 'GOOGLE_BOOKS_KEY'] as const

function getAllSettings(): Record<string, string> {
  const rows = db.prepare('SELECT key, value FROM settings').all() as { key: string; value: string }[]
  const result: Record<string, string> = {}
  for (const r of rows) result[r.key] = r.value
  return result
}

app.get('/', (c) => {
  return c.json(getAllSettings())
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

  return c.json(getAllSettings())
})

export default app
