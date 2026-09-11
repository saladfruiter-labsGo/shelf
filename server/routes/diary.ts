import { Hono } from 'hono'
import { db } from '../db.js'
import { notifyLibraryActivity } from '../notify.js'

const app = new Hono()

/** Entrada do diário já com os campos da mídia associada (join). */
const SELECT_ENTRY = `
  SELECT
    d.id, d.media_item_id, d.watched_at, d.rating, d.comment, d.source, d.created_at,
    d.season_number, d.episode_number,
    d.progress_day, d.progress_value, d.progress_total, d.progress_unit,
    m.title, m.type, m.cover_url, m.year, m.genre, m.external_id
  FROM diary_entries d
  JOIN media_items m ON m.id = d.media_item_id
`

// Lista entradas (mais recentes primeiro).
// Com ?media_item_id=X, retorna só o histórico daquele item.
app.get('/', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '500'), 1000)
  const mediaId = c.req.query('media_item_id')
  if (mediaId) {
    const rows = db.prepare(
      `${SELECT_ENTRY} WHERE d.media_item_id = ? ORDER BY d.watched_at DESC, d.id DESC LIMIT ?`
    ).all(Number(mediaId), limit)
    return c.json(rows)
  }
  const rows = db.prepare(`${SELECT_ENTRY} ORDER BY d.watched_at DESC, d.id DESC LIMIT ?`).all(limit)
  return c.json(rows)
})

// Cria uma entrada manual de consumo/conclusão.
app.post('/', async (c) => {
  const body = await c.req.json()
  const mediaId = Number(body.media_item_id)
  if (!mediaId) return c.json({ error: 'media_item_id is required' }, 400)

  const media = db.prepare('SELECT * FROM media_items WHERE id = ?').get(mediaId) as any
  if (!media) return c.json({ error: 'Media not found' }, 404)

  const watched_at = typeof body.watched_at === 'string' && body.watched_at.trim()
    ? body.watched_at.trim()
    : new Date().toISOString()
  const rating  = body.rating != null && body.rating !== '' ? Number(body.rating) : null
  const comment = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null

  const res = db.prepare(`
    INSERT INTO diary_entries (media_item_id, watched_at, rating, comment, source)
    VALUES (?, ?, ?, ?, 'manual')
  `).run(mediaId, watched_at, rating, comment)

  // Mantém a mídia sincronizada: passa a concluída, guarda a data mais recente
  // de conclusão e aplica a nota do registro (se houver) à mídia.
  db.prepare(`
    UPDATE media_items
    SET status = 'completed',
        completed_at = CASE
          WHEN completed_at IS NULL OR ? > completed_at THEN ? ELSE completed_at END,
        rating = CASE WHEN ? IS NOT NULL THEN ? ELSE rating END,
        updated_at = datetime('now')
    WHERE id = ?
  `).run(watched_at, watched_at, rating, rating, mediaId)

  notifyLibraryActivity({ event: 'completed', type: media.type, title: media.title, rating: rating ?? media.rating, mediaItemId: media.id })

  const created = db.prepare(`${SELECT_ENTRY} WHERE d.id = ?`).get(res.lastInsertRowid)
  return c.json(created, 201)
})

// Edita uma entrada (data, nota, comentário)
app.patch('/:id', async (c) => {
  const id = c.req.param('id')
  const body = await c.req.json()

  const fields: string[] = []
  const values: unknown[] = []
  if (typeof body.watched_at === 'string' && body.watched_at.trim()) {
    fields.push('watched_at = ?'); values.push(body.watched_at.trim())
  }
  if ('rating' in body) {
    fields.push('rating = ?'); values.push(body.rating != null && body.rating !== '' ? Number(body.rating) : null)
  }
  if ('comment' in body) {
    const c2 = typeof body.comment === 'string' && body.comment.trim() ? body.comment.trim() : null
    fields.push('comment = ?'); values.push(c2)
  }
  if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400)

  const res = db.prepare(`UPDATE diary_entries SET ${fields.join(', ')} WHERE id = ?`).run(...values, id)
  if (res.changes === 0) return c.json({ error: 'Not found' }, 404)

  const updated = db.prepare(`${SELECT_ENTRY} WHERE d.id = ?`).get(id)
  return c.json(updated)
})

// Remove uma entrada
app.delete('/:id', (c) => {
  const res = db.prepare('DELETE FROM diary_entries WHERE id = ?').run(c.req.param('id'))
  if (res.changes === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

export default app
