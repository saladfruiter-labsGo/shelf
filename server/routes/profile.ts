import { Hono } from 'hono'
import { applyProfileUpdate, buildProfile, parseProfileUpdate } from '../profile.js'

const app = new Hono()

// Hoje há um perfil só; no multiusuário vira /api/users/:username/profile.
app.get('/', async (c) => c.json(await buildProfile()))

app.patch('/', async (c) => {
  const parsed = parseProfileUpdate(await c.req.json().catch(() => null))
  if (!parsed.ok) return c.json({ error: parsed.error }, 400)
  applyProfileUpdate(parsed.update)
  return c.json(await buildProfile())
})

export default app
