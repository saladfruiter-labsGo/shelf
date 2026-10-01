/**
 * Ficha da loja da Steam para a página de jogo (ST-G): sinopse, gêneros,
 * empresas, trailers e screenshots. Sem chave; um app por chamada.
 *
 * A loja limita chamadas (~200 a cada 5 min), então a ficha fica em cache no
 * banco (`steam_app_cache`) por 7 dias; se a Steam falhar, vale a última cópia.
 */
import { db } from '../db.js'

/** Sobe quando o formato muda; cópia de formato antigo no cache conta como vencida. */
export const STORE_PAGE_FORMAT = 2

export interface SteamStorePage {
  format: number
  appid: number
  name: string
  short_description: string | null
  genres: string[]
  developers: string[]
  publishers: string[]
  release_date: string | null
  year: number | null
  coming_soon: boolean
  header_image: string
  background: string | null
  screenshots: { thumb: string; full: string }[]
  /** `hls` é o formato atual da Steam (tocado com hls.js); mp4/webm só em fichas antigas. */
  movies: { name: string; thumbnail: string; mp4: string | null; webm: string | null; hls: string | null }[]
  metacritic: { score: number; url: string | null } | null
  store_url: string
}

const TTL_MS = 7 * 24 * 3_600_000

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }

/** A loja manda texto com entidades HTML (e às vezes tags); a página quer texto puro. */
export function plainText(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const text = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&(#\d+|#x[0-9a-f]+|[a-z]+);/gi, (match, code: string) => {
      if (code.startsWith('#x')) return String.fromCodePoint(parseInt(code.slice(2), 16))
      if (code.startsWith('#')) return String.fromCodePoint(Number(code.slice(1)))
      return ENTITIES[code.toLowerCase()] ?? match
    })
    .trim()
  return text || null
}

const httpsUrl = (value: unknown): string | null =>
  typeof value === 'string' && /^https:\/\//i.test(value) ? value : null

/** Converte a resposta crua de `appdetails` no formato da página. */
export function parseStorePage(appid: number, d: any): SteamStorePage {
  const release: string | null = typeof d.release_date?.date === 'string' && d.release_date.date.trim() ? d.release_date.date.trim() : null
  const year = release?.match(/(\d{4})/)?.[1]
  return {
    format: STORE_PAGE_FORMAT,
    appid,
    name: String(d.name ?? ''),
    short_description: plainText(d.short_description),
    genres: Array.isArray(d.genres) ? d.genres.map((g: any) => String(g.description ?? '')).filter(Boolean) : [],
    developers: Array.isArray(d.developers) ? d.developers.map(String) : [],
    publishers: Array.isArray(d.publishers) ? d.publishers.map(String) : [],
    release_date: release,
    year: year ? Number(year) : null,
    coming_soon: Boolean(d.release_date?.coming_soon),
    header_image: httpsUrl(d.header_image) ?? `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/header.jpg`,
    background: httpsUrl(d.background_raw) ?? httpsUrl(d.background),
    screenshots: (Array.isArray(d.screenshots) ? d.screenshots : [])
      .map((s: any) => ({ thumb: httpsUrl(s.path_thumbnail), full: httpsUrl(s.path_full) }))
      .filter((s: any): s is { thumb: string; full: string } => !!s.thumb && !!s.full)
      .slice(0, 12),
    movies: (Array.isArray(d.movies) ? d.movies : [])
      .map((m: any) => ({
        name: String(m.name ?? 'Trailer'),
        thumbnail: httpsUrl(m.thumbnail),
        mp4: httpsUrl(m.mp4?.max) ?? httpsUrl(m.mp4?.['480']),
        webm: httpsUrl(m.webm?.max) ?? httpsUrl(m.webm?.['480']),
        hls: httpsUrl(m.hls_h264),
      }))
      .filter((m: any) => !!m.thumbnail)
      .slice(0, 4),
    metacritic: typeof d.metacritic?.score === 'number' ? { score: d.metacritic.score, url: httpsUrl(d.metacritic.url) } : null,
    store_url: `https://store.steampowered.com/app/${appid}/`,
  }
}

async function fetchFromStore(appid: number): Promise<SteamStorePage | null> {
  const qs = new URLSearchParams({ appids: String(appid), cc: 'BR', l: 'brazilian' })
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetch(`https://store.steampowered.com/api/appdetails?${qs}`, { signal: ctrl.signal })
    if (!res.ok) throw new Error(`Steam respondeu ${res.status}`)
    const data = await res.json() as Record<string, { success?: boolean; data?: unknown }>
    const entry = data[String(appid)]
    return entry?.success && entry.data ? parseStorePage(appid, entry.data) : null
  } finally {
    clearTimeout(timer)
  }
}

/** Ficha da loja com cache de 7 dias; falha da Steam devolve a última cópia. */
export async function getStorePage(appid: number, now = Date.now()): Promise<SteamStorePage | null> {
  const cached = db.prepare('SELECT data, fetched_at FROM steam_app_cache WHERE appid = ?').get(appid) as
    { data: string; fetched_at: number } | undefined
  const cachedPage = cached ? JSON.parse(cached.data) as SteamStorePage : null
  if (cachedPage && cachedPage.format === STORE_PAGE_FORMAT && now - cached!.fetched_at < TTL_MS) return cachedPage

  try {
    const page = await fetchFromStore(appid)
    if (page) {
      db.prepare(`
        INSERT INTO steam_app_cache (appid, data, fetched_at) VALUES (?, ?, ?)
        ON CONFLICT(appid) DO UPDATE SET data = excluded.data, fetched_at = excluded.fetched_at
      `).run(appid, JSON.stringify(page), now)
    }
    return page ?? cachedPage
  } catch {
    return cachedPage
  }
}
