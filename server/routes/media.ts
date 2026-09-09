import { Hono } from 'hono'
import { db } from '../db.js'
import { notifyLibraryActivity } from '../notify.js'
import { getSeriesView } from '../series.js'

const app = new Hono()

/** Anexa `progress` (0..1): séries pelo progresso de episódios, livros pelas páginas lidas (Kavita). */
function withProgress<T extends { id: number; type: string; pages_total?: number | null; pages_read?: number | null }>(
  rows: T[],
): (T & { progress?: number })[] {
  return rows.map(r => {
    if (r.type === 'series') return { ...r, progress: getSeriesView(r.id).percent }
    if (r.type === 'book' && r.pages_total) {
      return { ...r, progress: Math.min(1, (r.pages_read ?? 0) / r.pages_total) }
    }
    return r
  })
}

/**
 * `library=1` tira a wishlist **no SQL**, antes do `LIMIT`.
 *
 * As telas de biblioteca sempre descartaram a wishlist, mas faziam isso no
 * cliente, depois de receber as N linhas mais recentes. Bastava um backlog
 * grande — uma watchlist do Letterboxd, por exemplo — para ocupar a janela
 * inteira e a biblioteca aparecer vazia, com todos os contadores zerados.
 */
app.get('/', (c) => {
  const type    = c.req.query('type')
  const status  = c.req.query('status')
  const library = c.req.query('library') === '1'
  const limit   = parseInt(c.req.query('limit') ?? '100')

  let sql = 'SELECT * FROM media_items WHERE 1=1'
  const params: (string | number)[] = []
  if (type)    { sql += ' AND type = ?';   params.push(type) }
  if (status)  { sql += ' AND status = ?'; params.push(status) }
  if (library) { sql += " AND status != 'wishlist'" }
  sql += ' ORDER BY added_at DESC LIMIT ?'
  params.push(limit)

  return c.json(withProgress(db.prepare(sql).all(...params) as any[]))
})

app.get('/recent', (c) => {
  const perType = parseInt(c.req.query('per_type') ?? '12')
  const result: Record<string, unknown[]> = {}
  for (const t of ['movie', 'series', 'game', 'book']) {
    // Só a biblioteca (consumido): wishlist mora apenas na Wishlist.
    const rows = db.prepare("SELECT * FROM media_items WHERE type = ? AND status != 'wishlist' ORDER BY added_at DESC LIMIT ?").all(t, perType) as any[]
    result[t] = t === 'series' || t === 'book' ? withProgress(rows) : rows
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
  const item = db.prepare('SELECT * FROM media_items WHERE id = ?').get(c.req.param('id')) as any
  if (!item) return c.json({ error: 'Not found' }, 404)
  return c.json(item.type === 'series' || item.type === 'book' ? withProgress([item])[0] : item)
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

    const created = db.prepare('SELECT * FROM media_items WHERE id = ?').get(res.lastInsertRowid) as any
    notifyLibraryActivity({ event: 'added', type: created.type, title: created.title, rating: created.rating })
    return c.json(created, 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return c.json({ error: 'Already in library' }, 409)
    throw e
  }
})

// game_status (granular de games) → status base do Shelf
const GAME_STATUS_TO_BASE: Record<string, 'wishlist' | 'in_progress' | 'completed' | 'dropped'> = {
  jogando: 'in_progress', zerado: 'completed', platinado: 'completed', abandonado: 'dropped', nunca_jogado: 'wishlist',
}

app.patch('/:id', async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()

  // Ao mudar o status granular de um game, deriva o status base (e a data de conclusão).
  if (typeof body.game_status === 'string' && GAME_STATUS_TO_BASE[body.game_status]) {
    const base = GAME_STATUS_TO_BASE[body.game_status]
    body.status = base
    if (base === 'completed' && body.completed_at == null) body.completed_at = new Date().toISOString()
  }

  const allowed = ['rating', 'status', 'notes', 'runtime', 'synopsis', 'creators', 'author', 'release_date', 'hype', 'completed_at', 'game_status', 'last_played_at', 'playtime_seconds']
  const fields  = Object.keys(body).filter(k => allowed.includes(k))
  if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400)

  const before = db.prepare('SELECT status, rating FROM media_items WHERE id = ?').get(id) as { status: string; rating: number } | undefined

  const set    = fields.map(f => `${f} = ?`).join(', ')
  const values = fields.map(f => body[f])
  db.prepare(`UPDATE media_items SET ${set}, updated_at = datetime('now') WHERE id = ?`).run(...values, id)

  const item = db.prepare('SELECT * FROM media_items WHERE id = ?').get(id) as any
  if (!item) return c.json({ error: 'Not found' }, 404)

  // Notifica mudança de status (concluído, abandonado, ...) e/ou nova nota
  if (before) {
    if (fields.includes('status') && before.status !== item.status) {
      notifyLibraryActivity({ event: item.status, type: item.type, title: item.title, rating: item.rating })
    }
    if (fields.includes('rating') && before.rating !== item.rating && item.rating > 0) {
      notifyLibraryActivity({ event: 'rated', type: item.type, title: item.title, rating: item.rating })
    }
  }

  return c.json(item)
})

app.delete('/:id', (c) => {
  const res = db.prepare('DELETE FROM media_items WHERE id = ?').run(c.req.param('id'))
  if (res.changes === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

export default app
