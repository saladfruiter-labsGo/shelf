import { Hono } from 'hono'
import { db } from '../db.js'

const app = new Hono()

// /api/wrap?period=annual&year=2024
// /api/wrap?period=monthly&year=2024&month=8
app.get('/', (c) => {
  const period = c.req.query('period') ?? 'annual'
  const year   = parseInt(c.req.query('year') ?? String(new Date().getFullYear()))
  const month  = parseInt(c.req.query('month') ?? String(new Date().getMonth() + 1))

  let dateFilter: string
  if (period === 'monthly') {
    const pad = String(month).padStart(2, '0')
    dateFilter = `strftime('%Y-%m', added_at) = '${year}-${pad}'`
  } else {
    dateFilter = `strftime('%Y', added_at) = '${year}'`
  }

  const totalByType = db.prepare(`
    SELECT type, COUNT(*) as count
    FROM media_items
    WHERE ${dateFilter} AND status = 'completed'
    GROUP BY type
  `).all() as { type: string; count: number }[]

  const avgRating = db.prepare(`
    SELECT type, ROUND(AVG(rating), 1) as avg
    FROM media_items
    WHERE ${dateFilter} AND status = 'completed' AND rating > 0
    GROUP BY type
  `).all() as { type: string; avg: number }[]

  const topByType: Record<string, unknown[]> = {}
  for (const t of ['movie', 'series', 'game', 'book']) {
    topByType[t] = db.prepare(`
      SELECT * FROM media_items
      WHERE ${dateFilter} AND type = ? AND status = 'completed'
      ORDER BY rating DESC, added_at DESC
      LIMIT 5
    `).all(t)
  }

  const activity = db.prepare(`
    SELECT
      ${period === 'monthly' ? "strftime('%d', added_at)" : "strftime('%m', added_at)"} as period_key,
      COUNT(*) as count
    FROM media_items
    WHERE ${dateFilter}
    GROUP BY period_key
    ORDER BY period_key
  `).all() as { period_key: string; count: number }[]

  const totalRuntime = db.prepare(`
    SELECT COALESCE(SUM(runtime), 0) as minutes
    FROM media_items
    WHERE ${dateFilter} AND status = 'completed' AND runtime IS NOT NULL
  `).get() as { minutes: number }

  const dominantGenre = db.prepare(`
    SELECT genre, COUNT(*) as cnt
    FROM media_items
    WHERE ${dateFilter} AND status = 'completed' AND genre IS NOT NULL
    GROUP BY genre
    ORDER BY cnt DESC
    LIMIT 1
  `).get() as { genre: string; cnt: number } | undefined

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
