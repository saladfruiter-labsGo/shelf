import { Hono } from 'hono'
import { db } from '../../db.js'
import { cfg, ensureSecret, setCfg } from '../../integrations/config.js'
import {
  joinPlayniteNames,
  playniteGameStatus,
  playniteRating,
  type PlaynitePayload,
  type PlayniteState,
} from '../../integrations/playnite-domain.js'
import { GAME_STATUS_TO_BASE } from '../../media-domain.js'
import { notifyLibraryActivity } from '../../notify.js'
import { rawgLookup } from '../search.js'

const app = new Hono()

const upsertGame = db.prepare(`
  INSERT INTO media_items
    (external_id, type, title, cover_url, year, genre, creators, publisher, library, status, game_status, rating, playtime_seconds, last_played_at, completed_at)
  VALUES
    (@external_id, 'game', @title, @cover_url, @year, @genre, @creators, @publisher, @library, @status, @game_status, @rating, @playtime_seconds, @last_played_at,
     CASE WHEN @is_completed = 1 THEN @completed_at ELSE NULL END)
  ON CONFLICT(external_id, type) DO UPDATE SET
    title            = COALESCE(media_items.title, excluded.title),
    cover_url        = COALESCE(media_items.cover_url, excluded.cover_url),
    year             = COALESCE(media_items.year, excluded.year),
    genre            = COALESCE(media_items.genre, excluded.genre),
    creators         = COALESCE(excluded.creators, media_items.creators),
    publisher        = COALESCE(excluded.publisher, media_items.publisher),
    library          = COALESCE(excluded.library, media_items.library),
    status           = excluded.status,
    game_status      = excluded.game_status,
    rating           = CASE WHEN excluded.rating > 0 THEN excluded.rating ELSE media_items.rating END,
    playtime_seconds = excluded.playtime_seconds,
    last_played_at   = COALESCE(excluded.last_played_at, media_items.last_played_at),
    completed_at     = CASE WHEN @is_completed = 1 THEN COALESCE(media_items.completed_at, @completed_at) ELSE media_items.completed_at END,
    updated_at       = datetime('now')
`)
const getMediaId = db.prepare("SELECT id FROM media_items WHERE external_id = ? AND type = 'game'")
const setMediaRating = db.prepare(`
  UPDATE media_items SET rating = ?, updated_at = datetime('now')
  WHERE external_id = ? AND type = 'game'
`)
const insertActivity = db.prepare(`
  INSERT OR IGNORE INTO activity_events
    (source, event_type, media_type, external_ref, title, subtitle, cover_url, rating, duration_ms, genre, occurred_at, raw)
  VALUES (@source, @event_type, 'game', @external_ref, @title, NULL, @cover_url, @rating, NULL, @genre, @occurred_at, NULL)
`)
const insertDiary = db.prepare(`
  INSERT INTO diary_entries (media_item_id, watched_at, rating, comment, source)
  VALUES (?, ?, ?, NULL, 'playnite')
`)

export function ensurePlayniteSecret(): string {
  return ensureSecret('PLAYNITE_WEBHOOK_SECRET')
}

function readState(): PlayniteState {
  try { return JSON.parse(cfg('PLAYNITE_STATE') || '{}') as PlayniteState } catch { return {} }
}

function writeState(state: PlayniteState): void {
  setCfg('PLAYNITE_STATE', JSON.stringify(state))
}

