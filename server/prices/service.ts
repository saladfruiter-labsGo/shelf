/**
 * Regras de negócio dos preços: o que pode ser exibido, os quatro indicadores e
 * a composição das respostas da API.
 */
import { db } from '../db.js'
import * as itad from './providers/isthereanydeal.js'
import * as repo from './repository.js'
import { resolveMatch, rankCandidates } from './matcher.js'
import { buildSeries, computeStats, parseRange, rangeStart, type Range } from './stats.js'

const selGame = db.prepare(`SELECT id, title, external_id FROM media_items WHERE id = ? AND type = 'game'`)

/** Acima disso, o preço mostrado ganha o selo "dados desatualizados". */
const STALE_HOURS = 12
/** Intervalo mínimo entre duas atualizações manuais do mesmo jogo. */
const REFRESH_COOLDOWN_MS = 5 * 60_000

const lastManualRefresh = new Map<number, number>()

export interface PriceOffer {
  shop_id:          number
  shop_name:        string
  price_minor:      number
  regular_minor:    number
  currency:         string
  discount_percent: number
  url:              string
  drm:              string | null
  voucher:          string | null
  available:        boolean
  shop_low_minor:   number | null
  last_seen_at:     string
}

export interface PriceSummary {
  media_item_id:     number
  match_status:      string
  matched_title:     string | null
  currency:          string | null
  best:              PriceOffer | null
  history_low_minor: number | null
  is_history_low:    boolean
  last_synced_at:    string | null
  stale:             boolean
}

function isStale(lastSyncedAt: string | null): boolean {
  if (!lastSyncedAt) return true
  const t = new Date(lastSyncedAt.includes('T') ? lastSyncedAt : lastSyncedAt.replace(' ', 'T') + 'Z').getTime()
  return !Number.isFinite(t) || Date.now() - t > STALE_HOURS * 3_600_000
}

/** Correspondência de baixa confiança nunca exibe preço automaticamente. */
function canShowPrices(status: string): boolean {
  return status === 'resolved'
}

function toOffer(o: repo.OfferRow, shopLow: number | null): PriceOffer {
  return {
    shop_id: o.shop_id,
    shop_name: o.shop_name,
    price_minor: o.price_minor,
    regular_minor: o.regular_minor,
    currency: o.currency,
    discount_percent: o.discount_percent,
    url: o.url,
    drm: o.drm,
    voucher: o.voucher,
    available: o.available === 1,
    shop_low_minor: shopLow,
    last_seen_at: o.last_seen_at,
  }
}

/* ───────────────────────────────── Backlog ────────────────────────────────── */

/** Resumo de todos os jogos do backlog — uma consulta só, um item por jogo. */
export function backlogSummary(): PriceSummary[] {
  return repo.backlogSummaries().map(r => {
    const show = canShowPrices(r.match_status)
    const low  = [r.history_low_minor, r.local_low_minor].filter((v): v is number => v != null)
    const historyLow = low.length ? Math.min(...low) : null

    const best: PriceOffer | null = show && r.best_price_minor != null
      ? {
          shop_id: r.best_shop_id ?? 0,
          shop_name: r.best_shop_name ?? '',
          price_minor: r.best_price_minor,
          regular_minor: r.best_regular_minor ?? r.best_price_minor,
          currency: r.currency ?? 'BRL',
          discount_percent: r.best_discount ?? 0,
          url: r.best_url ?? '',
          drm: null,
          voucher: null,
          available: true,
          shop_low_minor: null,
          last_seen_at: r.last_synced_at ?? '',
        }
      : null

    return {
      media_item_id: r.media_item_id,
      match_status:  r.match_status,
      matched_title: r.matched_title,
      currency:      r.currency,
      best,
      history_low_minor: show ? historyLow : null,
      is_history_low: !!(best && historyLow != null && best.price_minor <= historyLow),
      last_synced_at: r.last_synced_at,
      stale: isStale(r.last_synced_at),
    }
  })
}

