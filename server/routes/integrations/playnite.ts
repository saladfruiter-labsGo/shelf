import { Hono } from 'hono'
import { db } from '../../db.js'
import { cfg, ensureSecret, setCfg } from '../../integrations/config.js'
import {
  joinPlayniteNames,
  playniteGameStatus,
  playniteRating,
  resolvePlayniteRating,
  type PlayniteRatingPolicy,
  type PlaynitePayload,
  type PlayniteState,
} from '../../integrations/playnite-domain.js'
import { recordDiaryProgress } from '../../diary-progress.js'
import { GAME_STATUS_TO_BASE } from '../../media-domain.js'
import { notifyLibraryActivity } from '../../notify.js'
import { rawgLookup } from '../search.js'
import { normalizeTitle } from '../../prices/matcher.js'
import { isHiddenGame } from '../../steam/hidden.js'

const app = new Hono()

const upsertGame = db.prepare(`
  INSERT INTO media_items
    (external_id, type, title, cover_url, year, genre, creators, publisher, library, status, game_status, game_status_source, rating, playtime_seconds, playtime_source, last_played_at, completed_at)
  VALUES
    (@external_id, 'game', @title, @cover_url, @year, @genre, @creators, @publisher, @library, @status, @game_status, 'playnite', @rating, @playtime_seconds, 'playnite', @last_played_at,
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
    game_status_source = 'playnite',
    rating           = @resolved_rating,
    -- Tempo e última vez jogada que já vêm da Steam não são sobrescritos pelo Playnite.
    playtime_seconds = CASE WHEN media_items.playtime_source = 'steam' THEN media_items.playtime_seconds ELSE excluded.playtime_seconds END,
    playtime_source  = CASE WHEN media_items.playtime_source = 'steam' THEN 'steam' ELSE 'playnite' END,
    last_played_at   = CASE WHEN media_items.playtime_source = 'steam' THEN media_items.last_played_at
                            ELSE COALESCE(excluded.last_played_at, media_items.last_played_at) END,
    completed_at     = CASE WHEN @is_completed = 1 THEN COALESCE(media_items.completed_at, @completed_at) ELSE media_items.completed_at END,
    updated_at       = datetime('now')
`)
const getMedia = db.prepare("SELECT id, rating, playtime_source FROM media_items WHERE external_id = ? AND type = 'game'")
// Card criado pela leitura da biblioteca da Steam, para o Playnite não duplicar.
const steamCreatedGames = db.prepare("SELECT external_id, title FROM media_items WHERE type = 'game' AND external_id LIKE 'steam:%'")
const insertActivity = db.prepare(`
  INSERT OR IGNORE INTO activity_events
    (source, event_type, media_type, external_ref, title, subtitle, cover_url, rating, duration_ms, genre, occurred_at, raw)
  VALUES (@source, @event_type, 'game', @external_ref, @title, NULL, @cover_url, @rating, NULL, @genre, @occurred_at, NULL)
`)
// Zerar/platinar vira um registro DE CONCLUSÃO no diário (sem campos de
// progresso), separado do snapshot diário de tempo de jogo. Retry com o mesmo
// lastPlayed não duplica; zerar de novo numa data posterior é outro registro.
const insertCompletionDiary = db.prepare(`
  INSERT INTO diary_entries (media_item_id, watched_at, rating, comment, source)
  SELECT @media_item_id, @watched_at, @rating, NULL, 'playnite'
  WHERE NOT EXISTS (
    SELECT 1 FROM diary_entries
    WHERE media_item_id = @media_item_id AND source = 'playnite'
      AND progress_unit IS NULL AND watched_at = @watched_at
  )
`)
// A nota costuma vir depois de zerar (o usuário avalia após fechar o jogo):
// completa a conclusão mais recente que ficou sem nota.
const rateCompletionDiary = db.prepare(`
  UPDATE diary_entries SET rating = @rating
  WHERE id = (
    SELECT id FROM diary_entries
    WHERE media_item_id = @media_item_id AND source = 'playnite'
      AND progress_unit IS NULL AND (rating IS NULL OR rating <= 0)
    ORDER BY watched_at DESC, id DESC
    LIMIT 1
  )
`)

