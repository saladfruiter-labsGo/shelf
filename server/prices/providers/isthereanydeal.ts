/**
 * Cliente do IsThereAnyDeal (ITAD) — https://docs.isthereanydeal.com/
 *
 * Responsabilidades deste módulo: autenticação, timeout, rate limit e a
 * normalização das respostas para o formato interno (dinheiro sempre em
 * centavos, inteiro). Nenhuma regra de negócio mora aqui.
 */
import { db } from '../../db.js'

const API_HOST = 'api.isthereanydeal.com'
const BASE     = `https://${API_HOST}`
const TIMEOUT_MS = 15_000

/* ─────────────────────────────── Configuração ─────────────────────────────── */

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?')

/** Prioridade: valor salvo na UI (settings) → variável de ambiente → vazio. */
export function cfg(key: string): string {
  const row = getSetting.get(key) as { value: string } | undefined
  return row?.value?.trim() || process.env[key] || ''
}

export function itadKey(): string      { return cfg('ITAD_API_KEY') }
export function itadCountry(): string  { return (cfg('ITAD_COUNTRY') || 'BR').toUpperCase().slice(0, 2) }
export function itadEnabled(): boolean { return cfg('ITAD_ENABLED') === '1' && !!itadKey() }

/* ────────────────────────────── Tipos normalizados ────────────────────────── */

export interface ItadGame {
  id:     string
  slug:   string
  title:  string
  type:   string | null   // 'game' | 'dlc' | 'package' | ...
  mature: boolean
}

export interface NormalizedOffer {
  shop_id:          number
  shop_name:        string
  price_minor:      number
  regular_minor:    number
  currency:         string
  discount_percent: number
  url:              string
  drm:              string | null
  voucher:          string | null
  observed_at:      string   // ISO 8601 (UTC)
}

export interface NormalizedGamePrices {
  provider_game_id:     string
  history_low_minor:    number | null
  history_low_currency: string | null
  offers:               NormalizedOffer[]
}

export interface NormalizedHistoryPoint {
  shop_id:          number
  shop_name:        string
  price_minor:      number
  regular_minor:    number
  currency:         string
  discount_percent: number
  observed_at:      string
}

/** Erro do provedor com informação suficiente para reagendar. */
export class ItadError extends Error {
  constructor(
    message: string,
    readonly status: number | null = null,
    /** Segundos a esperar antes de tentar de novo (cabeçalho Retry-After). */
    readonly retryAfter: number | null = null,
    /** Falhas transitórias (rede, 5xx, 429) podem ser repetidas com backoff. */
    readonly transient = false,
  ) {
    super(message)
    this.name = 'ItadError'
  }
}

/* ─────────────────────────────── HTTP interno ─────────────────────────────── */

function assertAllowedHost(url: URL) {
  // Chamadas externas só são permitidas para o host conhecido do provedor.
  if (url.protocol !== 'https:' || url.hostname !== API_HOST) {
    throw new ItadError(`Host não permitido: ${url.hostname}`)
  }
}

async function call<T>(path: string, opts: {
  query?: Record<string, string | number | boolean | undefined>
  body?: unknown
} = {}): Promise<T> {
  const key = itadKey()
  if (!key) throw new ItadError('ITAD_API_KEY não configurada')

  const url = new URL(path, BASE)
  url.searchParams.set('key', key)
  for (const [k, v] of Object.entries(opts.query ?? {})) {
    if (v !== undefined && v !== '') url.searchParams.set(k, String(v))
  }
  assertAllowedHost(url)

  const ctrl  = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  let res: Response
  try {
    res = await fetch(url, {
      method:  opts.body === undefined ? 'GET' : 'POST',
      headers: opts.body === undefined ? undefined : { 'Content-Type': 'application/json' },
      body:    opts.body === undefined ? undefined : JSON.stringify(opts.body),
      signal:  ctrl.signal,
    })
  } catch (e) {
    const aborted = (e as Error).name === 'AbortError'
    throw new ItadError(
      aborted ? 'Tempo esgotado ao falar com o ITAD' : `Falha de rede: ${(e as Error).message}`,
      null, null, true,
    )
  } finally {
    clearTimeout(timer)
  }

  if (res.status === 429) {
    const ra = parseInt(res.headers.get('retry-after') ?? '')
    throw new ItadError('Limite de requisições do ITAD atingido', 429, Number.isFinite(ra) ? ra : 60, true)
  }
  if (!res.ok) {
    throw new ItadError(`ITAD respondeu ${res.status}`, res.status, null, res.status >= 500)
  }
  return res.json() as Promise<T>
}

