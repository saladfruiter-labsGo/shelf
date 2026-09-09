/**
 * Cliente da Steam.
 *
 * Duas superfícies distintas, com autenticações diferentes:
 *
 * 1. **Web API** (`api.steampowered.com`) — leitura. Biblioteca (`GetOwnedGames`)
 *    exige a API key; a wishlist (`IWishlistService/GetWishlist`) só precisa do
 *    SteamID com perfil público. É por aqui que a sincronização puxa da Steam.
 * 2. **Loja** (`store.steampowered.com`) — escrita na wishlist. Não existe
 *    endpoint de Web API para isso: só o AJAX da loja, autenticado pelos cookies
 *    da sessão do navegador (`steamLoginSecure` + `sessionid`). Sem esses
 *    cookies o conector funciona só no sentido Steam → Shelf.
 */
import { db } from '../db.js'

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?')

export function cfg(key: string): string {
  const row = getSetting.get(key) as { value: string } | undefined
  return row?.value?.trim() || process.env[key] || ''
}

export function steamEnabled(): boolean {
  return cfg('STEAM_ENABLED') === '1' && !!cfg('STEAM_ID')
}

/** Escrita na Steam só é possível com os dois cookies da sessão da loja. */
export function steamCanWrite(): boolean {
  return !!cfg('STEAM_LOGIN_SECURE') && !!cfg('STEAM_SESSION_ID')
}

export class SteamError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message)
    this.name = 'SteamError'
  }
}

const TIMEOUT_MS = 15_000

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    if (!res.ok) throw new SteamError(`Steam respondeu ${res.status} em ${new URL(url).pathname}`, res.status)
    return (await res.json()) as T
  } catch (e) {
    if (e instanceof SteamError) throw e
    throw new SteamError((e as Error).message || 'falha de rede ao falar com a Steam')
  } finally {
    clearTimeout(timer)
  }
}

/* ─────────────────────────────── Identidade ─────────────────────────────── */

/** Resolve `/id/<vanity>` para o SteamID64. Precisa da API key. */
export async function resolveVanityUrl(vanity: string): Promise<string | null> {
  const key = cfg('STEAM_API_KEY')
  if (!key || !vanity) return null
  const qs = new URLSearchParams({ key, vanityurl: vanity })
  const data = await getJson<{ response?: { success?: number; steamid?: string } }>(
    `https://api.steampowered.com/ISteamUser/ResolveVanityURL/v1/?${qs}`,
  )
  return data.response?.success === 1 ? data.response.steamid ?? null : null
}

/**
 * Aceita o que o usuário tiver em mãos: SteamID64, `/id/<vanity>`,
 * `/profiles/<id>` ou o vanity solto. Sempre devolve o SteamID64.
 */
