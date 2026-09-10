import { Hono } from 'hono'
import { db } from '../db.js'
import { sendTelegram, telegramDetectChats } from '../notify.js'
import { backlogGames } from '../prices/repository.js'
import { syncState } from '../prices/sync.js'
import * as steamClient from '../steam/client.js'
import { lastSync as steamLastSync, syncRunning as steamSyncRunning } from '../steam/sync.js'
import { cfg, setCfg } from '../integrations/config.js'
import type { NowPlaying } from '../integrations/now-playing.js'
import kavitaIntegrationRoutes, { pollKavita, resetKavitaAuth } from './integrations/kavita.js'
import lastfmIntegrationRoutes, { getLastfmNowPlaying, pollLastfm } from './integrations/lastfm.js'
import playniteIntegrationRoutes, { ensurePlayniteSecret } from './integrations/playnite.js'
import plexLibraryIntegrationRoutes from './integrations/plex-library.js'
import plexLiveIntegrationRoutes, { getPlexNowPlaying, pollPlexSessions } from './integrations/plex-live.js'
import plexWebhookIntegrationRoutes, { ensurePlexWebhookSecret } from './integrations/plex-webhook.js'
import priceIntegrationRoutes from './integrations/prices.js'
import steamIntegrationRoutes from './integrations/steam.js'

const app = new Hono()
app.route('/', kavitaIntegrationRoutes)
app.route('/', lastfmIntegrationRoutes)
app.route('/', playniteIntegrationRoutes)
app.route('/', plexLibraryIntegrationRoutes)
app.route('/', plexLiveIntegrationRoutes)
app.route('/', plexWebhookIntegrationRoutes)
app.route('/', priceIntegrationRoutes)
app.route('/', steamIntegrationRoutes)

/* ─────────────────────────────────────── Loops ────────────────────────────────────── */

let plexBusy = false
let lastfmBusy = false
let kavitaBusy = false
let pollTimers: NodeJS.Timeout[] = []
const activePolls = new Set<Promise<void>>()

function runPoll(name: 'plex' | 'lastfm' | 'kavita', poll: () => Promise<void>): void {
  const busy = name === 'plex' ? plexBusy : name === 'lastfm' ? lastfmBusy : kavitaBusy
  if (busy) return
  if (name === 'plex') plexBusy = true
  else if (name === 'lastfm') lastfmBusy = true
  else kavitaBusy = true

  let task: Promise<void>
  task = poll()
    .catch(error => console.error(`[${name}] poll falhou:`, error))
    .finally(() => {
      if (name === 'plex') plexBusy = false
      else if (name === 'lastfm') lastfmBusy = false
      else kavitaBusy = false
      activePolls.delete(task)
    })
  activePolls.add(task)
}

/** Polling só começa no bootstrap do servidor, nunca como efeito colateral do import da rota. */
export function startIntegrationPolling(): void {
  if (pollTimers.length) return
  const every = (ms: number, run: () => void) => {
    const timer = setInterval(run, ms)
    timer.unref()
    pollTimers.push(timer)
  }
  every(5_000, () => runPoll('plex', pollPlexSessions))
  every(30_000, () => runPoll('lastfm', pollLastfm))
  every(60_000, () => runPoll('kavita', pollKavita))
}

/** Para novos polls e aguarda os que já estavam falando com os provedores. */
export async function stopIntegrationPolling(): Promise<void> {
  for (const timer of pollTimers) clearInterval(timer)
  pollTimers = []
  await Promise.allSettled([...activePolls])
}

/* ─────────────────────────────────────── API REST ─────────────────────────────────── */

