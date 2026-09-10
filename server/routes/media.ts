import { Hono } from 'hono'
import { db } from '../db.js'
import { notifyLibraryActivity } from '../notify.js'
import { getSeriesView } from '../series.js'
import { fetchTmdbMediaDetails, type TmdbMediaType } from '../tmdb.js'
import {
  GAME_STATUS_TO_BASE,
  LIBRARY_STATUS_PREDICATE,
  isGameStatus,
  isMediaStatus,
  isMediaType,
} from '../media-domain.js'

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
  // `offset` deixa quem precisa da coleção inteira — o Backlog, que monta os
  // filtros e a ordenação por preço a partir de todos os itens — buscar em
  // páginas em vez de torcer para caber num limite chutado.
  const offset  = parseInt(c.req.query('offset') ?? '0')

  let sql = 'SELECT * FROM media_items WHERE 1=1'
  const params: (string | number)[] = []
  if (type)    { sql += ' AND type = ?';   params.push(type) }
  if (status)  { sql += ' AND status = ?'; params.push(status) }
  if (library) { sql += ` AND ${LIBRARY_STATUS_PREDICATE}` }
  // Desempate por id: sem ele, itens com o mesmo `added_at` — um import inteiro
  // tem muitos — podem trocar de lugar entre páginas e sumir ou repetir.
  sql += ' ORDER BY added_at DESC, id DESC LIMIT ? OFFSET ?'
  params.push(limit, Number.isFinite(offset) && offset > 0 ? offset : 0)

  return c.json(withProgress(db.prepare(sql).all(...params) as any[]))
})

app.get('/recent', (c) => {
  const perType = parseInt(c.req.query('per_type') ?? '12')
  const result: Record<string, unknown[]> = {}
  for (const t of ['movie', 'series', 'game', 'book']) {
    // Só a biblioteca (consumido): wishlist mora apenas na Wishlist.
    const rows = db.prepare(`SELECT * FROM media_items WHERE type = ? AND ${LIBRARY_STATUS_PREDICATE} ORDER BY added_at DESC LIMIT ?`).all(t, perType) as any[]
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
  if (!isMediaType(type)) return c.json({ error: 'Invalid media type' }, 400)
  if (!isMediaStatus(status)) return c.json({ error: 'Invalid media status' }, 400)

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

function tmdbIdFrom(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : String(value ?? '').trim()
  return /^[1-9]\d*$/.test(id) ? id : null
}

async function tmdbDetailsForItem(id: string, rawTmdbId: unknown) {
  const item = db.prepare('SELECT id, type FROM media_items WHERE id = ?').get(id) as { id: number; type: string } | undefined
  if (!item) return { error: 'Not found', status: 404 as const }
  if (item.type !== 'movie' && item.type !== 'series') {
    return { error: 'TMDB só pode identificar filmes e séries', status: 400 as const }
  }

  const tmdbId = tmdbIdFrom(rawTmdbId)
  if (!tmdbId) return { error: 'tmdb_id deve ser um número positivo', status: 400 as const }

  const details = await fetchTmdbMediaDetails(item.type as TmdbMediaType, tmdbId).catch(() => null)
  if (!details) return { error: 'Mídia não encontrada no TMDB ou TMDB indisponível', status: 502 as const }
  return { item, details }
}

/** Busca uma identificação manual sem alterar o item — usada para a prévia. */
app.get('/:id/tmdb-preview', async (c) => {
  const result = await tmdbDetailsForItem(c.req.param('id'), c.req.query('tmdb_id'))
  if ('error' in result) return c.json({ error: result.error }, result.status)
  return c.json(result.details)
})

/** Aplica a identificação TMDB escolhida ao item existente. */
app.patch('/:id/tmdb-identification', async (c) => {
  const body = await c.req.json().catch(() => ({})) as { tmdb_id?: unknown }
  const result = await tmdbDetailsForItem(c.req.param('id'), body.tmdb_id)
  if ('error' in result) return c.json({ error: result.error }, result.status)

  const { details } = result
  db.prepare(`
    UPDATE media_items SET
      tmdb_id = ?, title = ?, cover_url = ?, year = ?, genre = ?, runtime = ?,
      synopsis = ?, creators = ?, author = ?, release_date = ?, updated_at = datetime('now')
    WHERE id = ?
  `).run(
    details.tmdb_id, details.title, details.cover_url, details.year, details.genre, details.runtime,
    details.synopsis, details.creators, details.author, details.release_date, c.req.param('id'),
  )

  return c.json(db.prepare('SELECT * FROM media_items WHERE id = ?').get(c.req.param('id')))
})

/** Vagas de favorito por categoria (o banner da home mostra exatamente estas). */
const FAVORITE_LIMIT = 5
/** `favorite = 2` marca o destaque da categoria — a capa coroada, no centro da faixa. */
const FAVORITE_TOP = 2

app.patch('/:id', async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()
  const gameStatus = body.game_status as unknown

  if ('status' in body && !isMediaStatus(body.status)) {
    return c.json({ error: 'Invalid media status' }, 400)
  }
  if ('game_status' in body && gameStatus !== null && !isGameStatus(gameStatus)) {
    return c.json({ error: 'Invalid game status' }, 400)
  }

  // Ao mudar o status granular de um game, deriva o status base (e a data de conclusão).
  if (isGameStatus(gameStatus)) {
    const base = GAME_STATUS_TO_BASE[gameStatus]
    body.status = base
    if (base === 'completed' && body.completed_at == null) body.completed_at = new Date().toISOString()
  }

  const allowed = ['rating', 'status', 'notes', 'runtime', 'synopsis', 'creators', 'author', 'release_date', 'hype', 'favorite', 'completed_at', 'game_status', 'last_played_at', 'playtime_seconds']
  const fields  = Object.keys(body).filter(k => allowed.includes(k))
  if (fields.length === 0) return c.json({ error: 'No valid fields' }, 400)

  const before = db.prepare('SELECT status, rating, type, favorite FROM media_items WHERE id = ?').get(id) as
    { status: string; rating: number; type: string; favorite: number } | undefined

  // Cinco favoritos por categoria — é o número de vagas do banner da home.
  if (before && Number(body.favorite) > 0 && !before.favorite) {
    const { n } = db.prepare('SELECT COUNT(*) n FROM media_items WHERE type = ? AND favorite > 0')
      .get(before.type) as { n: number }
    if (n >= FAVORITE_LIMIT) {
      return c.json({ error: `Só cabem ${FAVORITE_LIMIT} favoritos por categoria — remova um antes.` }, 409)
    }
  }

  const set    = fields.map(f => `${f} = ?`).join(', ')
  const values = fields.map(f => body[f])
  db.prepare(`UPDATE media_items SET ${set}, updated_at = datetime('now') WHERE id = ?`).run(...values, id)

  // A coroa é uma só por categoria: promover um destaque rebaixa o anterior.
  if (Number(body.favorite) === FAVORITE_TOP && before) {
    db.prepare('UPDATE media_items SET favorite = 1 WHERE type = ? AND favorite = ? AND id != ?')
      .run(before.type, FAVORITE_TOP, id)
  }

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
