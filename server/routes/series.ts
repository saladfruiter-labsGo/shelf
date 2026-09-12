import { Hono } from 'hono'
import { db } from '../db.js'
import {
  ensureSeriesStructure, getSeriesView, setEpisodeWatched, recomputeSeriesStatus,
  fetchTmdbSeriesStructure, markEpisodesWatched, getUnratedCompletedSeasons, applySeasonRating,
} from '../series.js'
import { isQuickRating } from '../quick-rating.js'
import { notifyLibraryActivity } from '../notify.js'

const app = new Hono()

/** Fila da home: temporadas concluídas que ainda não receberam nota. */
app.get('/unrated', (c) => c.json(getUnratedCompletedSeasons()))

/**
 * Preview de temporadas/episódios de uma série do TMDB, SEM gravar no banco.
 * Usado pelo modal de adicionar mídia (a série ainda não está na biblioteca).
 * Precisa vir antes de `/:id` para não ser capturado pela rota paramétrica.
 */
app.get('/preview/:tmdbId', async (c) => {
  const tmdbId = c.req.param('tmdbId')
  if (!/^\d+$/.test(tmdbId)) return c.json({ error: 'Invalid tmdb id' }, 400)
  const preview = await fetchTmdbSeriesStructure(tmdbId)
  if (!preview) return c.json({ error: 'Not found or TMDB unavailable', tmdb_id: tmdbId, total: 0, seasons: [] }, 200)
  return c.json(preview)
})

/** Estrutura (temporadas + episódios) e progresso de uma série. */
app.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'))
  const item = db.prepare('SELECT * FROM media_items WHERE id = ? AND type = ?').get(id, 'series') as any
  if (!item) return c.json({ error: 'Not found' }, 404)

  // primeira visita: popula temporadas/episódios via TMDB
  await ensureSeriesStructure(id)
  return c.json(getSeriesView(id))
})

/** Força (re)enriquecimento via TMDB. */
app.post('/:id/enrich', async (c) => {
  const id = parseInt(c.req.param('id'))
  const item = db.prepare('SELECT * FROM media_items WHERE id = ? AND type = ?').get(id, 'series') as any
  if (!item) return c.json({ error: 'Not found' }, 404)
  await ensureSeriesStructure(id)
  return c.json(getSeriesView(id))
})

/**
 * Marca um lote de episódios como vistos (usado pelo modal ao adicionar uma série).
 * Se `diary` for true, cria também um registro no diário por episódio.
 * A conclusão da temporada é registrada separadamente pela regra de domínio.
 */
app.post('/:id/watched-batch', async (c) => {
  const id = parseInt(c.req.param('id'))
  const item = db.prepare('SELECT * FROM media_items WHERE id = ? AND type = ?').get(id, 'series') as any
  if (!item) return c.json({ error: 'Not found' }, 404)

  const b = await c.req.json() as {
    episodes?: { season_number: number; episode_number: number }[]
    diary?: boolean
    watched_at?: string
    rating?: number | null
    comment?: string | null
  }
  const episodes = Array.isArray(b.episodes)
    ? b.episodes.filter(e => typeof e?.season_number === 'number' && typeof e?.episode_number === 'number')
    : []
  if (episodes.length === 0) return c.json({ error: 'episodes[] is required' }, 400)

  // garante a estrutura (episode_count via TMDB) antes de marcar/concluir
  await ensureSeriesStructure(id)

  const watchedAt = typeof b.watched_at === 'string' && b.watched_at.trim() ? b.watched_at.trim() : new Date().toISOString()
  markEpisodesWatched(id, episodes, watchedAt)

  if (b.diary) {
    const rating  = b.rating != null && b.rating !== 0 ? Number(b.rating) : null
    const comment = typeof b.comment === 'string' && b.comment.trim() ? b.comment.trim() : null
    const insert = db.prepare(`
      INSERT INTO diary_entries (media_item_id, watched_at, rating, comment, source, season_number, episode_number)
      VALUES (?, ?, ?, ?, 'manual', ?, ?)
    `)
    const tx = db.transaction((list: { season_number: number; episode_number: number }[]) => {
      for (const e of list) insert.run(id, watchedAt, rating, comment, e.season_number, e.episode_number)
    })
    tx(episodes)
    notifyLibraryActivity({ event: 'completed', type: 'series', title: item.title, rating: rating ?? item.rating, mediaItemId: item.id })
  }

  return c.json(getSeriesView(id))
})

/** Marca/desmarca um episódio. */
app.patch('/:id/episode', async (c) => {
  const id = parseInt(c.req.param('id'))
  const item = db.prepare('SELECT * FROM media_items WHERE id = ? AND type = ?').get(id, 'series') as any
  if (!item) return c.json({ error: 'Not found' }, 404)

  const b = await c.req.json() as {
    season_number?: number; episode_number?: number; watched?: boolean; title?: string | null
  }
  if (typeof b.season_number !== 'number' || typeof b.episode_number !== 'number' || typeof b.watched !== 'boolean') {
    return c.json({ error: 'season_number, episode_number and watched are required' }, 400)
  }
  setEpisodeWatched(id, b.season_number, b.episode_number, b.watched, b.title)
  return c.json(getSeriesView(id))
})

/** Marca uma temporada inteira como vista / não vista. */
app.patch('/:id/season', async (c) => {
  const id = parseInt(c.req.param('id'))
  const item = db.prepare('SELECT * FROM media_items WHERE id = ? AND type = ?').get(id, 'series') as any
  if (!item) return c.json({ error: 'Not found' }, 404)

  const b = await c.req.json() as { season_number?: number; watched?: boolean }
  if (typeof b.season_number !== 'number' || typeof b.watched !== 'boolean') {
    return c.json({ error: 'season_number and watched are required' }, 400)
  }
  const eps = db.prepare('SELECT episode_number FROM series_episodes WHERE media_item_id = ? AND season_number = ?')
    .all(id, b.season_number) as { episode_number: number }[]
  const now = new Date().toISOString()
  const tx = db.transaction(() => {
    for (const e of eps) setEpisodeWatched(id, b.season_number!, e.episode_number, b.watched!, null, now)
  })
  tx()
  recomputeSeriesStatus(id)
  return c.json(getSeriesView(id))
})

/** Avaliação rápida de uma temporada concluída. */
app.patch('/:id/season/:seasonNumber/rating', async (c) => {
  const id = Number(c.req.param('id'))
  const seasonNumber = Number(c.req.param('seasonNumber'))
  const body = await c.req.json().catch(() => ({})) as { rating?: unknown }
  if (!Number.isInteger(id) || id <= 0 || !Number.isInteger(seasonNumber) || seasonNumber <= 0) {
    return c.json({ error: 'Invalid series or season' }, 400)
  }
  if (!isQuickRating(body.rating)) {
    return c.json({ error: 'Rating must be between 0.5 and 5 in half-star steps' }, 400)
  }
  const result = applySeasonRating(id, seasonNumber, body.rating)
  if (!result) return c.json({ error: 'Season not found' }, 404)
  return c.json(result)
})

export default app
