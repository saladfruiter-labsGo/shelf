import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import searchRoutes   from './routes/search.js'
import mediaRoutes    from './routes/media.js'
import wrapRoutes     from './routes/wrap.js'
import settingsRoutes from './routes/settings.js'
import detailsRoutes  from './routes/details.js'
import listsRoutes    from './routes/lists.js'
import seriesRoutes   from './routes/series.js'
import diaryRoutes    from './routes/diary.js'
import imgRoutes      from './routes/img.js'
import integrationsRoutes from './routes/integrations.js'
import pricesRoutes    from './routes/prices.js'
import transferRoutes  from './routes/transfer.js'
import { startPriceSync } from './prices/sync.js'
import { startSteamSync } from './steam/sync.js'
import { startBackupScheduler } from './backup.js'

const app = new Hono()

app.use('*', logger())
app.use('/api/*', cors())

app.route('/api/search',   searchRoutes)
app.route('/api/media',    mediaRoutes)
app.route('/api/wrap',     wrapRoutes)
app.route('/api/settings', settingsRoutes)
app.route('/api/details',  detailsRoutes)
app.route('/api/lists',    listsRoutes)
app.route('/api/series',   seriesRoutes)
app.route('/api/diary',    diaryRoutes)
app.route('/api/img',      imgRoutes)
app.route('/api/integrations', integrationsRoutes)
app.route('/api/prices',  pricesRoutes)
app.route('/api/transfer', transferRoutes)

app.get('/api/health', (c) => c.json({ ok: true }))

app.use('/*', serveStatic({ root: './dist/public' }))
app.get('/*', serveStatic({ path: './dist/public/index.html' }))

const port = parseInt(process.env.PORT ?? '3000')
console.log(`Shelf running on http://localhost:${port}`)

serve({ fetch: app.fetch, port })

// Preços do backlog: primeira passada logo após o boot, depois a cada 6 h.
startPriceSync()

// Backlog ↔ wishlist da Steam: mesma cadência (6 h), quando o conector está ativo.
startSteamSync()

// Snapshot integral verificado, independente do export JSON portátil.
startBackupScheduler()
