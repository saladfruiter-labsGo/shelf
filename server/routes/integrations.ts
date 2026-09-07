import { Hono } from 'hono'
import { randomUUID } from 'crypto'
import { db } from '../db.js'
import { sendTelegram, telegramDetectChats, notifyLibraryActivity } from '../notify.js'
import { ensureSeriesStructure, setEpisodeWatched, tmdbIdFromGuid } from '../series.js'

const app = new Hono()

/* ────────────────────────── Config (persistida no settings) ───────────────────────── */

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
const setSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value'
)
const delSetting = db.prepare('DELETE FROM settings WHERE key = ?')

function cfg(key: string): string {
  // Prioridade: valor salvo na UI (settings) → variável de ambiente (.env) → vazio.
  // Unifica o acesso às integrações (Last.fm, Plex, Kavita, ...) num só ponto,
  // igual ao padrão já usado em search.ts/series.ts/details.ts.
  const row = getSetting.get(key) as { value: string } | undefined
  return row?.value?.trim() || process.env[key] || ''
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

/** Registra no diário cada vez que um filme/episódio é assistido (scrobble) no Plex. */
const insertDiaryEntry = db.prepare(`
  INSERT INTO diary_entries (media_item_id, watched_at, rating, comment, source)
  VALUES (?, ?, NULL, ?, 'plex')
`)

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

  // Cada episódio assistido também vira um registro no diário (fica visível no
  // histórico, junto com filmes/livros), identificado por temporada/episódio.
  const label = `T${meta.parentIndex}E${meta.index}${meta.title ? ` – ${meta.title}` : ''}`
  insertDiaryEntry.run(row.id, occurredAt, label)
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
      // Cada vez que um filme é assistido vira um registro no diário (permite
      // registrar a mesma mídia várias vezes). Música fica de fora para não
      // inundar o diário com scrobbles.
      if (m.kind === 'movie') {
        const row = getMediaId.get(m.external_ref, 'movie') as { id: number } | undefined
        if (row) insertDiaryEntry.run(row.id, now, null)
      }
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
      const uts = parseInt(t.date.uts)
      // Avança o cursor faixa a faixa (mesmo se a gravação falhar) para que um
      // único scrobble problemático não trave a importação de todos os seguintes.
      if (uts > maxUts) maxUts = uts

      const name = t.name as string | undefined
      if (!name) continue // scrobble sem título → nada a registrar

      try {
        const artist = t.artist?.['#text'] ?? t.artist?.name ?? 'Desconhecido'
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
      } catch (e) {
        console.error(`[lastfm] falha ao registrar scrobble "${name}":`, e)
      }
    }
    if (maxUts > lastUts) setCfg('LASTFM_LAST_UTS', String(maxUts))
  } catch (e) {
    console.error('[lastfm] poll falhou:', e)
  }
}

function pickImage(images: any): string | null {
  if (!Array.isArray(images)) return null
  const large = images.find((i: any) => i.size === 'extralarge') ?? images[images.length - 1]
  const u = large?.['#text']
  return u && !u.includes('2a96cbd8b46e442fc41c2b86b821562f') ? u : null // ignora placeholder do Last.fm
}

/* ──────────────────────────────── Kavita: livros (polling) ─────────────────────────── */

interface KavitaSeries {
  id: number
  name: string
  pages: number
  pagesRead: number
  userRating: number
  hasUserRated: boolean
  latestReadDate: string | null
  libraryId: number
}

/** Upsert de livro sem forçar conclusão (usado para 'in_progress' e como base do 'completed'). */
const upsertBookProgress = db.prepare(`
  INSERT INTO media_items (external_id, type, title, cover_url, author, status, rating, pages_total, pages_read)
  VALUES (@external_id, 'book', @title, @cover_url, @author, @status, @rating, @pages_total, @pages_read)
  ON CONFLICT(external_id, type) DO UPDATE SET
    title       = COALESCE(media_items.title, excluded.title),
    cover_url   = COALESCE(media_items.cover_url, excluded.cover_url),
    author      = COALESCE(excluded.author, media_items.author),
    -- nunca rebaixa um livro já concluído de volta para 'in_progress'
    status      = CASE WHEN media_items.status = 'completed' AND excluded.status = 'in_progress'
                      THEN media_items.status ELSE excluded.status END,
    rating      = CASE WHEN excluded.rating > 0 THEN excluded.rating ELSE media_items.rating END,
    pages_total = excluded.pages_total,
    pages_read  = excluded.pages_read,
    updated_at  = datetime('now')
`)

