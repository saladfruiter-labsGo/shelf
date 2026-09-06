import { Hono } from 'hono'
import { randomUUID } from 'crypto'
import { db } from '../db.js'
import { sendTelegram, telegramDetectChats } from '../notify.js'
import { ensureSeriesStructure, setEpisodeWatched, tmdbIdFromGuid } from '../series.js'

const app = new Hono()

/* ────────────────────────── Config (persistida no settings) ───────────────────────── */

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
const setSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)
const delSetting = db.prepare('DELETE FROM settings WHERE key = ?')

function cfg(key: string): string {
  const row = getSetting.get(key) as { value: string } | undefined
  return row?.value ?? ''
}
function setCfg(key: string, val: string) {
  if (val) setSetting.run(key, val)
  else delSetting.run(key)
}

/** Garante que exista um segredo para o webhook do Plex. */
function ensureWebhookSecret(): string {
  let s = cfg('PLEX_WEBHOOK_SECRET')
  if (!s) {
    s = randomUUID().replace(/-/g, '')
    setSetting.run('PLEX_WEBHOOK_SECRET', s)
  }
  return s
}

/* ────────────────────────────── Estado "tocando agora" ─────────────────────────────── */

interface NowPlaying {
  media_type: 'movie' | 'series' | 'music'
  title: string
  subtitle: string | null
  cover_url: string | null
  state: 'playing' | 'paused'
  position_ms: number | null
  duration_ms: number | null
  updated_at: number // Date.now()
}

let plexNow: NowPlaying | null = null
let musicNow: NowPlaying | null = null

/* ─────────────────────────────────── Persistência ─────────────────────────────────── */

const insertActivity = db.prepare(`
  INSERT OR IGNORE INTO activity_events
    (source, event_type, media_type, external_ref, title, subtitle, cover_url, rating, duration_ms, genre, occurred_at, raw)
  VALUES (@source, @event_type, @media_type, @external_ref, @title, @subtitle, @cover_url, @rating, @duration_ms, @genre, @occurred_at, @raw)
`)

const upsertMediaItem = db.prepare(`
  INSERT INTO media_items (external_id, type, title, cover_url, year, author, status, rating, completed_at)
  VALUES (@external_id, @type, @title, @cover_url, @year, @author, 'completed', @rating, @completed_at)
  ON CONFLICT(external_id, type) DO UPDATE SET
    status       = 'completed',
    completed_at = COALESCE(media_items.completed_at, excluded.completed_at),
    author       = COALESCE(media_items.author, excluded.author),
    cover_url    = COALESCE(media_items.cover_url, excluded.cover_url),
    rating       = CASE WHEN excluded.rating > 0 THEN excluded.rating ELSE media_items.rating END,
    updated_at   = datetime('now')
`)

const setMediaRating = db.prepare(`
  UPDATE media_items SET rating = ?, updated_at = datetime('now')
  WHERE external_id = ? AND type = ?
`)

/** Cria/atualiza a SÉRIE (não o episódio) sem forçar status 'completed'. */
const upsertSeriesShow = db.prepare(`
  INSERT INTO media_items (external_id, type, title, cover_url, year, tmdb_id, status)
  VALUES (@external_id, 'series', @title, @cover_url, @year, @tmdb_id, 'in_progress')
  ON CONFLICT(external_id, type) DO UPDATE SET
    title      = COALESCE(media_items.title, excluded.title),
    cover_url  = COALESCE(media_items.cover_url, excluded.cover_url),
    year       = COALESCE(media_items.year, excluded.year),
    tmdb_id    = COALESCE(media_items.tmdb_id, excluded.tmdb_id),
    updated_at = datetime('now')
`)
const getMediaId = db.prepare(`SELECT id FROM media_items WHERE external_id = ? AND type = ?`)

