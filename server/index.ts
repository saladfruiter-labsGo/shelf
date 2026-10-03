import 'dotenv/config'
import { serve } from '@hono/node-server'
import { serveStatic } from '@hono/node-server/serve-static'
import { createApp } from './app.js'
import { announceSetupCode } from './routes/auth.js'
import { pruneExpiredSessions } from './auth/accounts.js'
import { stopSteamDiagnostic } from './steam/diagnostic.js'
import { startIntegrationPolling, stopIntegrationPolling } from './routes/integrations.js'
import { startPriceSync, stopPriceSync } from './prices/sync.js'
import { startSteamSync, stopSteamSync } from './steam/sync.js'
import { startSteamLibrarySync, stopSteamLibrarySync } from './steam/library.js'
import { stopSteamAchievements } from './steam/achievements.js'
import { stopTimeToBeatSync } from './igdb.js'
import { stopSteamCovers } from './steam/covers.js'
import { purgeHiddenGames } from './steam/hidden.js'
import { startBackupScheduler, stopBackupScheduler } from './backup.js'
import { allDatabases, forEachActiveUser } from './db.js'
import { shutdownServices } from './lifecycle.js'
import { startActivityRetention, stopActivityRetention } from './activity-retention.js'
import { startDiaryProgressJob, stopDiaryProgressJob } from './diary-progress.js'

let shuttingDown = false
const app = createApp({ isShuttingDown: () => shuttingDown })

app.use('/*', serveStatic({ root: './dist/public' }))
app.get('/*', serveStatic({ path: './dist/public/index.html' }))

const port = parseInt(process.env.PORT ?? '3000')
console.log(`Shelf running on http://localhost:${port}`)

const server = serve({ fetch: app.fetch, port })

// Preços do backlog: primeira passada logo após o boot, depois a cada 6 h.
startPriceSync()

// Backlog ↔ wishlist da Steam: mesma cadência (6 h), quando o conector está ativo.
startSteamSync()

// Biblioteca, tempo de jogo e última vez jogada vindos da Steam, a cada 30 min.
startSteamLibrarySync()

// Programas que não são jogo (Wallpaper Engine) saem já no boot, venham da Steam ou do Playnite.
forEachActiveUser(() => purgeHiddenGames(), 'hidden-games').catch(e => console.error('[hidden-games]', (e as Error).message))

// Sem contas ainda: o log mostra o código para criar a conta de dono.
announceSetupCode()
try { pruneExpiredSessions() } catch { /* limpeza oportunista */ }

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
    database: allDatabases as never,
    stopBackgroundJobs: [
      stopIntegrationPolling,
      stopPriceSync,
      stopSteamSync,
      stopSteamLibrarySync,
      stopSteamAchievements,
      stopTimeToBeatSync,
      stopSteamCovers,
      stopSteamDiagnostic,
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
