/**
 * Estatísticas e séries do histórico de preços.
 *
 * Funções puras, sem SQLite: recebem as linhas já lidas e devolvem os números
 * que a interface mostra. Todo dinheiro é inteiro em centavos.
 */

export interface HistoryRow {
  shop_id:          number
  shop_name:        string
  price_minor:      number
  regular_minor:    number
  discount_percent: number
  currency:         string
  observed_at:      string   // ISO 8601
}

export interface SeriesPoint {
  day:              string   // YYYY-MM-DD
  price_minor:      number
  regular_minor:    number
  discount_percent: number
  shop_id:          number
  shop_name:        string
}

/** Dia (UTC) de um instante ISO. */
export function dayOf(iso: string): string {
  const d = new Date(iso)
  return (isNaN(d.getTime()) ? new Date() : d).toISOString().slice(0, 10)
}

function addDays(day: string, n: number): string {
  const d = new Date(`${day}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/**
 * Série do menor preço disponível por dia.
 *
 * O histórico do provedor é um *log de mudanças*: entre dois eventos o preço
 * continua valendo. Por isso cada loja vira uma escada (carrega o último preço
 * conhecido para a frente) e o ponto do dia é o menor valor entre as lojas com
 * preço vigente naquele dia.
 *
 * `activeShops` limita quem continua valendo até hoje: lojas que saíram das
 * ofertas atuais param no dia da última observação, para uma promoção antiga de
 * uma loja que não vende mais o jogo não puxar a linha para baixo. Sem esse
 * argumento, todas as lojas carregam até `until`.
 */
export function buildSeries(
  rows: HistoryRow[],
  until = new Date().toISOString().slice(0, 10),
  activeShops?: Iterable<number>,
): SeriesPoint[] {
  if (rows.length === 0) return []

  // Menor preço observado por loja e por dia.
  type Obs = { price: number; regular: number; cut: number }
  const byShop = new Map<number, { name: string; days: Map<string, Obs> }>()
  for (const r of rows) {
    const day = dayOf(r.observed_at)
    let shop = byShop.get(r.shop_id)
    if (!shop) byShop.set(r.shop_id, (shop = { name: r.shop_name, days: new Map() }))
    const cur = shop.days.get(day)
    if (cur == null || r.price_minor < cur.price) {
      shop.days.set(day, { price: r.price_minor, regular: r.regular_minor, cut: r.discount_percent })
    }
  }

  const allDays = rows.map(r => dayOf(r.observed_at)).sort()
  const first = allDays[0]
  const last  = allDays[allDays.length - 1] > until ? allDays[allDays.length - 1] : until

  // Escada por loja: último preço conhecido carregado para a frente.
  const active = activeShops ? new Set(activeShops) : null
  const stairs = new Map<number, { name: string; price: Map<string, Obs> }>()
  for (const [shopId, shop] of byShop) {
    const days = [...shop.days.keys()].sort()
    // Loja ainda ofertando: o último preço vale até hoje. Loja que saiu: para
    // na última vez em que foi vista.
    const lastDay = !active || active.has(shopId) ? last : days[days.length - 1]
    const price = new Map<string, Obs>()
    let carry: Obs | null = null
    for (let d = days[0]; d <= lastDay; d = addDays(d, 1)) {
      const v = shop.days.get(d)
      if (v != null) carry = v
      if (carry != null) price.set(d, carry)
    }
    stairs.set(shopId, { name: shop.name, price })
  }

  const out: SeriesPoint[] = []
  for (let d = first; d <= last; d = addDays(d, 1)) {
    let best: SeriesPoint | null = null
    for (const [shopId, s] of stairs) {
      const p = s.price.get(d)
      if (p == null) continue
      if (!best || p.price < best.price_minor) {
        best = {
          day: d, price_minor: p.price, regular_minor: p.regular, discount_percent: p.cut,
          shop_id: shopId, shop_name: s.name,
        }
      }
    }
    if (best) out.push(best)
  }
  return out
}

export interface PriceStats {
  /** Menor preço observado em todo o histórico local. */
  local_low_minor:  number | null
  /** Menor preço desde o dia 1 do mês corrente. */
  month_low_minor:  number | null
  /** Menor preço na janela móvel de 30 dias. */
  last30_low_minor: number | null
  /** Primeiro instante coberto pelo histórico local. */
  local_since:      string | null
}

/** Menor valor de uma janela. `from` é inclusivo. */
function lowSince(rows: HistoryRow[], from: Date): number | null {
  let low: number | null = null
  for (const r of rows) {
    const t = new Date(r.observed_at).getTime()
    if (!Number.isFinite(t) || t < from.getTime()) continue
    if (low == null || r.price_minor < low) low = r.price_minor
  }
  return low
}

/**
 * Indicadores calculados sobre o histórico local.
 * `currentMinor` (melhor oferta atual) entra nas janelas: o preço de hoje é,
 * por definição, um preço observado dentro do mês e dos últimos 30 dias.
 */
export function computeStats(
  rows: HistoryRow[],
  currentMinor: number | null = null,
  now: Date = new Date(),
): PriceStats {
  const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1))
  const d30        = new Date(now.getTime() - 30 * 86_400_000)

  const min = (a: number | null, b: number | null) =>
    a == null ? b : b == null ? a : Math.min(a, b)

  let all: number | null = null
  let since: string | null = null
  for (const r of rows) {
    if (all == null || r.price_minor < all) all = r.price_minor
    if (since == null || r.observed_at < since) since = r.observed_at
  }

  return {
    local_low_minor:  min(all, currentMinor),
    month_low_minor:  min(lowSince(rows, monthStart), currentMinor),
    last30_low_minor: min(lowSince(rows, d30), currentMinor),
    local_since:      since,
  }
}

/** Intervalos aceitos pelo gráfico. */
export type Range = '30d' | '90d' | '1y' | 'all'

export function rangeStart(range: Range, now: Date = new Date()): Date | null {
  switch (range) {
    case '30d': return new Date(now.getTime() - 30 * 86_400_000)
    case '90d': return new Date(now.getTime() - 90 * 86_400_000)
    case '1y':  return new Date(now.getTime() - 365 * 86_400_000)
    case 'all': return null
  }
}

export function parseRange(v: unknown): Range {
  return v === '30d' || v === '90d' || v === '1y' || v === 'all' ? v : '90d'
}
