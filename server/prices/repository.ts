/** Leitura e escrita das tabelas de preços. Sem regra de negócio. */
import { db } from '../db.js'
import type { NormalizedOffer, NormalizedHistoryPoint } from './providers/isthereanydeal.js'
import type { HistoryRow } from './stats.js'
import { dayOf } from './stats.js'

export interface ProductRow {
  id:                number
  media_item_id:     number
  provider:          string
  provider_game_id:  string | null
  platform:          string
  matched_title:     string | null
  match_method:      string | null
  match_status:      'pending' | 'resolved' | 'ambiguous' | 'not_found'
  currency:          string | null
  history_low_minor: number | null
  history_low_at:    string | null
  last_resolved_at:  string | null
  last_synced_at:    string | null
  last_error:        string | null
}

export interface OfferRow {
  shop_id:          number
  shop_name:        string
  price_minor:      number
  regular_minor:    number
  currency:         string
  discount_percent: number
  url:              string
  drm:              string | null
  voucher:          string | null
  available:        number
  observed_at:      string
  last_seen_at:     string
}

export interface BacklogGame {
  id:          number
  title:       string
  external_id: string
}

const PROVIDER = 'itad'
const PLATFORM = 'pc'

/* ─────────────────────────────────── Produtos ─────────────────────────────── */

const selProduct = db.prepare(`
  SELECT * FROM game_price_products
  WHERE media_item_id = ? AND provider = ? AND platform = ?
`)
const insProduct = db.prepare(`
  INSERT INTO game_price_products (media_item_id, provider, platform)
  VALUES (?, ?, ?)
  ON CONFLICT(media_item_id, provider, platform) DO NOTHING
`)

export function getProduct(mediaItemId: number): ProductRow | undefined {
  return selProduct.get(mediaItemId, PROVIDER, PLATFORM) as ProductRow | undefined
}

/** Produto do jogo, criando a linha na primeira vez. */
export function ensureProduct(mediaItemId: number): ProductRow {
  insProduct.run(mediaItemId, PROVIDER, PLATFORM)
  return selProduct.get(mediaItemId, PROVIDER, PLATFORM) as ProductRow
}

const updMatch = db.prepare(`
  UPDATE game_price_products SET
    provider_game_id = @provider_game_id,
    matched_title    = @matched_title,
    match_method     = @match_method,
    match_status     = @match_status,
    last_resolved_at = datetime('now'),
    last_error       = NULL,
    updated_at       = datetime('now')
  WHERE id = @id
`)

export function saveMatch(productId: number, m: {
  provider_game_id: string | null
  matched_title:    string | null
  match_method:     string | null
  match_status:     string
}) {
  updMatch.run({ id: productId, ...m })
}

const updError  = db.prepare(`UPDATE game_price_products SET last_error = ?, updated_at = datetime('now') WHERE id = ?`)
const updSynced = db.prepare(`
  UPDATE game_price_products SET
    currency          = COALESCE(@currency, currency),
    history_low_minor = COALESCE(@history_low_minor, history_low_minor),
    history_low_at    = CASE WHEN @history_low_minor IS NULL THEN history_low_at ELSE datetime('now') END,
    last_synced_at    = datetime('now'),
    last_error        = NULL,
    updated_at        = datetime('now')
  WHERE id = @id
`)

export function saveError(productId: number, message: string) {
  updError.run(message.slice(0, 300), productId)
}

/** Zera a correspondência (desassociar), preservando ofertas e histórico. */
export function clearMatch(productId: number) {
  db.prepare(`
    UPDATE game_price_products SET
      provider_game_id = NULL, matched_title = NULL, match_method = NULL,
      match_status = 'pending', last_error = NULL, updated_at = datetime('now')
    WHERE id = ?
  `).run(productId)
  db.prepare(`UPDATE game_price_offers SET available = 0 WHERE game_price_product_id = ?`).run(productId)
}

