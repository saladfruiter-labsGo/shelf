import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { Hono } from 'hono'
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
import integrationsRoutes, { startIntegrationPolling, stopIntegrationPolling } from './routes/integrations.js'
import pricesRoutes    from './routes/prices.js'
import transferRoutes  from './routes/transfer.js'
import { startPriceSync, stopPriceSync } from './prices/sync.js'
import { startSteamSync, stopSteamSync } from './steam/sync.js'
import { limitedApiBody, noStoreDynamicApi, sameOriginApi, shelfSecurityHeaders } from './security.js'
import { startBackupScheduler, stopBackupScheduler } from './backup.js'
import { db } from './db.js'
import { shutdownServices } from './lifecycle.js'
import { startActivityRetention, stopActivityRetention } from './activity-retention.js'
import { startDiaryProgressJob, stopDiaryProgressJob } from './diary-progress.js'

const app = new Hono()
let shuttingDown = false
const healthQuery = db.prepare('SELECT 1 AS ok')

app.use('*', logger())
app.use('*', shelfSecurityHeaders)
app.use('/api/*', sameOriginApi)
app.use('/api/*', limitedApiBody)
app.use('/api/*', noStoreDynamicApi)

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

app.get('/api/health', (c) => {
  if (shuttingDown) return c.json({ ok: false, reason: 'shutting_down' }, 503)
  try {
    healthQuery.get()
    return c.json({ ok: true })
  } catch {
    return c.json({ ok: false, reason: 'database_unavailable' }, 503)
  }
})

app.use('/*', serveStatic({ root: './dist/public' }))
app.get('/*', serveStatic({ path: './dist/public/index.html' }))

const port = parseInt(process.env.PORT ?? '3000')
console.log(`Shelf running on http://localhost:${port}`)

const server = serve({ fetch: app.fetch, port })

// Preços do backlog: primeira passada logo após o boot, depois a cada 6 h.
startPriceSync()

// Backlog ↔ wishlist da Steam: mesma cadência (6 h), quando o conector está ativo.
startSteamSync()

// Snapshot integral verificado, independente do export JSON portátil.
startBackupScheduler()

// Polls de Plex/Last.fm/Kavita começam explicitamente no bootstrap.
startIntegrationPolling()

// Fecha o último progresso diário de livros e jogos após a virada do dia.
startDiaryProgressJob()

// Payloads brutos são diagnósticos temporários; o histórico normalizado permanece.
startActivityRetention()

let shutdownPromise: Promise<void> | null = null
function requestShutdown(reason: string, exitCode: number): void {
  if (shutdownPromise) return
  shuttingDown = true
  console.log(`[shutdown] ${reason}: drenando conexões e jobs...`)
  shutdownPromise = shutdownServices({
    server,
    database: db,
    stopBackgroundJobs: [
      stopIntegrationPolling,
      stopPriceSync,
      stopSteamSync,
      stopBackupScheduler,
      stopActivityRetention,
      stopDiaryProgressJob,
    ],
  }).then(() => {
    console.log('[shutdown] SQLite fechado após checkpoint do WAL.')
    process.exitCode = exitCode
  }).catch(error => {
    console.error('[shutdown] falha ao encerrar com segurança:', error)
    process.exit(1)
  })
}

process.once('SIGTERM', () => requestShutdown('SIGTERM', 0))
process.once('SIGINT', () => requestShutdown('SIGINT', 0))
process.once('uncaughtException', error => {
  console.error('[fatal] exceção não tratada:', error)
  requestShutdown('uncaughtException', 1)
})
process.once('unhandledRejection', reason => {
  console.error('[fatal] promise rejeitada sem tratamento:', reason)
  requestShutdown('unhandledRejection', 1)
})