/** Marca a conclusão preservando o completed_at original. */
const completeBook = db.prepare(`
  UPDATE media_items SET status = 'completed',
    completed_at = COALESCE(completed_at, @completed_at),
    updated_at = datetime('now')
  WHERE external_id = @external_id AND type = 'book'
`)

const insertDiaryKavita = db.prepare(`
  INSERT INTO diary_entries (media_item_id, watched_at, rating, comment, source)
  VALUES (?, ?, ?, NULL, 'kavita')
`)

const getBookRow = db.prepare(`SELECT id, author FROM media_items WHERE external_id = ? AND type = 'book'`)

type KavitaState = Record<string, { status: string; pagesRead: number; rating: number }>
function readKavitaState(): KavitaState {
  try { return JSON.parse(cfg('KAVITA_STATE') || '{}') } catch { return {} }
}
function writeKavitaState(s: KavitaState) { setCfg('KAVITA_STATE', JSON.stringify(s)) }

let kavitaToken: string | null = null
function kavitaBase(): string { return cfg('KAVITA_URL').replace(/\/$/, '') }

/** Troca a API key por um JWT (fluxo de plugin do Kavita). */
async function kavitaAuth(): Promise<boolean> {
  const base = kavitaBase()
  const key = cfg('KAVITA_API_KEY')
  if (!base || !key) { kavitaToken = null; return false }
  try {
    const r = await fetch(`${base}/api/Plugin/authenticate?apiKey=${encodeURIComponent(key)}&pluginName=Shelf`, {
      method: 'POST', headers: { Accept: 'application/json' },
    })
    if (!r.ok) { kavitaToken = null; return false }
    const d = (await r.json()) as { token?: string }
    kavitaToken = d?.token ?? null
    return !!kavitaToken
  } catch { kavitaToken = null; return false }
}

/** fetch autenticado no Kavita, com re-auth automático em 401. */
async function kavitaFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response | null> {
  if (!kavitaToken && !(await kavitaAuth())) return null
  const headers = {
    ...(init.headers ?? {}),
    Authorization: `Bearer ${kavitaToken}`,
    Accept: (init.headers as Record<string, string> | undefined)?.Accept ?? 'application/json',
  }
  let r: Response
  try { r = await fetch(`${kavitaBase()}${path}`, { ...init, headers }) } catch { return null }
  if (r.status === 401 && retry) {
    kavitaToken = null
    if (await kavitaAuth()) return kavitaFetch(path, init, false)
    return null
  }
  return r
}

