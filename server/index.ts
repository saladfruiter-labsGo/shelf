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

const app = new Hono()

app.use('*', logger())
app.use('/api/*', cors())

app.route('/api/search',   searchRoutes)
app.route('/api/media',    mediaRoutes)
app.route('/api/wrap',     wrapRoutes)
app.route('/api/settings', settingsRoutes)

app.get('/api/health', (c) => c.json({ ok: true }))

app.use('/*', serveStatic({ root: './dist/public' }))
app.get('/*', serveStatic({ path: './dist/public/index.html' }))

const port = parseInt(process.env.PORT ?? '3000')
console.log(`Shelf running on http://localhost:${port}`)

serve({ fetch: app.fetch, port })
