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
import coversRoutes   from './routes/covers.js'
import steamAuthRoutes from './routes/steam-auth.js'
import profileRoutes from './routes/profile.js'
import gamesRoutes from './routes/games.js'
import authRoutes from './routes/auth.js'
import adminRoutes from './routes/admin.js'
import onboardingRoutes from './routes/onboarding.js'
import messagesRoutes from './routes/messages.js'
import { accountRoutes, usersRoutes } from './routes/account.js'
import { apiAuth, pageAuth } from './auth/middleware.js'
import integrationsRoutes from './routes/integrations.js'
import pricesRoutes    from './routes/prices.js'
import transferRoutes  from './routes/transfer.js'
import { limitedApiBody, noStoreDynamicApi, sameOriginApi, shelfSecurityHeaders } from './security.js'
import { legacyDb, setAfterUserWork } from './db.js'
import { feedRoutes, notificationRoutes, socialRoutes } from './routes/social.js'
import { drainSocialOutbox } from './social/feed-sync.js'

// Diário e conquistas novos chegam ao feed ao fim de cada requisição e job.
setAfterUserWork(drainSocialOutbox)

/**
 * A aplicação HTTP inteira, sem servidor nem jobs — o `index.ts` a serve, e
 * os testes de ponta a ponta (login, isolamento entre contas) a usam direto.
 */
export function createApp(options: { log?: boolean; isShuttingDown?: () => boolean } = {}) {
  const app = new Hono()
  const healthQuery = legacyDb.prepare('SELECT 1 AS ok')

  if (options.log !== false) app.use('*', logger())
  app.use('*', shelfSecurityHeaders)
  app.use('/api/*', sameOriginApi)
  app.use('/api/*', limitedApiBody)
  app.use('/api/*', noStoreDynamicApi)
  // Toda a API exige sessão (exceto login e saúde) e roda no banco de quem a abriu.
  app.use('/api/*', apiAuth)

  app.route('/api/auth',     authRoutes)
  app.route('/api/account',  accountRoutes)
  app.route('/api/users',    usersRoutes)
  app.route('/api/admin',    adminRoutes)
  app.route('/api/feed',     feedRoutes)
  app.route('/api/social',   socialRoutes)
  app.route('/api/notifications', notificationRoutes)
  app.route('/api/messages', messagesRoutes)
  app.route('/api/onboarding', onboardingRoutes)

  app.route('/api/search',   searchRoutes)
  app.route('/api/media',    mediaRoutes)
  app.route('/api/wrap',     wrapRoutes)
  app.route('/api/settings', settingsRoutes)
  app.route('/api/details',  detailsRoutes)
  app.route('/api/lists',    listsRoutes)
  app.route('/api/series',   seriesRoutes)
  app.route('/api/diary',    diaryRoutes)
  app.route('/api/img',      imgRoutes)
  app.route('/api/covers',   coversRoutes)
  app.route('/api/integrations', integrationsRoutes)
  app.route('/api/prices',  pricesRoutes)
  app.route('/api/transfer', transferRoutes)
  app.route('/api/profile',  profileRoutes)
  app.route('/api/games',    gamesRoutes)

  // "Entrar com a Steam": fora de /api porque a volta é navegação vinda da Steam.
  app.use('/auth/steam/*', pageAuth)
  app.route('/auth/steam', steamAuthRoutes)

  app.get('/api/health', (c) => {
    if (options.isShuttingDown?.()) return c.json({ ok: false, reason: 'shutting_down' }, 503)
    try {
      healthQuery.get()
      return c.json({ ok: true })
    } catch {
      return c.json({ ok: false, reason: 'database_unavailable' }, 503)
    }
  })

  return app
}
