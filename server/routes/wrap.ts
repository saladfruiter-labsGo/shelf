import { Hono } from 'hono'
import { db } from '../db.js'

const app = new Hono()

type WrapPeriod = 'annual' | 'monthly'

function activityBuckets(period: WrapPeriod, year: number, month: number, rows: { period_key: string; count: number }[]) {
  const count = period === 'monthly' ? new Date(Date.UTC(year, month, 0)).getUTCDate() : 12
  const byKey = new Map(rows.map(row => [row.period_key, row.count]))
  return Array.from({ length: count }, (_, index) => {
    const key = String(index + 1).padStart(2, '0')
    return { period_key: key, count: byKey.get(key) ?? 0 }
  })
}

// /api/wrap?period=annual&year=2024
// /api/wrap?period=monthly&year=2024&month=8
app.get('/', (c) => {
  const period: WrapPeriod = c.req.query('period') === 'monthly' ? 'monthly' : 'annual'
  const currentYear = new Date().getFullYear()
  const requestedYear = Number.parseInt(c.req.query('year') ?? '', 10)
  const year = Number.isInteger(requestedYear) ? requestedYear : currentYear
  const requestedMonth = Number.parseInt(c.req.query('month') ?? '', 10)
  const month = Number.isInteger(requestedMonth) && requestedMonth >= 1 && requestedMonth <= 12
    ? requestedMonth
    : new Date().getMonth() + 1

  // O Wrap mede consumo, portanto a data vem do diário. `added_at` costuma ser
  // a data de uma importação em lote e concentra artificialmente o gráfico.
  const dateFilter = period === 'monthly'
    ? "strftime('%Y-%m', d.watched_at) = ?"
    : "strftime('%Y', d.watched_at) = ?"
  const dateValue = period === 'monthly'
    ? `${year}-${String(month).padStart(2, '0')}`
    : String(year)

  const totalByType = db.prepare(`
    SELECT m.type, COUNT(DISTINCT m.id) as count
    FROM media_items m
    JOIN diary_entries d ON d.media_item_id = m.id
    WHERE ${dateFilter}
    GROUP BY m.type
  `).all(dateValue) as { type: string; count: number }[]

  const avgRating = db.prepare(`
    SELECT m.type, ROUND(AVG(d.rating), 1) as avg
    FROM media_items m
    JOIN diary_entries d ON d.media_item_id = m.id
    WHERE ${dateFilter} AND d.rating > 0
    GROUP BY m.type
  `).all(dateValue) as { type: string; avg: number }[]

  const topByType: Record<string, unknown[]> = {}
  for (const t of ['movie', 'series', 'game', 'book']) {
    topByType[t] = db.prepare(`
      SELECT m.* FROM media_items m
      WHERE m.type = ? AND EXISTS (
        SELECT 1 FROM diary_entries d
        WHERE d.media_item_id = m.id AND ${dateFilter}
      )
      ORDER BY m.rating DESC, m.completed_at DESC, m.added_at DESC
      LIMIT 5
    `).all(t, dateValue)
  }

  const activityRows = db.prepare(`
    SELECT
      ${period === 'monthly' ? "strftime('%d', d.watched_at)" : "strftime('%m', d.watched_at)"} as period_key,
      COUNT(*) as count
    FROM diary_entries d
    WHERE ${dateFilter}
    GROUP BY period_key
    ORDER BY period_key
  `).all(dateValue) as { period_key: string; count: number }[]
  const activity = activityBuckets(period, year, month, activityRows)

  const totalRuntime = db.prepare(`
    SELECT COALESCE(SUM(m.runtime), 0) as minutes
    FROM media_items m
    WHERE m.runtime IS NOT NULL AND EXISTS (
      SELECT 1 FROM diary_entries d
      WHERE d.media_item_id = m.id AND ${dateFilter}
    )
  `).get(dateValue) as { minutes: number }

  const dominantGenre = db.prepare(`
    SELECT m.genre, COUNT(DISTINCT m.id) as cnt
    FROM media_items m
    WHERE m.genre IS NOT NULL AND EXISTS (
      SELECT 1 FROM diary_entries d
      WHERE d.media_item_id = m.id AND ${dateFilter}
    )
    GROUP BY m.genre
    ORDER BY cnt DESC
    LIMIT 1
  `).get(dateValue) as { genre: string; cnt: number } | undefined

  return c.json({
    period,
    year,
    month: period === 'monthly' ? month : undefined,
    total: totalByType.reduce((s, r) => s + r.count, 0),
    byType: totalByType,
    avgRating,
    topByType,
    activity,
    totalRuntimeMinutes: totalRuntime.minutes,
    dominantGenre: dominantGenre?.genre ?? null,
  })
})

export default app