/* ──────────────────────────────── Ofertas atuais ──────────────────────────── */

const upsertOffer = db.prepare(`
  INSERT INTO game_price_offers
    (game_price_product_id, shop_id, shop_name, price_minor, regular_minor, currency,
     discount_percent, url, drm, voucher, available, observed_at, last_seen_at)
  VALUES
    (@product_id, @shop_id, @shop_name, @price_minor, @regular_minor, @currency,
     @discount_percent, @url, @drm, @voucher, 1, @observed_at, @now)
  ON CONFLICT(game_price_product_id, shop_id) DO UPDATE SET
    shop_name        = excluded.shop_name,
    price_minor      = excluded.price_minor,
    regular_minor    = excluded.regular_minor,
    currency         = excluded.currency,
    discount_percent = excluded.discount_percent,
    url              = excluded.url,
    drm              = excluded.drm,
    voucher          = excluded.voucher,
    available        = 1,
    observed_at      = excluded.observed_at,
    last_seen_at     = excluded.last_seen_at,
    updated_at       = datetime('now')
`)

const insHistory = db.prepare(`
  INSERT OR IGNORE INTO game_price_history
    (game_price_product_id, shop_id, shop_name, price_minor, regular_minor, currency,
     discount_percent, observed_at, observed_day, source)
  VALUES
    (@product_id, @shop_id, @shop_name, @price_minor, @regular_minor, @currency,
     @discount_percent, @observed_at, @observed_day, @source)
`)

const selOffers = db.prepare(`
  SELECT shop_id, shop_name, price_minor, regular_minor, currency, discount_percent,
         url, drm, voucher, available, observed_at, last_seen_at
  FROM game_price_offers
  WHERE game_price_product_id = ?
  ORDER BY available DESC, price_minor ASC
`)

export function getOffers(productId: number): OfferRow[] {
  return selOffers.all(productId) as OfferRow[]
}

/**
 * Grava as ofertas do último ciclo e um snapshot diário de cada uma.
 * Ofertas que sumiram da resposta viram indisponíveis — nunca são apagadas,
 * para o histórico continuar íntegro.
 */
export const saveOffers = db.transaction((productId: number, offers: NormalizedOffer[]) => {
  const now = new Date().toISOString()
  const today = now.slice(0, 10)

  for (const o of offers) {
    upsertOffer.run({ product_id: productId, now, ...o })
    insHistory.run({
      product_id: productId,
      shop_id: o.shop_id, shop_name: o.shop_name,
      price_minor: o.price_minor, regular_minor: o.regular_minor,
      currency: o.currency, discount_percent: o.discount_percent,
      // Snapshot do dia da coleta (o timestamp do provedor é de quando o preço mudou).
      observed_at: now, observed_day: today, source: 'shelf_poll',
    })
  }

  const seen = offers.map(o => o.shop_id)
  if (seen.length > 0) {
    db.prepare(`
      UPDATE game_price_offers SET available = 0, updated_at = datetime('now')
      WHERE game_price_product_id = ? AND available = 1
        AND shop_id NOT IN (${seen.map(() => '?').join(',')})
    `).run(productId, ...seen)
  } else {
    db.prepare(`UPDATE game_price_offers SET available = 0, updated_at = datetime('now') WHERE game_price_product_id = ?`).run(productId)
  }
})

/** Importa o log de mudanças do provedor (uma vez, ao resolver a correspondência). */
export const importHistory = db.transaction((productId: number, points: NormalizedHistoryPoint[]) => {
  for (const p of points) {
    insHistory.run({
      product_id: productId,
      shop_id: p.shop_id, shop_name: p.shop_name,
      price_minor: p.price_minor, regular_minor: p.regular_minor,
      currency: p.currency, discount_percent: p.discount_percent,
      observed_at: p.observed_at, observed_day: dayOf(p.observed_at),
      source: 'provider_import',
    })
  }
})

