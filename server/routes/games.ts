/**
 * Dados extras da página de jogo (ST-G). A mídia em si continua vindo de
 * `/api/media/:id`; aqui só entra o que é específico de game.
 */
import { Hono } from 'hono'
import { db } from '../db.js'
import { getStorePage } from '../steam/store.js'
import { igdbConfigured, refreshTimeToBeat, timeToBeatIsStale } from '../igdb.js'
import { ensureSteamCover } from '../steam/covers.js'

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
  const item = db.prepare("SELECT id, steam_appid, cover_url, cover_custom FROM media_items WHERE id = ? AND type = 'game'").get(id) as
    { id: number; steam_appid: number | null; cover_url: string | null; cover_custom: number | null } | undefined
  if (!item) return c.json({ error: 'Not found' }, 404)
  if (!item.steam_appid) return c.json({ available: false, page: null })

  // Visitar a página já troca a capa pela arte vertical da Steam (se ainda não for).
  const coverChanged = await ensureSteamCover({ ...item, steam_appid: item.steam_appid }).catch(() => false)

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
  return c.json({ available: true, page, filled: filled.changes > 0 || coverChanged })
})

/**
 * Tempo para zerar (IGDB). Consulta na hora quando o dado não existe ou tem
 * mais de 30 dias; falha da IGDB devolve o último valor gravado.
 */
app.get('/:id/time-to-beat', async (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid media id' }, 400)
  const read = () => db.prepare(`
    SELECT steam_appid, ttb_main_seconds AS main, ttb_extra_seconds AS extra,
           ttb_complete_seconds AS complete, ttb_fetched_at AS fetched_at
      FROM media_items WHERE id = ? AND type = 'game'
  `).get(id) as { steam_appid: number | null; main: number | null; extra: number | null; complete: number | null; fetched_at: string | null } | undefined
  let row = read()
  if (!row) return c.json({ error: 'Not found' }, 404)
  if (!igdbConfigured()) return c.json({ configured: false, main: row.main, extra: row.extra, complete: row.complete })
  if (row.steam_appid && timeToBeatIsStale(row.fetched_at)) {
    try { await refreshTimeToBeat(id, row.steam_appid); row = read()! } catch { /* mantém o valor antigo */ }
  }
  return c.json({ configured: true, main: row.main, extra: row.extra, complete: row.complete })
})

/**
 * Últimas conquistas desbloqueadas em todos os jogos, para a Home. Não conflita
 * com `/:id/...`: este caminho tem um segmento a mais fixo.
 */
app.get('/achievements/latest', (c) => {
  const limit = Math.min(Math.max(Number.parseInt(c.req.query('limit') ?? '8', 10) || 8, 1), 30)
  const rows = db.prepare(`
    SELECT a.api_name, a.name, a.description, a.icon, a.global_percent, a.unlocked_at, a.finale, a.hidden,
           m.id AS media_item_id, m.title AS game, m.cover_url
      FROM steam_achievements a
      JOIN media_items m ON m.steam_appid = a.appid AND m.type = 'game'
     WHERE a.achieved = 1 AND a.unlocked_at IS NOT NULL
     ORDER BY a.unlocked_at DESC, a.name
     LIMIT ?
  `).all(limit) as { finale: number; hidden: number }[]
  return c.json(rows.map(r => ({ ...r, finale: r.finale === 1, hidden: r.hidden === 1 })))
})

/** Conquistas do jogo, como gravadas pela leitura da Steam (ST-03). */
app.get('/:id/achievements', (c) => {
  const id = Number(c.req.param('id'))
  if (!Number.isInteger(id) || id <= 0) return c.json({ error: 'Invalid media id' }, 400)
  const item = db.prepare("SELECT steam_appid FROM media_items WHERE id = ? AND type = 'game'").get(id) as
    { steam_appid: number | null } | undefined
  if (!item) return c.json({ error: 'Not found' }, 404)
  if (!item.steam_appid) return c.json({ total: 0, unlocked: 0, achievements: [] })

  const achievements = db.prepare(`
    SELECT api_name, name, description, icon, icon_gray, hidden, global_percent, achieved, unlocked_at, finale
      FROM steam_achievements WHERE appid = ?
     ORDER BY achieved DESC, unlocked_at DESC, global_percent DESC, name COLLATE NOCASE
  `).all(item.steam_appid) as { achieved: number; hidden: number; finale: number; description: string | null }[]

  return c.json({
    total: achievements.length,
    unlocked: achievements.filter(a => a.achieved).length,
    // Oculta e ainda bloqueada: o nome e a descrição podem ser spoiler.
    achievements: achievements.map(a => ({
      ...a,
      achieved: a.achieved === 1,
      hidden: a.hidden === 1,
      finale: a.finale === 1,
      description: a.hidden && !a.achieved ? null : a.description,
    })),
  })
})

export default app