/** Repete apenas falhas transitórias, com backoff exponencial curto. */
async function withRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let last: unknown
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn()
    } catch (e) {
      last = e
      if (!(e instanceof ItadError) || !e.transient) throw e
      if (e.status === 429) throw e              // rate limit é tratado por quem chamou
      if (i === attempts - 1) break
      await new Promise(r => setTimeout(r, 500 * 2 ** i))
    }
  }
  throw last
}

/* ────────────────────────────── Normalizadores ────────────────────────────── */

type RawPrice = { amount?: number; amountInt?: number; currency?: string } | null | undefined

/** Centavos como inteiro. `amountInt` é a fonte preferida; `amount` é o fallback. */
export function toMinor(p: RawPrice): number | null {
  if (!p) return null
  if (typeof p.amountInt === 'number' && Number.isFinite(p.amountInt)) return Math.round(p.amountInt)
  if (typeof p.amount === 'number' && Number.isFinite(p.amount))       return Math.round(p.amount * 100)
  return null
}

/** Só aceita links de compra HTTPS bem formados. */
export function isValidOfferUrl(url: unknown): url is string {
  if (typeof url !== 'string' || !url) return false
  try {
    return new URL(url).protocol === 'https:'
  } catch {
    return false
  }
}

function toIso(ts: unknown): string {
  const d = ts ? new Date(String(ts)) : new Date()
  return (isNaN(d.getTime()) ? new Date() : d).toISOString()
}

function drmLabel(drm: unknown): string | null {
  if (!Array.isArray(drm) || drm.length === 0) return null
  const names = drm
    .map(d => (typeof d === 'string' ? d : (d as { name?: string })?.name))
    .filter((n): n is string => !!n)
  return names.length ? names.join(', ') : null
}

function pct(cut: unknown, priceMinor: number, regularMinor: number): number {
  const n = Number(cut)
  if (Number.isFinite(n)) return Math.max(0, Math.min(100, Math.round(n)))
  return regularMinor > 0 ? Math.round(((regularMinor - priceMinor) / regularMinor) * 100) : 0
}

/** Resposta de `POST /games/prices/v3` → formato interno. */
export function normalizePrices(raw: unknown): NormalizedGamePrices[] {
  if (!Array.isArray(raw)) return []
  const out: NormalizedGamePrices[] = []

  for (const g of raw as any[]) {
    if (!g?.id) continue
    const offers: NormalizedOffer[] = []

    for (const d of (Array.isArray(g.deals) ? g.deals : []) as any[]) {
      const price   = toMinor(d?.price)
      const regular = toMinor(d?.regular) ?? price
      const shopId  = Number(d?.shop?.id)
      const currency = d?.price?.currency
      if (price == null || regular == null || !Number.isFinite(shopId)) continue
      if (typeof currency !== 'string' || !currency) continue
      if (!isValidOfferUrl(d?.url)) continue        // sem link válido não há botão de compra

      offers.push({
        shop_id:   shopId,
        shop_name: String(d?.shop?.name ?? `Loja ${shopId}`),
        price_minor:   price,
        regular_minor: regular,
        currency,
        discount_percent: pct(d?.cut, price, regular),
        url:     d.url,
        drm:     drmLabel(d?.drm),
        voucher: typeof d?.voucher === 'string' ? d.voucher : null,
        observed_at: toIso(d?.timestamp),
      })
    }

    offers.sort((a, b) => a.price_minor - b.price_minor)
    out.push({
      provider_game_id:     String(g.id),
      history_low_minor:    toMinor(g?.historyLow?.all),
      history_low_currency: g?.historyLow?.all?.currency ?? null,
      offers,
    })
  }
  return out
}

