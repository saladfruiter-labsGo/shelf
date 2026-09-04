import { Hono } from 'hono'
import { db } from '../db.js'

const app = new Hono()

app.get('/', (c) => {
  const type   = c.req.query('type')
  const status = c.req.query('status')
  const limit  = parseInt(c.req.query('limit') ?? '100')

  let sql = 'SELECT * FROM media_items WHERE 1=1'
  const params: (string | number)[] = []
  if (type)   { sql += ' AND type = ?';   params.push(type) }
  if (status) { sql += ' AND status = ?'; params.push(status) }
  sql += ' ORDER BY added_at DESC LIMIT ?'
  params.push(limit)

  return c.json(db.prepare(sql).all(...params))
})

app.get('/recent', (c) => {
  const perType = parseInt(c.req.query('per_type') ?? '12')
  const result: Record<string, unknown[]> = {}
  for (const t of ['movie', 'series', 'game', 'book']) {
    result[t] = db.prepare('SELECT * FROM media_items WHERE type = ? ORDER BY added_at DESC LIMIT ?').all(t, perType)
  }
  return c.json(result)
})

app.get('/upcoming', (c) => {
  const today = new Date().toISOString().slice(0, 10)
  const in30  = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

  const wishlist = db.prepare(`
    SELECT * FROM media_items
    WHERE status = 'wishlist'
    ORDER BY release_date ASC NULLS LAST, added_at DESC
    LIMIT 24
  `).all()

  const hype = db.prepare(`
    SELECT * FROM media_items
    WHERE hype = 1
       OR (release_date IS NOT NULL AND release_date BETWEEN ? AND ?)
    ORDER BY release_date ASC, added_at DESC
    LIMIT 24
  `).all(today, in30)

  return c.json({ wishlist, hype })
})

app.get('/:id', (c) => {
  const item = db.prepare('SELECT * FROM media_items WHERE id = ?').get(c.req.param('id'))
  if (!item) return c.json({ error: 'Not found' }, 404)
  return c.json(item)
})

app.post('/', async (c) => {
  const body = await c.req.json()
  const { external_id, type, title, cover_url, year, genre, runtime, status = 'wishlist',
          rating = 0, notes, synopsis, creators, author, release_date, completed_at } = body

  if (!external_id || !type || !title) {
    return c.json({ error: 'external_id, type and title are required' }, 400)
  }

  try {
    const res = db.prepare(`
      INSERT INTO media_items
        (external_id, type, title, cover_url, year, genre, runtime, status, rating, notes,
         synopsis, creators, author, release_date, completed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(external_id, type, title, cover_url ?? null, year ?? null, genre ?? null,
           runtime ?? null, status, rating ?? 0, notes ?? null,
           synopsis ?? null, creators ?? null, author ?? null, release_date ?? null,
           completed_at ?? null)

    return c.json(db.prepare('SELECT * FROM media_items WHERE id = ?').get(res.lastInsertRowid), 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return c.json({ error: 'Already in library' }, 409)
    throw e
  }
})

app.patch('/:id', async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()
  const allowed = ['rating', 'status', 'notes', 'runtime', 'synopsis', 'creators', 'author', 'release_date', 'hype', 'completed_at']
  const fields  = Object.keys(body).filter(k => allowed.includes(k))
  if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400)

  const set    = fields.map(f => `${f} = ?`).join(', ')
  const values = fields.map(f => body[f])
  db.prepare(`UPDATE media_items SET ${set}, updated_at = datetime('now') WHERE id = ?`).run(...values, id)

  const item = db.prepare('SELECT * FROM media_items WHERE id = ?').get(id)
  if (!item) return c.json({ error: 'Not found' }, 404)
  return c.json(item)
})

app.delete('/:id', (c) => {
  const res = db.prepare('DELETE FROM media_items WHERE id = ?').run(c.req.param('id'))
  if (res.changes === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

export default app