// Status + configuração (segredos mascarados)
app.get('/', (c) => {
  const secret = ensurePlexWebhookSecret()
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
    playnite: {
      enabled: cfg('PLAYNITE_ENABLED') === '1',
      webhook_secret: ensurePlayniteSecret(),
    },
    steam: {
      enabled:          cfg('STEAM_ENABLED') === '1',
      steam_id:         cfg('STEAM_ID'),
      api_key_set:      !!cfg('STEAM_API_KEY'),
      api_key_masked:   mask(cfg('STEAM_API_KEY')),
      cookie_set:       steamClient.steamCanWrite(),
      login_secure_set: !!cfg('STEAM_LOGIN_SECURE'),
      session_id_set:   !!cfg('STEAM_SESSION_ID'),
      session_id_masked: mask(cfg('STEAM_SESSION_ID')),
      sync_mode:        (cfg('STEAM_SYNC_MODE') || 'both') as 'pull' | 'push' | 'both',
      sync_removals:    cfg('STEAM_SYNC_REMOVALS') === '1',
      running:          steamSyncRunning(),
      last_sync:        steamLastSync(),
    },
    prices: {
      enabled:        cfg('ITAD_ENABLED') === '1',
      api_key_set:    !!cfg('ITAD_API_KEY'),
      api_key_masked: mask(cfg('ITAD_API_KEY')),
      country:        cfg('ITAD_COUNTRY') || 'BR',
      tracked:        backlogGames().length,
      last_sync:      syncState().last_run?.at ?? null,
      running:        syncState().running,
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
    ['PLAYNITE_ENABLED', bool(b.playnite_enabled)],
    ['ITAD_ENABLED', bool(b.itad_enabled)],
    ['ITAD_COUNTRY', str(b.itad_country)?.toUpperCase().slice(0, 2)],
    ['STEAM_ENABLED', bool(b.steam_enabled)],
    ['STEAM_ID', str(b.steam_id)],
    ['STEAM_SYNC_MODE', ['pull', 'push', 'both'].includes(String(b.steam_sync_mode)) ? String(b.steam_sync_mode) : undefined],
    ['STEAM_SYNC_REMOVALS', bool(b.steam_sync_removals)],
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
  const itadKey = str(b.itad_api_key)
  if (itadKey !== undefined && itadKey !== '') setCfg('ITAD_API_KEY', itadKey)
  if (b.itad_api_key_clear === true) setCfg('ITAD_API_KEY', '')
  const steamKey = str(b.steam_api_key)
  if (steamKey !== undefined && steamKey !== '') setCfg('STEAM_API_KEY', steamKey)
  if (b.steam_api_key_clear === true) setCfg('STEAM_API_KEY', '')
  const steamCookie = str(b.steam_login_secure)
  if (steamCookie !== undefined && steamCookie !== '') setCfg('STEAM_LOGIN_SECURE', steamCookie)
  const steamSession = str(b.steam_session_id)
  if (steamSession !== undefined && steamSession !== '') setCfg('STEAM_SESSION_ID', steamSession)
  if (b.steam_cookies_clear === true) {
    setCfg('STEAM_LOGIN_SECURE', '')
    setCfg('STEAM_SESSION_ID', '')
  }
  // credenciais do Kavita podem ter mudado → força re-autenticação no próximo ciclo
  resetKavitaAuth()

  // reflete mudanças imediatamente na barra ao vivo
  pollPlexSessions().catch(() => {})
  return c.json({ ok: true })
})

// Tocando agora (Plex com progresso; música sem posição)
app.get('/now-playing', (c) => {
  const stale = (n: NowPlaying | null) => (n && Date.now() - n.updated_at < 60000 ? n : null)
  return c.json({ plex: stale(getPlexNowPlaying()), music: stale(getLastfmNowPlaying()) })
})

// Feed de atividade
app.get('/activity', (c) => {
  const limit = Math.min(parseInt(c.req.query('limit') ?? '30'), 500)
  const source = c.req.query('source')
  const mediaType = c.req.query('media_type')
  // `raw` é útil só para diagnóstico no servidor; o feed recebe apenas os
  // campos normalizados que o frontend realmente usa.
  let sql = `SELECT id, source, event_type, media_type, external_ref, title,
                    subtitle, cover_url, rating, duration_ms, genre, occurred_at
               FROM activity_events WHERE 1=1`
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

/* ─── "Em alta no público": trending externo (TMDB + RAWG + Last.fm) ─── */
interface TrendingItem {
  type: 'movie' | 'series' | 'game' | 'music'
  title: string
  subtitle: string | null
  cover_url: string | null
  metric: string
  metric_label: string
  external_id: string | null
}

let trendingCache: { at: number; items: TrendingItem[] } | null = null

async function fetchTrending(): Promise<TrendingItem[]> {
  const tmdb = cfg('TMDB_API_KEY')
  const rawg = cfg('RAWG_API_KEY')
  const lastfm = cfg('LASTFM_API_KEY')

  const jobs: Promise<TrendingItem[]>[] = []

  if (tmdb) {
    jobs.push((async () => {
      const r = await fetch(`https://api.themoviedb.org/3/trending/movie/week?api_key=${tmdb}`)
      if (!r.ok) return []
      const d = await r.json() as { results: any[] }
      return d.results.slice(0, 3).map(m => ({
        type: 'movie' as const, title: m.title, subtitle: m.release_date ? String(new Date(m.release_date).getFullYear()) : null,
        cover_url: m.backdrop_path ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}` : (m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null),
        metric: String(Math.round(m.popularity ?? 0)), metric_label: 'popularidade TMDB', external_id: String(m.id),
      }))
    })())
    jobs.push((async () => {
      const r = await fetch(`https://api.themoviedb.org/3/trending/tv/week?api_key=${tmdb}`)
      if (!r.ok) return []
      const d = await r.json() as { results: any[] }
      return d.results.slice(0, 3).map(m => ({
        type: 'series' as const, title: m.name, subtitle: m.first_air_date ? String(new Date(m.first_air_date).getFullYear()) : null,
        cover_url: m.backdrop_path ? `https://image.tmdb.org/t/p/w780${m.backdrop_path}` : (m.poster_path ? `https://image.tmdb.org/t/p/w500${m.poster_path}` : null),
        metric: String(Math.round(m.popularity ?? 0)), metric_label: 'popularidade TMDB', external_id: String(m.id),
      }))
    })())
  }

  if (rawg) {
    jobs.push((async () => {
      const r = await fetch(`https://api.rawg.io/api/games?key=${rawg}&ordering=-added&page_size=3`)
      if (!r.ok) return []
      const d = await r.json() as { results: any[] }
      return d.results.slice(0, 3).map(g => ({
        type: 'game' as const, title: g.name, subtitle: g.released ? String(new Date(g.released).getFullYear()) : null,
        cover_url: g.background_image ?? null,
        metric: g.added != null ? g.added.toLocaleString('pt-BR') : String(g.rating ?? ''), metric_label: 'na coleção RAWG', external_id: String(g.id),
      }))
    })())
  }

  if (lastfm) {
    jobs.push((async () => {
      const r = await fetch(`https://ws.audioscrobbler.com/2.0/?method=chart.gettoptracks&api_key=${lastfm}&format=json&limit=3`)
      if (!r.ok) return []
      const d = await r.json() as { tracks?: { track: any[] } }
      return (d.tracks?.track ?? []).slice(0, 3).map((t, i) => ({
        type: 'music' as const, title: t.name, subtitle: t.artist?.name ?? null,
        cover_url: (t.image?.find((im: any) => im.size === 'extralarge')?.['#text']) || null,
        metric: `#${i + 1}`, metric_label: 'charts Last.fm', external_id: t.mbid || null,
      }))
    })())
  }

  const settled = await Promise.allSettled(jobs)
  const groups = settled.filter((s): s is PromiseFulfilledResult<TrendingItem[]> => s.status === 'fulfilled').map(s => s.value)
  // Intercala os grupos (1 de cada tipo por rodada) pra variar o carrossel.
  const out: TrendingItem[] = []
  for (let i = 0; out.length < 8 && groups.some(g => g[i]); i++) {
    for (const g of groups) if (g[i]) out.push(g[i])
  }
  return out
}

app.get('/trending', async (c) => {
  if (trendingCache && Date.now() - trendingCache.at < 3_600_000) return c.json(trendingCache.items)
  try {
    const items = await fetchTrending()
    if (items.length) trendingCache = { at: Date.now(), items }
    return c.json(items)
  } catch {
    return c.json(trendingCache?.items ?? [])
  }
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
