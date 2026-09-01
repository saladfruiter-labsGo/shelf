import { Hono } from 'hono'
import { db } from '../db.js'

const app = new Hono()

app.get('/', (c) => {
  return c.json(db.prepare(`
    SELECT l.*, COUNT(li.id) as item_count
    FROM lists l
    LEFT JOIN list_items li ON li.list_id = l.id
    GROUP BY l.id
    ORDER BY l.updated_at DESC
  `).all())
})

// Check which lists contain a specific media item
app.get('/check/:mediaItemId', (c) => {
  return c.json(db.prepare(`
    SELECT l.id, l.name,
           CASE WHEN li.media_item_id IS NOT NULL THEN 1 ELSE 0 END AS contains
    FROM lists l
    LEFT JOIN list_items li ON li.list_id = l.id AND li.media_item_id = ?
    ORDER BY l.name
  `).all(c.req.param('mediaItemId')))
})

app.get('/:id', (c) => {
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(c.req.param('id'))
  if (!list) return c.json({ error: 'Not found' }, 404)
  const items = db.prepare(`
    SELECT m.* FROM media_items m
    JOIN list_items li ON li.media_item_id = m.id
    WHERE li.list_id = ?
    ORDER BY li.added_at DESC
  `).all(c.req.param('id'))
  return c.json({ ...list, items })
})

app.post('/', async (c) => {
  const { name, description } = await c.req.json()
  if (!name?.trim()) return c.json({ error: 'name is required' }, 400)
  const res = db.prepare('INSERT INTO lists (name, description) VALUES (?, ?)').run(name.trim(), description?.trim() ?? null)
  return c.json(db.prepare('SELECT * FROM lists WHERE id = ?').get(res.lastInsertRowid), 201)
})

app.patch('/:id', async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()
  db.prepare(`
    UPDATE lists SET
      name        = COALESCE(?, name),
      description = COALESCE(?, description),
      updated_at  = datetime('now')
    WHERE id = ?
  `).run(body.name?.trim() ?? null, body.description?.trim() ?? null, id)
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id)
  if (!list) return c.json({ error: 'Not found' }, 404)
  return c.json(list)
})

app.delete('/:id', (c) => {
  const res = db.prepare('DELETE FROM lists WHERE id = ?').run(c.req.param('id'))
  if (res.changes === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

app.post('/:id/items', async (c) => {
  const { media_item_id } = await c.req.json()
  try {
    db.prepare('INSERT INTO list_items (list_id, media_item_id) VALUES (?, ?)').run(c.req.param('id'), media_item_id)
    db.prepare("UPDATE lists SET updated_at = datetime('now') WHERE id = ?").run(c.req.param('id'))
    return c.json({ ok: true }, 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return c.json({ error: 'Already in list' }, 409)
    throw e
  }
})

app.delete('/:id/items/:mediaItemId', (c) => {
  db.prepare('DELETE FROM list_items WHERE list_id = ? AND media_item_id = ?')
    .run(c.req.param('id'), c.req.param('mediaItemId'))
  return c.json({ ok: true })
})

export default app