/* ──────────────────────────── Detalhe de um jogo ──────────────────────────── */

export interface PriceDetails {
  media_item_id: number
  enabled:       boolean
  match: {
    status:           string
    provider_game_id: string | null
    matched_title:    string | null
    method:           string | null
  }
  currency: string | null
  stats: {
    current_minor:     number | null
    history_low_minor: number | null
    month_low_minor:   number | null
    last30_low_minor:  number | null
    local_since:       string | null
  }
  best:   PriceOffer | null
  offers: PriceOffer[]
  points: { day: string; price_minor: number; regular_minor: number; discount_percent: number; shop_name: string }[]
  shops:  { id: number; name: string }[]
  range:  Range
  shop:   number | null
  last_synced_at: string | null
  last_error:     string | null
  stale:  boolean
}

export function gameDetails(mediaItemId: number, rangeRaw?: unknown, shopRaw?: unknown): PriceDetails {
  const range  = parseRange(rangeRaw)
  const shopId = Number(shopRaw)
  const shop   = Number.isFinite(shopId) && shopId > 0 ? shopId : null

  const product = repo.getProduct(mediaItemId)
  const empty: PriceDetails = {
    media_item_id: mediaItemId,
    enabled: itad.itadEnabled(),
    match: { status: 'pending', provider_game_id: null, matched_title: null, method: null },
    currency: null,
    stats: { current_minor: null, history_low_minor: null, month_low_minor: null, last30_low_minor: null, local_since: null },
    best: null, offers: [], points: [], shops: [],
    range, shop, last_synced_at: null, last_error: null, stale: true,
  }
  if (!product) return empty

  const show = canShowPrices(product.match_status)
  const currency = product.currency
  const shopLows = repo.getShopLows(product.id)

  const offers = show
    ? repo.getOffers(product.id)
        .filter(o => !currency || o.currency === currency)   // nunca misturar moedas
        .map(o => toOffer(o, shopLows[o.shop_id] ?? null))
    : []
  const best = offers.find(o => o.available) ?? null

  const rows = show
    ? repo.getHistory(product.id, { since: rangeStart(range), shopId: shop, currency })
    : []
  // Só as lojas com oferta ativa carregam o preço até hoje no gráfico.
  const activeShops = offers.filter(o => o.available).map(o => o.shop_id)
  const allRows = show ? repo.getHistory(product.id, { currency }) : []

  const stats = computeStats(allRows, best?.price_minor ?? null)
  const historyLow = [product.history_low_minor, stats.local_low_minor]
    .filter((v): v is number => v != null)

  return {
    media_item_id: mediaItemId,
    enabled: itad.itadEnabled(),
    match: {
      status:           product.match_status,
      provider_game_id: product.provider_game_id,
      matched_title:    product.matched_title,
      method:           product.match_method,
    },
    currency,
    stats: {
      current_minor:     best?.price_minor ?? null,
      history_low_minor: historyLow.length ? Math.min(...historyLow) : null,
      month_low_minor:   stats.month_low_minor,
      last30_low_minor:  stats.last30_low_minor,
      local_since:       stats.local_since,
    },
    best,
    offers,
    points: buildSeries(rows, undefined, activeShops).map(p => ({
      day: p.day, price_minor: p.price_minor, regular_minor: p.regular_minor,
      discount_percent: p.discount_percent, shop_name: p.shop_name,
    })),
    shops: show ? repo.getShops(product.id) : [],
    range,
    shop,
    last_synced_at: product.last_synced_at,
    last_error:     product.last_error,
    stale: isStale(product.last_synced_at),
  }
}

/* ─────────────────────── Sincronização de um único jogo ───────────────────── */

/**
 * Resolve (se preciso) e atualiza os preços de um jogo.
 * Erros do provedor são persistidos no produto e propagados — quem chama decide
 * se reagenda; o último preço conhecido nunca é apagado.
 */