/** Sem estado anterior, só conta como conclusão nova o que foi jogado há pouco. */
const FRESH_COMPLETION_MS = 48 * 60 * 60 * 1000

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
  // Programa que não é jogo (Wallpaper Engine): aceito e descartado, para a extensão não reenviar.
  if (isHiddenGame({ title: name })) return c.json({ ok: true, ignored: true })

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
  const ratingPolicy: PlayniteRatingPolicy = cfg('PLAYNITE_RATING_POLICY') === 'playnite' ? 'playnite' : 'shelf'

  const state = readState()
  const previous = state[gameId]
  let externalId = previous?.externalId
  let coverUrl: string | null = null
  let year: number | null = payload.releaseYear ?? null
  let genre: string | null = null

  if (!externalId) {
    const target = normalizeTitle(name)
    const fromSteam = (steamCreatedGames.all() as { external_id: string; title: string }[])
      .filter(game => normalizeTitle(game.title) === target)
    if (fromSteam.length === 1) externalId = fromSteam[0].external_id
  }

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

  const before = getMedia.get(externalId) as { id: number; rating: number } | undefined
  const resolvedRating = resolvePlayniteRating(before?.rating ?? 0, rating, ratingPolicy)

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
    resolved_rating: resolvedRating,
    playtime_seconds: playtime || null,
    last_played_at: lastPlayedIso,
    is_completed: isCompleted ? 1 : 0,
    completed_at: lastPlayedIso ?? nowIso,
  })
  const row = getMedia.get(externalId) as { id: number; rating: number; playtime_source: string | null } | undefined
  if (!row) return c.json({ ok: true })

  const wasCompleted = previous?.gameStatus === 'zerado' || previous?.gameStatus === 'platinado'
  const progressUpdated = lastPlayedIso
    ? previous?.lastPlayedAt !== lastPlayedIso || previous?.playtime !== playtime
    : !previous || previous.playtime !== playtime
  // Com o tempo vindo da Steam, é ela quem grava o progresso no diário (um registro por dia, não dois).
  if (progressUpdated && playtime > 0 && row.playtime_source !== 'steam') {
    recordDiaryProgress({
      mediaItemId: row.id,
      source: 'playnite',
      value: playtime,
      total: null,
      unit: 'seconds',
      rating,
      observedAt: lastPlayedIso ?? nowIso,
    })
  }

  // Na primeira vez que o Shelf vê um jogo (primeira sincronização ou estado
  // perdido), "zerado" pode ser de anos atrás: sem transição observada, só
  // entra no diário se a última sessão for recente.
  const completedAt = lastPlayedIso ?? nowIso
  const freshCompletion = previous != null || (
    lastPlayedIso != null && Date.parse(nowIso) - Date.parse(lastPlayedIso) <= FRESH_COMPLETION_MS
  )
  if (isCompleted && !wasCompleted && freshCompletion) {
    insertCompletionDiary.run({
      media_item_id: row.id, watched_at: completedAt, rating: row.rating > 0 ? row.rating : null,
    })
  }

  if (isCompleted && !wasCompleted) {
    insertActivity.run({
      source: 'playnite', event_type: 'played', external_ref: externalId, title: name,
      cover_url: coverUrl, rating: rating || null, genre, occurred_at: lastPlayedIso ?? nowIso,
    })
    notifyLibraryActivity({ event: 'completed', type: 'game', title: name, rating: row.rating || null, mediaItemId: row.id })
  } else if (!previous && gameStatus === 'jogando') {
    insertActivity.run({
      source: 'playnite', event_type: 'playing', external_ref: externalId, title: name,
      cover_url: coverUrl, rating: null, genre, occurred_at: lastPlayedIso ?? nowIso,
    })
    notifyLibraryActivity({ event: 'in_progress', type: 'game', title: name })
  }

  if (isCompleted && row.rating > 0) {
    rateCompletionDiary.run({ media_item_id: row.id, rating: row.rating })
  }

  if (rating > 0 && previous && previous.rating !== rating && before?.rating !== row.rating) {
    insertActivity.run({
      source: 'playnite', event_type: 'rate', external_ref: externalId, title: name,
      cover_url: coverUrl, rating: row.rating, genre, occurred_at: nowIso,
    })
    notifyLibraryActivity({ event: 'rated', type: 'game', title: name, rating: row.rating })
  }

  state[gameId] = { externalId, gameStatus, rating, playtime, lastPlayedAt: lastPlayedIso ?? previous?.lastPlayedAt ?? null }
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