export async function normalizeSteamId(input: string): Promise<string | null> {
  const raw = input.trim()
  if (!raw) return null
  if (/^\d{17}$/.test(raw)) return raw

  const profiles = raw.match(/profiles\/(\d{17})/)
  if (profiles) return profiles[1]

  const vanity = raw.match(/\/id\/([^/?#]+)/)?.[1] ?? (/^[\w.-]+$/.test(raw) ? raw : null)
  return vanity ? resolveVanityUrl(vanity) : null
}

/* ──────────────────────────────── Leitura ───────────────────────────────── */

export interface SteamOwnedGame {
  appid: number
  name: string
  playtime_minutes: number
  last_played_at: string | null
  cover_url: string
}

/** Biblioteca do usuário (jogos comprados). Exige API key + perfil público. */
export async function fetchOwnedGames(): Promise<SteamOwnedGame[]> {
  const key = cfg('STEAM_API_KEY')
  const steamid = cfg('STEAM_ID')
  if (!key) throw new SteamError('API key da Steam não configurada.')
  if (!steamid) throw new SteamError('SteamID não configurado.')

  const qs = new URLSearchParams({
    key, steamid, include_appinfo: '1', include_played_free_games: '1', format: 'json',
  })
  const data = await getJson<{ response?: { games?: any[] } }>(
    `https://api.steampowered.com/IPlayerService/GetOwnedGames/v0001/?${qs}`,
  )
  const games = data.response?.games
  if (!games) throw new SteamError('A Steam não retornou a biblioteca — o perfil precisa estar público (Detalhes do jogo: Público).')

  return games.map(g => ({
    appid: Number(g.appid),
    name: String(g.name ?? ''),
    playtime_minutes: Number(g.playtime_forever ?? 0),
    last_played_at: g.rtime_last_played ? new Date(g.rtime_last_played * 1000).toISOString() : null,
    cover_url: headerImage(Number(g.appid)),
  })).filter(g => g.appid > 0 && g.name)
}

export interface SteamWishlistEntry {
  appid: number
  priority: number
  added_at: string | null
}

/**
 * Wishlist do usuário. Não precisa de API key (só do perfil público), o que
 * mantém a leitura funcionando mesmo antes de o usuário gerar a chave.
 *
 * Atenção: a Steam responde `{"response":{}}` tanto para wishlist **vazia**
 * quanto para perfil **privado** — não dá para distinguir os dois pela resposta.
 * Por isso aqui os dois casos viram lista vazia, e é a sincronização que
 * protege o backlog de uma lista vazia inesperada (ver `syncSteamBacklog`).
 */
export async function fetchWishlist(): Promise<SteamWishlistEntry[]> {
  const steamid = cfg('STEAM_ID')
  if (!steamid) throw new SteamError('SteamID não configurado.')

  const key = cfg('STEAM_API_KEY')
  const qs = new URLSearchParams({ steamid })
  if (key) qs.set('key', key)

  const data = await getJson<{ response?: { items?: any[] } }>(
    `https://api.steampowered.com/IWishlistService/GetWishlist/v1/?${qs}`,
  )
  const items = data.response?.items ?? []

  return items.map(i => ({
    appid: Number(i.appid),
    priority: Number(i.priority ?? 0),
    added_at: i.date_added ? new Date(Number(i.date_added) * 1000).toISOString() : null,
  })).filter(i => i.appid > 0)
}

/** Capa horizontal da loja — não exige chave nem expira. */
export function headerImage(appid: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`
}

export interface SteamAppInfo {
  appid: number
  name: string
  cover_url: string
  year: number | null
  release_date: string | null
  genre: string | null
  developers: string | null
  publisher: string | null
  synopsis: string | null
}

/** Ficha da loja (nome, capa, gênero, data). Sem chave; um app por chamada. */
export async function fetchAppDetails(appid: number, country = 'BR'): Promise<SteamAppInfo | null> {
  const qs = new URLSearchParams({ appids: String(appid), cc: country, l: 'portuguese' })
  try {
    const data = await getJson<Record<string, { success?: boolean; data?: any }>>(
      `https://store.steampowered.com/api/appdetails?${qs}`,
    )
    const entry = data[String(appid)]
    if (!entry?.success || !entry.data) return null
    const d = entry.data
    const release: string | null = d.release_date?.date ?? null
    const year = release ? (release.match(/(\d{4})/)?.[1] ?? null) : null
    return {
      appid,
      name: String(d.name ?? ''),
      cover_url: d.header_image ?? headerImage(appid),
      year: year ? Number(year) : null,
      release_date: release,
      genre: d.genres?.[0]?.description ?? null,
      developers: (d.developers ?? []).join(', ') || null,
      publisher: (d.publishers ?? []).join(', ') || null,
      synopsis: typeof d.short_description === 'string' ? d.short_description : null,
    }
  } catch {
    return null
  }
}

/** Busca na loja pelo nome — usado para descobrir o AppID de um jogo do Shelf. */
export async function searchStore(term: string, country = 'BR'): Promise<{ appid: number; name: string }[]> {
  if (!term.trim()) return []
  const qs = new URLSearchParams({ term, cc: country, l: 'english' })
  try {
    const data = await getJson<{ items?: { id?: number; name?: string }[] }>(
      `https://store.steampowered.com/api/storesearch/?${qs}`,
    )
    return (data.items ?? [])
      .filter(i => i.id && i.name)
      .map(i => ({ appid: Number(i.id), name: String(i.name) }))
  } catch {
    return []
  }
}

/* ──────────────────────────────── Escrita ───────────────────────────────── */

async function storeWishlistCall(path: string, appid: number): Promise<void> {
  const cookie = cfg('STEAM_LOGIN_SECURE')
  const sessionid = cfg('STEAM_SESSION_ID')
  if (!cookie || !sessionid) {
    throw new SteamError('Escrever na wishlist da Steam exige os cookies de sessão (steamLoginSecure e sessionid).')
  }

  const body = new URLSearchParams({ sessionid, appid: String(appid) })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  try {
    const res = await fetch(`https://store.steampowered.com/api/${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Origin: 'https://store.steampowered.com',
        Referer: 'https://store.steampowered.com/',
        Cookie: `sessionid=${sessionid}; steamLoginSecure=${cookie}`,
      },
      body,
      signal: ctrl.signal,
    })
    if (res.status === 401 || res.status === 403) {
      throw new SteamError('Cookies da Steam expiraram — pegue o steamLoginSecure de novo no navegador.', res.status)
    }
    if (!res.ok) throw new SteamError(`Steam respondeu ${res.status} em ${path}`, res.status)

    // A loja responde 200 com {"success":false} quando a sessão não vale mais.
    const text = await res.text()
    if (text.trim() && /"success"\s*:\s*(false|0)/.test(text)) {
      throw new SteamError('A Steam recusou a alteração — sessão inválida ou app indisponível na sua região.')
    }
  } catch (e) {
    if (e instanceof SteamError) throw e
    throw new SteamError((e as Error).message || 'falha de rede ao escrever na Steam')
  } finally {
    clearTimeout(timer)
  }
}

export function addToWishlist(appid: number): Promise<void> {
  return storeWishlistCall('addtowishlist', appid)
}

export function removeFromWishlist(appid: number): Promise<void> {
  return storeWishlistCall('removefromwishlist', appid)
}
