import { Hono } from 'hono'
import { db } from '../db.js'
import { ensureSeriesStructure, getSeriesView, setEpisodeWatched, recomputeSeriesStatus } from '../series.js'

const app = new Hono()

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

export default app