export function markSynced(productId: number, currency: string | null, historyLowMinor: number | null) {
  updSynced.run({ id: productId, currency, history_low_minor: historyLowMinor })
}

/** Marca todas as ofertas como indisponíveis (produto sem oferta na região). */
export function markAllUnavailable(productId: number) {
  db.prepare(`UPDATE game_price_offers SET available = 0, updated_at = datetime('now') WHERE game_price_product_id = ?`).run(productId)
}

/* ─────────────────────────────────── Histórico ────────────────────────────── */

export function getHistory(productId: number, opts: { since?: Date | null; shopId?: number | null; currency?: string | null } = {}): HistoryRow[] {
  const where: string[] = ['game_price_product_id = ?']
  const args: unknown[] = [productId]
  if (opts.since)    { where.push('observed_at >= ?'); args.push(opts.since.toISOString()) }
  if (opts.shopId)   { where.push('shop_id = ?');      args.push(opts.shopId) }
  if (opts.currency) { where.push('currency = ?');     args.push(opts.currency) }
  return db.prepare(`
    SELECT shop_id, shop_name, price_minor, regular_minor, discount_percent, currency, observed_at
    FROM game_price_history
    WHERE ${where.join(' AND ')}
    ORDER BY observed_at ASC
  `).all(...args) as HistoryRow[]
}

/** Lojas que já apareceram no histórico ou nas ofertas deste produto. */
export function getShops(productId: number): { id: number; name: string }[] {
  return db.prepare(`
    SELECT shop_id AS id, shop_name AS name FROM game_price_offers WHERE game_price_product_id = ?
    UNION
    SELECT shop_id AS id, shop_name AS name FROM game_price_history WHERE game_price_product_id = ?
    ORDER BY name COLLATE NOCASE
  `).all(productId, productId) as { id: number; name: string }[]
}

/* ──────────────────────────────────── Backlog ─────────────────────────────── */

/** Jogos no backlog — os únicos consultados automaticamente. */
export function backlogGames(): BacklogGame[] {
  return db.prepare(`
    SELECT id, title, external_id FROM media_items
    WHERE type = 'game' AND status = 'wishlist'
    ORDER BY added_at DESC
  `).all() as BacklogGame[]
}

export function isBacklogGame(mediaItemId: number): boolean {
  const row = db.prepare(`SELECT 1 AS ok FROM media_items WHERE id = ? AND type = 'game' AND status = 'wishlist'`).get(mediaItemId)
  return !!row
}

export interface BacklogSummaryRow extends ProductRow {
  best_shop_id:       number | null
  best_price_minor:   number | null
  best_regular_minor: number | null
  best_discount:      number | null
  best_shop_name:     string | null
  best_url:           string | null
  local_low_minor:    number | null
}

/**
 * Resumo de preço de todos os jogos do backlog numa única consulta — é o que
 * evita uma requisição por card.
 */
export function backlogSummaries(): BacklogSummaryRow[] {
  return db.prepare(`
    SELECT p.*,
           b.shop_id          AS best_shop_id,
           b.price_minor      AS best_price_minor,
           b.regular_minor    AS best_regular_minor,
           b.discount_percent AS best_discount,
           b.shop_name        AS best_shop_name,
           b.url              AS best_url,
           (SELECT MIN(h.price_minor) FROM game_price_history h
             WHERE h.game_price_product_id = p.id
               AND (p.currency IS NULL OR h.currency = p.currency)) AS local_low_minor
    FROM game_price_products p
    JOIN media_items m ON m.id = p.media_item_id
    LEFT JOIN game_price_offers b
      ON b.id = (
        SELECT o.id FROM game_price_offers o
        WHERE o.game_price_product_id = p.id AND o.available = 1
          AND (p.currency IS NULL OR o.currency = p.currency)
        ORDER BY o.price_minor ASC LIMIT 1
      )
    WHERE m.type = 'game' AND m.status = 'wishlist'
  `).all() as BacklogSummaryRow[]
}
