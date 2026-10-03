/**
 * Tempo para zerar via IGDB (ST-04).
 *
 * A IGDB usa o login de aplicação da Twitch (Client ID + Client Secret,
 * gratuitos, configurados em Integrações). O token dura ~60 dias e fica em
 * `IGDB_TOKEN`. O jogo é encontrado pelo AppID da Steam (`external_games`, fonte
 * 1 = Steam) e o tempo vem de `game_time_to_beats`, em segundos:
 * - `hastily`: só a história principal;
 * - `normally`: história + extras;
 * - `completely`: 100%.
 *
 * A IGDB limita a 4 requisições por segundo; o job anda devagar de propósito.
 */
import { db } from './db.js'
import { cfg, setCfg } from './integrations/config.js'
import { PerUser } from './user-state.js'

const API = 'https://api.igdb.com/v4'
const STEAM_SOURCE = 1
const TTL_MS = 30 * 24 * 3_600_000
const MIN_INTERVAL_MS = 300

export function igdbConfigured(): boolean {
  return !!cfg('IGDB_CLIENT_ID') && !!cfg('IGDB_CLIENT_SECRET')
}

export class IgdbError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'IgdbError'
  }
}

async function token(fetchImpl: typeof fetch): Promise<string> {
  try {
    const cached = JSON.parse(cfg('IGDB_TOKEN') || 'null') as { token: string; expiresAt: number } | null
    if (cached && cached.expiresAt - Date.now() > 24 * 3_600_000) return cached.token
  } catch { /* token ilegível: pede outro */ }

  const qs = new URLSearchParams({
    client_id: cfg('IGDB_CLIENT_ID'),
    client_secret: cfg('IGDB_CLIENT_SECRET'),
    grant_type: 'client_credentials',
  })
  const res = await fetchImpl(`https://id.twitch.tv/oauth2/token?${qs}`, { method: 'POST' })
  if (!res.ok) throw new IgdbError('A Twitch recusou o Client ID/Secret da IGDB.', res.status)
  const data = await res.json() as { access_token?: string; expires_in?: number }
  if (!data.access_token) throw new IgdbError('A Twitch não devolveu o token da IGDB.')
  setCfg('IGDB_TOKEN', JSON.stringify({ token: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 0) * 1000 }))
  return data.access_token
}

let lastCall = 0
async function query<T>(endpoint: string, body: string, fetchImpl: typeof fetch): Promise<T> {
  const wait = lastCall + MIN_INTERVAL_MS - Date.now()
  if (wait > 0) await new Promise(resolve => setTimeout(resolve, wait))
  lastCall = Date.now()

  const send = async (bearer: string) => fetchImpl(`${API}/${endpoint}`, {
    method: 'POST',
    headers: { 'Client-ID': cfg('IGDB_CLIENT_ID'), Authorization: `Bearer ${bearer}`, Accept: 'application/json' },
    body,
  })
  let res = await send(await token(fetchImpl))
  if (res.status === 401) {
    setCfg('IGDB_TOKEN', '') // token revogado/expirado antes da hora
    res = await send(await token(fetchImpl))
  }
  if (!res.ok) throw new IgdbError(`IGDB respondeu ${res.status} em ${endpoint}`, res.status)
  return await res.json() as T
}

export interface TimeToBeat {
  igdbId: number | null
  main: number | null
  extra: number | null
  complete: number | null
}

const positive = (v: unknown) => (typeof v === 'number' && v > 0 ? Math.round(v) : null)

/** Tempo para zerar de um jogo da Steam; `igdbId` nulo quando a IGDB não conhece o AppID. */
export async function timeToBeatForSteamApp(appid: number, fetchImpl: typeof fetch = fetch): Promise<TimeToBeat> {
  const external = await query<{ game?: number; external_game_source?: number }[]>(
    'external_games',
    `fields game,external_game_source; where uid = "${appid}" & external_game_source = ${STEAM_SOURCE}; limit 1;`,
    fetchImpl,
  )
  const igdbId = external[0]?.game ?? null
  if (!igdbId) return { igdbId: null, main: null, extra: null, complete: null }

  const times = await query<{ hastily?: number; normally?: number; completely?: number }[]>(
    'game_time_to_beats',
    `fields hastily,normally,completely; where game_id = ${igdbId}; limit 1;`,
    fetchImpl,
  )
  const t = times[0] ?? {}
  return { igdbId, main: positive(t.hastily), extra: positive(t.normally), complete: positive(t.completely) }
}

const saveTimes = db.prepare(`
  UPDATE media_items SET
    igdb_id = COALESCE(@igdb_id, igdb_id),
    ttb_main_seconds = @main, ttb_extra_seconds = @extra, ttb_complete_seconds = @complete,
    ttb_fetched_at = @fetched_at
  WHERE id = @id
`)

/** Busca e grava o tempo de um jogo (usado pela página de jogo e pelo job). */
export async function refreshTimeToBeat(mediaId: number, appid: number, fetchImpl: typeof fetch = fetch): Promise<TimeToBeat> {
  const result = await timeToBeatForSteamApp(appid, fetchImpl)
  saveTimes.run({ id: mediaId, igdb_id: result.igdbId, main: result.main, extra: result.extra, complete: result.complete, fetched_at: new Date().toISOString() })
  return result
}

export function timeToBeatIsStale(fetchedAt: string | null, now = Date.now()): boolean {
  return !fetchedAt || now - Date.parse(fetchedAt) > TTL_MS
}

export interface TimeToBeatSyncResult { at: string; checked: number; found: number; errors: string[] }

const running = new PerUser<Promise<TimeToBeatSyncResult> | null>(() => null)
let aborted = false

/** Completa o tempo para zerar dos jogos com AppID que nunca foram consultados ou estão velhos. */
export function syncTimeToBeat(limit = 200, fetchImpl: typeof fetch = fetch): Promise<TimeToBeatSyncResult> {
  const existing = running.get()
  if (existing) return existing
  aborted = false
  const task = (async () => {
    const result: TimeToBeatSyncResult = { at: new Date().toISOString(), checked: 0, found: 0, errors: [] }
    if (!igdbConfigured()) return result
    const games = db.prepare(`
      SELECT id, steam_appid, ttb_fetched_at FROM media_items
       WHERE type = 'game' AND steam_appid IS NOT NULL
       ORDER BY (ttb_fetched_at IS NOT NULL), ttb_fetched_at, id
    `).all() as { id: number; steam_appid: number; ttb_fetched_at: string | null }[]
    for (const game of games.filter(g => timeToBeatIsStale(g.ttb_fetched_at)).slice(0, limit)) {
      if (aborted) break
      try {
        const times = await refreshTimeToBeat(game.id, game.steam_appid, fetchImpl)
        result.checked++
        if (times.main || times.extra || times.complete) result.found++
      } catch (e) {
        result.errors.push((e as Error).message)
        if (e instanceof IgdbError && (e.status === 400 || e.status === 401 || e.status === 403)) break
      }
    }
    setCfg('IGDB_LAST_SYNC', JSON.stringify(result))
    return result
  })().finally(() => { running.set(null) })
  running.set(task)
  return task
}

export function lastTimeToBeatSync(): TimeToBeatSyncResult | null {
  try { return JSON.parse(cfg('IGDB_LAST_SYNC') || 'null') } catch { return null }
}

export async function stopTimeToBeatSync(): Promise<void> {
  aborted = true
  await Promise.allSettled(running.all())
}