export async function syncProduct(game: repo.BacklogGame): Promise<void> {
  const product = repo.ensureProduct(game.id)

  let providerId = product.provider_game_id
  let status     = product.match_status

  if (status !== 'resolved' && status !== 'ambiguous' && product.match_method !== 'manual') {
    const m = await resolveMatch(game)
    repo.saveMatch(product.id, m)
    providerId = m.provider_game_id
    status     = m.match_status
    // Primeira resolução: traz o log histórico do provedor de uma vez.
    if (m.match_status === 'resolved' && m.provider_game_id) {
      const since = new Date(Date.now() - 365 * 86_400_000).toISOString()
      repo.importHistory(product.id, await itad.fetchHistory(m.provider_game_id, since))
    }
  }

  if (status !== 'resolved' || !providerId) return

  const [prices] = await itad.fetchPrices([providerId])
  if (!prices) {
    // Provedor não devolveu o jogo: mantém o último preço, só registra o motivo.
    repo.saveError(product.id, 'Provedor não retornou preços para este jogo')
    return
  }

  applyPrices(product.id, prices)
}

/** Grava um lote de preços já normalizado (usado pelo sync em lote e pelo refresh). */
export function applyPrices(productId: number, prices: itad.NormalizedGamePrices) {
  // Moeda dominante das ofertas — é ela que define o que pode ser somado/comparado.
  const counts = new Map<string, number>()
  for (const o of prices.offers) counts.set(o.currency, (counts.get(o.currency) ?? 0) + 1)
  const currency = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null

  repo.saveOffers(productId, prices.offers)
  const lowSameCurrency = prices.history_low_currency && currency && prices.history_low_currency !== currency
    ? null
    : prices.history_low_minor
  repo.markSynced(productId, currency, lowSameCurrency)
}

/* ─────────────────────────── Atualização manual ───────────────────────────── */

export async function refreshGame(mediaItemId: number): Promise<{ ok: boolean; error?: string; retry_in?: number }> {
  if (!itad.itadEnabled()) return { ok: false, error: 'Integração de preços desativada ou sem chave de API.' }

  const product = repo.ensureProduct(mediaItemId)
  const last = lastManualRefresh.get(product.id) ?? 0
  const wait = REFRESH_COOLDOWN_MS - (Date.now() - last)
  if (wait > 0) return { ok: false, error: 'Aguarde antes de atualizar de novo.', retry_in: Math.ceil(wait / 1000) }
  lastManualRefresh.set(product.id, Date.now())

  const game = selGame.get(mediaItemId) as repo.BacklogGame | undefined
  if (!game) return { ok: false, error: 'Jogo não encontrado.' }

  try {
    await syncProduct(game)
    return { ok: true }
  } catch (e) {
    const msg = (e as Error).message || 'Falha ao atualizar preços'
    repo.saveError(product.id, msg)
    return { ok: false, error: msg }
  }
}

/* ────────────────────────── Correspondência manual ────────────────────────── */

export async function searchMatches(mediaItemId: number, q: string) {
  if (!itad.itadEnabled()) return { candidates: [] as itad.ItadGame[] }
  const query = q.trim()
  if (!query) return { candidates: [] as itad.ItadGame[] }
  return { candidates: rankCandidates(query, await itad.searchGames(query, 20)) }
}

export async function setManualMatch(mediaItemId: number, providerGameId: string | null, title: string | null) {
  const product = repo.ensureProduct(mediaItemId)

  if (!providerGameId) {
    repo.clearMatch(product.id)
    return { ok: true }
  }

  repo.saveMatch(product.id, {
    provider_game_id: providerGameId,
    matched_title:    title,
    match_method:     'manual',
    match_status:     'resolved',
  })

  // Importa o histórico do produto recém-confirmado e já busca o preço atual.
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString()
  repo.importHistory(product.id, await itad.fetchHistory(providerGameId, since))
  const [prices] = await itad.fetchPrices([providerGameId])
  if (prices) applyPrices(product.id, prices)
  else repo.markAllUnavailable(product.id)

  return { ok: true }
}