function slugify(s: string): string {
  return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/**
 * Registra um episódio assistido no Plex: encontra/cria a série, garante a
 * estrutura (temporadas/episódios via TMDB) e marca o episódio como visto.
 * A conclusão de temporada/série é recalculada em setEpisodeWatched.
 */
async function handlePlexEpisode(meta: PlexMeta, occurredAt: string): Promise<void> {
  const showTitle = meta.grandparentTitle
  if (!showTitle || meta.parentIndex == null || meta.index == null) return

  const externalId = meta.grandparentGuid
    ?? (meta.grandparentRatingKey ? `plex:${meta.grandparentRatingKey}` : `plex-show:${slugify(showTitle)}`)

  const thumb = meta.grandparentThumb ?? null
  const cover_url = thumb ? `/api/integrations/plex/image?path=${encodeURIComponent(thumb)}` : null
  const tmdb_id = tmdbIdFromGuid(meta.grandparentGuid) ?? null

  upsertSeriesShow.run({ external_id: externalId, title: showTitle, cover_url, year: meta.year ?? null, tmdb_id })
  const row = getMediaId.get(externalId, 'series') as { id: number } | undefined
  if (!row) return

  // popula temporadas/episódios na primeira vez (TMDB); tolera ausência de chave
  await ensureSeriesStructure(row.id, { guid: meta.grandparentGuid })

  setEpisodeWatched(row.id, meta.parentIndex, meta.index, true, meta.title ?? null, occurredAt)
}

/* ──────────────────────────────────── Plex: webhook ────────────────────────────────── */

interface PlexMeta {
  type?: string
  title?: string
  grandparentTitle?: string
  grandparentGuid?: string
  grandparentRatingKey?: string
  parentTitle?: string
  parentIndex?: number
  index?: number
  year?: number
  guid?: string
  ratingKey?: string
  thumb?: string
  grandparentThumb?: string
  duration?: number
  userRating?: number
}
interface PlexPayload {
  event?: string
  Account?: { title?: string }
  Metadata?: PlexMeta
}

/** Converte metadata do Plex para os campos da nossa activity. */
function mapPlex(meta: PlexMeta) {
  const kind = meta.type // movie | episode | track
  const media_type: 'movie' | 'series' | 'music' =
    kind === 'movie' ? 'movie' : kind === 'track' ? 'music' : 'series'

  let title = meta.title ?? 'Desconhecido'
  let subtitle: string | null = null

  if (kind === 'episode') {
    title = meta.grandparentTitle ?? title
    const s = meta.parentIndex != null ? `T${meta.parentIndex}` : ''
    const e = meta.index != null ? `E${meta.index}` : ''
    subtitle = [[s, e].filter(Boolean).join(''), meta.title].filter(Boolean).join(' · ') || null
  } else if (kind === 'track') {
    subtitle = meta.grandparentTitle ?? null // artista
  }

  const thumb = meta.grandparentThumb ?? meta.thumb ?? null
  const cover_url = thumb ? `/api/integrations/plex/image?path=${encodeURIComponent(thumb)}` : null
  const external_ref = meta.guid ?? (meta.ratingKey ? `plex:${meta.ratingKey}` : null)

  return { media_type, title, subtitle, cover_url, external_ref, kind }
}

app.post('/plex/webhook', async (c) => {
  const token = c.req.query('token')
  const secret = cfg('PLEX_WEBHOOK_SECRET')
  if (secret && token !== secret) return c.json({ error: 'unauthorized' }, 401)

  let payload: PlexPayload
  try {
    const body = await c.req.parseBody()
    const raw = body['payload']
    if (typeof raw !== 'string') return c.json({ ok: true }) // sem payload útil
    payload = JSON.parse(raw)
  } catch {
    return c.json({ error: 'bad payload' }, 400)
  }

  const event = payload.event ?? ''
  const meta = payload.Metadata
  if (!meta) return c.json({ ok: true })

  // Filtro opcional por usuário Plex
  const userFilter = cfg('PLEX_USER')
  if (userFilter && payload.Account?.title && payload.Account.title.toLowerCase() !== userFilter.toLowerCase()) {
    return c.json({ ok: true })
  }

  const m = mapPlex(meta)
  const now = new Date().toISOString()
  const rating5 = meta.userRating != null ? Math.round((meta.userRating / 2) * 10) / 10 : null

  // Para música, o artista (subtitle) vai para a coluna author da biblioteca
  const author = m.media_type === 'music' ? m.subtitle : null

  if (event === 'media.scrobble') {
    // Assistido/ouvido até o fim
    insertActivity.run({
      source: 'plex', event_type: 'scrobble', media_type: m.media_type,
      external_ref: m.external_ref, title: m.title, subtitle: m.subtitle,
      cover_url: m.cover_url, rating: null, duration_ms: meta.duration ?? null,
      genre: null, occurred_at: now, raw: JSON.stringify(payload).slice(0, 4000),
    })
    if (m.kind === 'episode') {
      // Episódio de série: marca só o episódio; temporada/série concluem por progresso
      await handlePlexEpisode(meta, now)
    } else if (m.external_ref) {
      // Filmes e músicas entram na biblioteca como concluídos
      upsertMediaItem.run({
        external_id: m.external_ref, type: m.media_type, title: m.title,
        cover_url: m.cover_url, year: meta.year ?? null, author, rating: 0, completed_at: now,
      })
    }
  } else if (event === 'media.rate' && rating5 != null) {
    insertActivity.run({
      source: 'plex', event_type: 'rate', media_type: m.media_type,
      external_ref: m.external_ref, title: m.title, subtitle: m.subtitle,
      cover_url: m.cover_url, rating: rating5, duration_ms: null,
      genre: null, occurred_at: now, raw: JSON.stringify(payload).slice(0, 4000),
    })
    if (m.kind === 'episode') {
      // Nota de um episódio → aplica à série (se já existir), sem forçar conclusão
      const externalId = meta.grandparentGuid
        ?? (meta.grandparentRatingKey ? `plex:${meta.grandparentRatingKey}` : null)
      if (externalId) setMediaRating.run(rating5, externalId, 'series')
    } else if (m.external_ref) {
      // cria (se novo) ou só atualiza a nota
      upsertMediaItem.run({
        external_id: m.external_ref, type: m.media_type, title: m.title,
        cover_url: m.cover_url, year: meta.year ?? null, author, rating: rating5, completed_at: now,
      })
      setMediaRating.run(rating5, m.external_ref, m.media_type)
    }
  }
  // media.play/pause/resume/stop são cobertos pelo polling de sessões (barra ao vivo)

  return c.json({ ok: true })
})

/* ──────────────────────────── Plex: proxy de capa (esconde token) ──────────────────── */

app.get('/plex/image', async (c) => {
  const path = c.req.query('path')
  const url = cfg('PLEX_URL')
  const tk = cfg('PLEX_TOKEN')
  if (!path || !url || !tk) return c.body(null, 404)
  try {
    const r = await fetch(`${url.replace(/\/$/, '')}${path}`, { headers: { 'X-Plex-Token': tk } })
    if (!r.ok) return c.body(null, 502)
    const buf = await r.arrayBuffer()
    return c.body(buf, 200, {
      'Content-Type': r.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    })
  } catch {
    return c.body(null, 502)
  }
})

/* ─────────────────────────── Plex: polling de "assistindo agora" ───────────────────── */

async function pollPlexSessions() {
  const url = cfg('PLEX_URL')
  const tk = cfg('PLEX_TOKEN')
  if (cfg('PLEX_ENABLED') !== '1' || !url || !tk) { plexNow = null; return }

  try {
    const r = await fetch(`${url.replace(/\/$/, '')}/status/sessions`, {
      headers: { 'X-Plex-Token': tk, Accept: 'application/json' },
    })
    if (!r.ok) return
    const data = (await r.json()) as any
    const sessions: any[] = data?.MediaContainer?.Metadata ?? []

    const userFilter = cfg('PLEX_USER').toLowerCase()
    const relevant = sessions.filter(s => {
      if (s.type !== 'movie' && s.type !== 'episode' && s.type !== 'track') return false
      if (userFilter && (s.User?.title ?? '').toLowerCase() !== userFilter) return false
      return true
    })
    // prioriza o que está tocando
    relevant.sort((a, b) => (a.Player?.state === 'playing' ? -1 : 1) - (b.Player?.state === 'playing' ? -1 : 1))
    const s = relevant[0]
    if (!s) { plexNow = null; return }

    const m = mapPlex(s)
    const state = s.Player?.state === 'paused' ? 'paused' : 'playing'
    plexNow = {
      media_type: m.media_type,
      title: m.title,
      subtitle: m.subtitle,
      cover_url: m.cover_url,
      state,
      position_ms: typeof s.viewOffset === 'number' ? s.viewOffset : null,
      duration_ms: typeof s.duration === 'number' ? s.duration : null,
      updated_at: Date.now(),
    }
  } catch {
    /* rede/servidor Plex fora — mantém último estado até esvaziar no próximo ciclo */
  }
}

/* ─────────────────────────────── Last.fm: sync + nowplaying ────────────────────────── */

const getTrack = db.prepare('SELECT * FROM music_tracks WHERE artist = ? AND track = ?')
const upsertTrack = db.prepare(`
  INSERT INTO music_tracks (artist, track, album, cover_url, play_count, first_played, last_played)
  VALUES (@artist, @track, @album, @cover_url, 1, @played, @played)
  ON CONFLICT(artist, track) DO UPDATE SET
    play_count  = music_tracks.play_count + 1,
    last_played = @played,
    album       = COALESCE(music_tracks.album, excluded.album),
    cover_url   = COALESCE(music_tracks.cover_url, excluded.cover_url)
`)
const enrichTrack = db.prepare(`
  UPDATE music_tracks SET duration_ms = ?, genre = ?, mbid = ?, enriched = 1 WHERE artist = ? AND track = ?
`)

async function lastfmCall(method: string, params: Record<string, string>): Promise<any> {
  const key = cfg('LASTFM_API_KEY')
  const qs = new URLSearchParams({ method, api_key: key, format: 'json', ...params })
  const r = await fetch(`https://ws.audioscrobbler.com/2.0/?${qs}`)
  if (!r.ok) throw new Error(`lastfm ${method} ${r.status}`)
  return r.json()
}

/** Busca duração (track.getInfo) e gênero (artist.getTopTags) uma única vez por faixa. */
async function ensureEnriched(artist: string, track: string): Promise<{ duration_ms: number | null; genre: string | null }> {
  const row = getTrack.get(artist, track) as any
  if (row?.enriched) return { duration_ms: row.duration_ms ?? null, genre: row.genre ?? null }

  let duration_ms: number | null = null
  let genre: string | null = null
  let mbid: string | null = null
  try {
    const info = await lastfmCall('track.getInfo', { artist, track })
    const d = parseInt(info?.track?.duration ?? '0')
    duration_ms = d > 0 ? d : null
    mbid = info?.track?.mbid || null
  } catch { /* segue sem duração */ }
  try {
    const tags = await lastfmCall('artist.getTopTags', { artist })
    genre = tags?.toptags?.tag?.[0]?.name ?? null
  } catch { /* segue sem gênero */ }

  enrichTrack.run(duration_ms, genre, mbid, artist, track)
  return { duration_ms, genre }
}

async function pollLastfm() {
  const key = cfg('LASTFM_API_KEY')
  const user = cfg('LASTFM_USER')
  if (cfg('LASTFM_ENABLED') !== '1' || !key || !user) { musicNow = null; return }

  try {
    const data = await lastfmCall('user.getRecentTracks', { user, limit: '50' })
    const tracks: any[] = data?.recenttracks?.track ?? []
    if (!tracks.length) return

    // "tocando agora" = faixa marcada com @attr.nowplaying
    const np = tracks.find(t => t['@attr']?.nowplaying === 'true')
    if (np) {
      musicNow = {
        media_type: 'music',
        title: np.name,
        subtitle: np.artist?.['#text'] ?? np.artist?.name ?? null,
        cover_url: pickImage(np.image),
        state: 'playing',
        position_ms: null, // Last.fm não expõe posição
        duration_ms: null,
        updated_at: Date.now(),
      }
    } else {
      musicNow = null
    }

    // scrobbles novos (têm date.uts) desde o último cursor
    const lastUts = parseInt(cfg('LASTFM_LAST_UTS') || '0')
    const scrobbled = tracks
      .filter(t => t.date?.uts && parseInt(t.date.uts) > lastUts)
      .sort((a, b) => parseInt(a.date.uts) - parseInt(b.date.uts))

    let maxUts = lastUts
    for (const t of scrobbled) {
      const artist = t.artist?.['#text'] ?? t.artist?.name ?? 'Desconhecido'
      const name = t.name as string
      const uts = parseInt(t.date.uts)
      const album = t.album?.['#text'] || null
      const cover = pickImage(t.image)
      const occurred = new Date(uts * 1000).toISOString()

      upsertTrack.run({ artist, track: name, album, cover_url: cover, played: occurred })
      const { duration_ms, genre } = await ensureEnriched(artist, name)

      insertActivity.run({
        source: 'lastfm', event_type: 'listen', media_type: 'music',
        external_ref: `${artist}|${name}`, title: name, subtitle: artist,
        cover_url: cover, rating: null, duration_ms, genre,
        occurred_at: occurred, raw: null,
      })
      // Scrobble do Last.fm = faixa ouvida até o fim → entra na biblioteca
      upsertMediaItem.run({
        external_id: `${artist}|${name}`, type: 'music', title: name,
        cover_url: cover, year: null, author: artist, rating: 0, completed_at: occurred,
      })
      if (uts > maxUts) maxUts = uts
    }
    if (maxUts > lastUts) setCfg('LASTFM_LAST_UTS', String(maxUts))
  } catch {
    /* falha de rede — tenta no próximo ciclo */
  }
}

function pickImage(images: any): string | null {
  if (!Array.isArray(images)) return null
  const large = images.find((i: any) => i.size === 'extralarge') ?? images[images.length - 1]
  const u = large?.['#text']
  return u && !u.includes('2a96cbd8b46e442fc41c2b86b821562f') ? u : null // ignora placeholder do Last.fm
}

/* ─────────────────────────────────────── Loops ────────────────────────────────────── */

let plexBusy = false
let lastfmBusy = false
setInterval(async () => { if (plexBusy) return; plexBusy = true; await pollPlexSessions().finally(() => (plexBusy = false)) }, 5000)
setInterval(async () => { if (lastfmBusy) return; lastfmBusy = true; await pollLastfm().finally(() => (lastfmBusy = false)) }, 30000)

/* ─────────────────────────────────────── API REST ─────────────────────────────────── */

// Status + configuração (segredos mascarados)
app.get('/', (c) => {
  const secret = ensureWebhookSecret()
  const mask = (v: string) => (v ? '••••' + v.slice(-4) : '')
  return c.json({
    plex: {
      enabled: cfg('PLEX_ENABLED') === '1',
      url: cfg('PLEX_URL'),
      token_set: !!cfg('PLEX_TOKEN'),
      token_masked: mask(cfg('PLEX_TOKEN')),
      user: cfg('PLEX_USER'),
      webhook_secret: secret,
    },
    lastfm: {
      enabled: cfg('LASTFM_ENABLED') === '1',
      api_key_set: !!cfg('LASTFM_API_KEY'),
      api_key_masked: mask(cfg('LASTFM_API_KEY')),
      user: cfg('LASTFM_USER'),
    },
    telegram: {
      enabled: cfg('TELEGRAM_ENABLED') === '1',
      bot_token_set: !!cfg('TELEGRAM_BOT_TOKEN'),
      bot_token_masked: mask(cfg('TELEGRAM_BOT_TOKEN')),
      chat_id: cfg('TELEGRAM_CHAT_ID'),
      thread_id: cfg('TELEGRAM_THREAD_ID'),
    },
  })
})

// Salvar configuração
app.patch('/', async (c) => {
  const b = (await c.req.json()) as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : undefined)
  const bool = (v: unknown) => (typeof v === 'boolean' ? (v ? '1' : '0') : undefined)

  const map: [string, string | undefined][] = [
    ['PLEX_ENABLED', bool(b.plex_enabled)],
    ['PLEX_URL', str(b.plex_url)],
    ['PLEX_USER', str(b.plex_user)],
    ['LASTFM_ENABLED', bool(b.lastfm_enabled)],
    ['LASTFM_API_KEY', str(b.lastfm_api_key)],
    ['LASTFM_USER', str(b.lastfm_user)],
    ['TELEGRAM_ENABLED', bool(b.telegram_enabled)],
    ['TELEGRAM_CHAT_ID', str(b.telegram_chat_id)],
    ['TELEGRAM_THREAD_ID', str(b.telegram_thread_id)],
  ]
  for (const [k, v] of map) if (v !== undefined) setCfg(k, v)
  // Tokens/segredos só são sobrescritos quando um valor novo é enviado (não apagar ao salvar mascarado)
  const tk = str(b.plex_token)
  if (tk !== undefined && tk !== '') setCfg('PLEX_TOKEN', tk)
  if (b.plex_token_clear === true) setCfg('PLEX_TOKEN', '')
  const bot = str(b.telegram_bot_token)
  if (bot !== undefined && bot !== '') setCfg('TELEGRAM_BOT_TOKEN', bot)

  // reflete mudanças imediatamente na barra ao vivo
  pollPlexSessions().catch(() => {})
  return c.json({ ok: true })
})

