/**
 * Dados extras da página de jogo (ST-G). A mídia em si continua vindo de
 * `/api/media/:id`; aqui só entra o que é específico de game.
 */
import { Hono } from 'hono'
import { db } from '../db.js'
import { getStorePage } from '../steam/store.js'

const app = new Hono()

// Card criado pela leitura da Steam nasce só com título e capa: a primeira
// visita à página completa sinopse, gênero, ano e empresas (sem sobrescrever).
const fillFromStore = db.prepare(`
  UPDATE media_items SET
    synopsis  = COALESCE(synopsis, @synopsis),
    genre     = COALESCE(genre, @genre),
    year      = COALESCE(year, @year),
    creators  = COALESCE(creators, @creators),
    publisher = COALESCE(publisher, @publisher),
    updated_at = datetime('now')
  WHERE id = @id
    AND (synopsis IS NULL OR genre IS NULL OR year IS NULL OR creators IS NULL OR publisher IS NULL)
`)

app.get('/:id/steam', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid media id' }, 400)
  const item = db.prepare("SELECT id, steam_appid FROM media_items WHERE id = ? AND type = 'game'").get(id) as
    { id: number; steam_appid: number | null } | undefined
  if (!item) return c.json({ error: 'Not found' }, 404)
  if (!item.steam_appid) return c.json({ available: false, page: null })

  const page = await getStorePage(item.steam_appid)
  if (!page) return c.json({ available: false, page: null })

  const filled = fillFromStore.run({
    id,
    synopsis: page.short_description,
    genre: page.genres[0] ?? null,
    year: page.year,
    creators: page.developers.join(', ') || null,
    publisher: page.publishers.join(', ') || null,
  })
  return c.json({ available: true, page, filled: filled.changes > 0 })
})

export default app