/** Busca todas as séries (com progresso do usuário) via all-v2, paginando. */
async function kavitaAllSeries(): Promise<KavitaSeries[]> {
  const out: KavitaSeries[] = []
  const size = 200
  for (let page = 1; page <= 25; page++) {
    const r = await kavitaFetch(`/api/Series/all-v2?PageNumber=${page}&PageSize=${size}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    if (!r || !r.ok) break
    let arr: KavitaSeries[]
    try { arr = (await r.json()) as KavitaSeries[] } catch { break }
    if (!Array.isArray(arr) || arr.length === 0) break
    out.push(...arr)
    if (arr.length < size) break
  }
  return out
}

/** Autor (writer) da série — buscado sob demanda quando ainda não temos. */
async function kavitaAuthor(seriesId: number): Promise<string | null> {
  const r = await kavitaFetch(`/api/Series/metadata?seriesId=${seriesId}`)
  if (!r || !r.ok) return null
  try {
    const d = (await r.json()) as { writers?: { name: string }[] }
    return d?.writers?.[0]?.name ?? null
  } catch { return null }
}

/** Normaliza a nota do Kavita para a escala 0–5 (meio-ponto) do Shelf. */
function kavitaRating(s: KavitaSeries): number {
  if (!s.hasUserRated || !s.userRating) return 0
  let v = s.userRating
  if (v > 5) v = v / 20 // tolera escala 0–100 de versões antigas
  return Math.round(v * 2) / 2
}

async function pollKavita(): Promise<void> {
  if (cfg('KAVITA_ENABLED') !== '1' || !cfg('KAVITA_URL') || !cfg('KAVITA_API_KEY')) return
  const libFilter = cfg('KAVITA_LIBRARY_ID').trim()
  const series = await kavitaAllSeries()
  if (!series.length) return

  const state = readKavitaState()
  for (const s of series) {
    if (libFilter && String(s.libraryId) !== libFilter) continue
    const pages = s.pages ?? 0
    const read = s.pagesRead ?? 0
    if (read <= 0) continue // não importa livros ainda não iniciados

    const status: 'in_progress' | 'completed' = pages > 0 && read >= pages ? 'completed' : 'in_progress'
    const rating = kavitaRating(s)
    const externalId = `kavita:${s.id}`
    const nowIso = new Date().toISOString()
    const occurredAt = s.latestReadDate
      ? new Date(s.latestReadDate + (s.latestReadDate.includes('Z') ? '' : 'Z')).toISOString()
      : nowIso
    const coverUrl = `/api/integrations/kavita/image?seriesId=${s.id}`

    // autor: só busca metadata quando ainda não temos (evita N chamadas por ciclo)
    const existing = getBookRow.get(externalId) as { id: number; author: string | null } | undefined
    let author: string | null = existing?.author ?? null
    if (!author) author = await kavitaAuthor(s.id)

    upsertBookProgress.run({
      external_id: externalId, title: s.name, cover_url: coverUrl, author, status, rating,
      pages_total: pages || null, pages_read: read,
    })
    const row = getMediaId.get(externalId, 'book') as { id: number } | undefined
    if (!row) continue

    const prev = state[String(s.id)]

    if (status === 'completed') {
      completeBook.run({ external_id: externalId, completed_at: occurredAt })
      if (prev?.status !== 'completed') {
        insertActivity.run({
          source: 'kavita', event_type: 'read', media_type: 'book',
          external_ref: externalId, title: s.name, subtitle: author,
          cover_url: coverUrl, rating: rating || null, duration_ms: null,
          genre: null, occurred_at: occurredAt, raw: null,
        })
        insertDiaryKavita.run(row.id, occurredAt, rating || null)
        notifyLibraryActivity({ event: 'completed', type: 'book', title: s.name, rating: rating || null })
      }
    } else if (!prev) {
      // primeira vez que vemos este livro em leitura
      insertActivity.run({
        source: 'kavita', event_type: 'reading', media_type: 'book',
        external_ref: externalId, title: s.name, subtitle: author,
        cover_url: coverUrl, rating: null, duration_ms: null,
        genre: null, occurred_at: occurredAt, raw: null,
      })
      notifyLibraryActivity({ event: 'in_progress', type: 'book', title: s.name })
    }

    // mudança de nota (independe do status)
    if (rating > 0 && prev && prev.rating !== rating) {
      setMediaRating.run(rating, externalId, 'book')
      insertActivity.run({
        source: 'kavita', event_type: 'rate', media_type: 'book',
        external_ref: externalId, title: s.name, subtitle: author,
        cover_url: coverUrl, rating, duration_ms: null,
        genre: null, occurred_at: nowIso, raw: null,
      })
      notifyLibraryActivity({ event: 'rated', type: 'book', title: s.name, rating })
    }

    state[String(s.id)] = { status, pagesRead: read, rating }
  }
  writeKavitaState(state)
}

/* ─────────────────────────────────────── Loops ────────────────────────────────────── */

let plexBusy = false
let lastfmBusy = false
let kavitaBusy = false
setInterval(async () => { if (plexBusy) return; plexBusy = true; await pollPlexSessions().finally(() => (plexBusy = false)) }, 5000)
setInterval(async () => { if (lastfmBusy) return; lastfmBusy = true; await pollLastfm().finally(() => (lastfmBusy = false)) }, 30000)
setInterval(async () => { if (kavitaBusy) return; kavitaBusy = true; await pollKavita().catch(() => {}).finally(() => (kavitaBusy = false)) }, 60000)

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
    kavita: {
      enabled: cfg('KAVITA_ENABLED') === '1',
      url: cfg('KAVITA_URL'),
      api_key_set: !!cfg('KAVITA_API_KEY'),
      api_key_masked: mask(cfg('KAVITA_API_KEY')),
      library_id: cfg('KAVITA_LIBRARY_ID'),
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
    ['KAVITA_ENABLED', bool(b.kavita_enabled)],
    ['KAVITA_URL', str(b.kavita_url)],
    ['KAVITA_LIBRARY_ID', str(b.kavita_library_id)],
  ]
  for (const [k, v] of map) if (v !== undefined) setCfg(k, v)
  // Tokens/segredos só são sobrescritos quando um valor novo é enviado (não apagar ao salvar mascarado)
  const tk = str(b.plex_token)
  if (tk !== undefined && tk !== '') setCfg('PLEX_TOKEN', tk)
  if (b.plex_token_clear === true) setCfg('PLEX_TOKEN', '')
  const bot = str(b.telegram_bot_token)
  if (bot !== undefined && bot !== '') setCfg('TELEGRAM_BOT_TOKEN', bot)
  const kavitaKey = str(b.kavita_api_key)
  if (kavitaKey !== undefined && kavitaKey !== '') setCfg('KAVITA_API_KEY', kavitaKey)
  if (b.kavita_api_key_clear === true) setCfg('KAVITA_API_KEY', '')
  // credenciais do Kavita podem ter mudado → força re-autenticação no próximo ciclo
  kavitaToken = null

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
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30'), 500)
  const source = c.req.query('source')
  const mediaType = c.req.query('media_type')
  let sql = 'SELECT * FROM activity_events WHERE 1=1'
  const params: unknown[] = []
  if (source)    { sql += ' AND source = ?';     params.push(source) }
  if (mediaType) { sql += ' AND media_type = ?'; params.push(mediaType) }
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

// Kavita: proxy de capa (esconde o token, browser não manda header de auth)
app.get('/kavita/image', async (c) => {
  const seriesId = c.req.query('seriesId')
  if (!seriesId || !/^\d+$/.test(seriesId)) return c.body(null, 404)
  const r = await kavitaFetch(`/api/Image/series-cover?seriesId=${seriesId}`, { headers: { Accept: 'image/*' } })
  if (!r || !r.ok) return c.body(null, 502)
  const buf = await r.arrayBuffer()
  return c.body(buf, 200, {
    'Content-Type': r.headers.get('content-type') ?? 'image/jpeg',
    'Cache-Control': 'public, max-age=86400',
  })
})

// Kavita: sincroniza livros sob demanda
app.post('/kavita/sync', async (c) => {
  await pollKavita()
  return c.json({ ok: true })
})

// Kavita: testa conexão (autentica e confirma acesso às séries)
app.post('/kavita/test', async (c) => {
  if (!cfg('KAVITA_URL') || !cfg('KAVITA_API_KEY')) {
    return c.json({ ok: false, error: 'Configure a URL e a API key primeiro (salve antes de testar).' }, 400)
  }
  kavitaToken = null
  if (!(await kavitaAuth())) {
    return c.json({ ok: false, error: 'Falha na autenticação. Verifique a URL e a API key.' }, 400)
  }
  const r = await kavitaFetch(`/api/Series/all-v2?PageNumber=1&PageSize=1`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })
  if (!r || !r.ok) {
    return c.json({ ok: false, error: 'Autenticou, mas não consegui listar séries (all-v2 falhou).' }, 400)
  }
  return c.json({ ok: true })
})

export default app