// Tocando agora (Plex com progresso; música sem posição)
app.get('/now-playing', (c) => {
  const stale = (n: NowPlaying | null) => (n && Date.now() - n.updated_at < 60000 ? n : null)
  return c.json({ plex: stale(plexNow), music: stale(musicNow) })
})

// Feed de atividade
app.get('/activity', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30'), 100)
  const source = c.req.query('source')
  let sql = 'SELECT * FROM activity_events'
  const params: unknown[] = []
  if (source) { sql += ' WHERE source = ?'; params.push(source) }
  sql += ' ORDER BY occurred_at DESC LIMIT ?'
  params.push(limit)
  return c.json(db.prepare(sql).all(...params))
})

// Estatísticas de música (total de plays, horas, gêneros, artistas)
app.get('/music/stats', (c) => {
  const totals = db.prepare(`
    SELECT COUNT(*) AS plays, COALESCE(SUM(duration_ms), 0) AS ms
    FROM activity_events WHERE source = 'lastfm'
  `).get() as { plays: number; ms: number }

  const topGenres = db.prepare(`
    SELECT genre, COUNT(*) AS n FROM activity_events
    WHERE source = 'lastfm' AND genre IS NOT NULL
    GROUP BY genre ORDER BY n DESC LIMIT 8
  `).all()

  const topArtists = db.prepare(`
    SELECT subtitle AS artist, COUNT(*) AS n FROM activity_events
    WHERE source = 'lastfm' AND subtitle IS NOT NULL
    GROUP BY subtitle ORDER BY n DESC LIMIT 8
  `).all()

  return c.json({
    plays: totals.plays,
    hours: Math.round((totals.ms / 3_600_000) * 10) / 10,
    top_genres: topGenres,
    top_artists: topArtists,
  })
})

// Sincronizar Last.fm sob demanda
app.post('/lastfm/sync', async (c) => {
  await pollLastfm()
  return c.json({ ok: true })
})

// Telegram: envia mensagem de teste com a config salva
app.post('/telegram/test', async (c) => {
  const res = await sendTelegram('✅ <b>Shelf conectado!</b>\nVocê vai receber aqui as atividades da sua biblioteca.')
  return c.json(res, res.ok ? 200 : 400)
})

// Telegram: descobre o chat_id de quem já falou com o bot (getUpdates)
app.get('/telegram/detect-chat', async (c) => {
  const chats = await telegramDetectChats()
  return c.json({ chats })
})

export default app