app.post('/playnite/webhook', async (c) => {
  const token = c.req.query('token')
  const secret = cfg('PLAYNITE_WEBHOOK_SECRET')
  if (secret && token !== secret) return c.json({ error: 'unauthorized' }, 401)
  if (cfg('PLAYNITE_ENABLED') !== '1') return c.json({ ok: true })

  let payload: PlaynitePayload
  try { payload = (await c.req.json()) as PlaynitePayload } catch { return c.json({ error: 'bad payload' }, 400) }

  const gameId = (payload.gameId ?? '').trim()
  const name = (payload.name ?? '').trim()
  if (!gameId || !name) return c.json({ error: 'gameId and name required' }, 400)

  const playtime = Math.max(0, Math.round(payload.playtimeSeconds ?? 0))
  const gameStatus = playniteGameStatus(payload.completionStatus, playtime)
  const status = GAME_STATUS_TO_BASE[gameStatus]
  const rating = playniteRating(payload.userScore)
  const nowIso = new Date().toISOString()

  let lastPlayedIso: string | null = null
  if (payload.lastPlayed) {
    const parsed = new Date(payload.lastPlayed)
    if (!Number.isNaN(parsed.getTime())) lastPlayedIso = parsed.toISOString()
  }
  const isCompleted = gameStatus === 'zerado' || gameStatus === 'platinado'

  const state = readState()
  const previous = state[gameId]
  let externalId = previous?.externalId
  let coverUrl: string | null = null
  let year: number | null = payload.releaseYear ?? null
  let genre: string | null = null

  if (!externalId) {
    const rawg = await rawgLookup(name).catch(() => null)
    if (rawg) {
      externalId = rawg.external_id
      coverUrl = rawg.cover_url
      year = rawg.year ?? year
      genre = rawg.genre
    } else {
      externalId = `playnite:${gameId}`
    }
  }

  upsertGame.run({
    external_id: externalId,
    title: name,
    cover_url: coverUrl,
    year,
    genre,
    creators: joinPlayniteNames(payload.developers),
    publisher: joinPlayniteNames(payload.publishers),
    library: (payload.library ?? '').trim() || null,
    status,
    game_status: gameStatus,
    rating,
    playtime_seconds: playtime || null,
    last_played_at: lastPlayedIso,
    is_completed: isCompleted ? 1 : 0,
    completed_at: lastPlayedIso ?? nowIso,
  })
  const row = getMediaId.get(externalId) as { id: number } | undefined
  if (!row) return c.json({ ok: true })

  const wasCompleted = previous?.gameStatus === 'zerado' || previous?.gameStatus === 'platinado'
  if (isCompleted && !wasCompleted) {
    insertActivity.run({
      source: 'playnite', event_type: 'played', external_ref: externalId, title: name,
      cover_url: coverUrl, rating: rating || null, genre, occurred_at: lastPlayedIso ?? nowIso,
    })
    insertDiary.run(row.id, lastPlayedIso ?? nowIso, rating || null)
    notifyLibraryActivity({ event: 'completed', type: 'game', title: name, rating: rating || null })
  } else if (!previous && gameStatus === 'jogando') {
    insertActivity.run({
      source: 'playnite', event_type: 'playing', external_ref: externalId, title: name,
      cover_url: coverUrl, rating: null, genre, occurred_at: lastPlayedIso ?? nowIso,
    })
    notifyLibraryActivity({ event: 'in_progress', type: 'game', title: name })
  }

  if (rating > 0 && previous && previous.rating !== rating) {
    setMediaRating.run(rating, externalId)
    insertActivity.run({
      source: 'playnite', event_type: 'rate', external_ref: externalId, title: name,
      cover_url: coverUrl, rating, genre, occurred_at: nowIso,
    })
    notifyLibraryActivity({ event: 'rated', type: 'game', title: name, rating })
  }

  state[gameId] = { externalId, gameStatus, rating, playtime }
  writeState(state)
  return c.json({ ok: true })
})

app.post('/playnite/test', async (c) => {
  const rawg = await rawgLookup('The Witcher 3').catch(() => null)
  if (!rawg) {
    return c.json({
      ok: false,
      error: 'A extensão registra os jogos, mas as capas ficam vazias: configure a RAWG_API_KEY para o Shelf buscar capa/gênero por nome.',
    }, 400)
  }
  return c.json({ ok: true })
})

export default app