/** Resposta de `GET /games/history/v2` → formato interno. */
export function normalizeHistory(raw: unknown): NormalizedHistoryPoint[] {
  if (!Array.isArray(raw)) return []
  const out: NormalizedHistoryPoint[] = []

  for (const p of raw as any[]) {
    const price    = toMinor(p?.deal?.price)
    const regular  = toMinor(p?.deal?.regular) ?? price
    const shopId   = Number(p?.shop?.id)
    const currency = p?.deal?.price?.currency
    if (price == null || regular == null || !Number.isFinite(shopId)) continue
    if (typeof currency !== 'string' || !currency) continue

    out.push({
      shop_id:   shopId,
      shop_name: String(p?.shop?.name ?? `Loja ${shopId}`),
      price_minor:   price,
      regular_minor: regular,
      currency,
      discount_percent: pct(p?.deal?.cut, price, regular),
      observed_at: toIso(p?.timestamp),
    })
  }
  return out
}

/** Resposta de busca/lookup → lista de jogos do provedor. */
export function normalizeGames(raw: unknown): ItadGame[] {
  if (!Array.isArray(raw)) return []
  return (raw as any[])
    .filter(g => g?.id && g?.title)
    .map(g => ({
      id:     String(g.id),
      slug:   String(g.slug ?? ''),
      title:  String(g.title),
      type:   g.type ? String(g.type) : null,
      mature: !!g.mature,
    }))
}

/* ─────────────────────────────────── API ──────────────────────────────────── */

/** Procura o jogo pelo Steam AppID. */
export async function lookupByAppId(appid: number): Promise<ItadGame | null> {
  const r = await withRetry(() => call<any>('/games/lookup/v1', { query: { appid } }))
  return r?.found && r.game ? normalizeGames([r.game])[0] ?? null : null
}

/** Procura o jogo pelo título (o ITAD faz o casamento). */
export async function lookupByTitle(title: string): Promise<ItadGame | null> {
  const r = await withRetry(() => call<any>('/games/lookup/v1', { query: { title } }))
  return r?.found && r.game ? normalizeGames([r.game])[0] ?? null : null
}

/** Busca livre — alimenta a correspondência manual. */
export async function searchGames(title: string, results = 20): Promise<ItadGame[]> {
  return normalizeGames(await withRetry(() => call<any>('/games/search/v1', { query: { title, results } })))
}

/** Preços atuais de até 200 jogos numa chamada. */
export async function fetchPrices(ids: string[], country = itadCountry()): Promise<NormalizedGamePrices[]> {
  if (ids.length === 0) return []
  return normalizePrices(await withRetry(
    () => call<any>('/games/prices/v3', { query: { country }, body: ids.slice(0, 200) }),
  ))
}

/** Log histórico de mudanças de preço de um jogo. */
export async function fetchHistory(id: string, since?: string, country = itadCountry()): Promise<NormalizedHistoryPoint[]> {
  return normalizeHistory(await withRetry(() => call<any>('/games/history/v2', { query: { id, country, since } })))
}

/** Lojas ativas para o país configurado. */
export async function fetchShops(country = itadCountry()): Promise<{ id: number; name: string }[]> {
  const raw = await withRetry(() => call<any>('/service/shops/v1', { query: { country } }))
  if (!Array.isArray(raw)) return []
  return raw
    .filter((s: any) => Number.isFinite(Number(s?.id)))
    .map((s: any) => ({ id: Number(s.id), name: String(s.title ?? s.name ?? `Loja ${s.id}`) }))
}
