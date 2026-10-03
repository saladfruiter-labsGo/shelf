import { Hono } from 'hono'
import { isAdmin } from '../auth/accounts.js'
import { applyOnboardingAction, onboardingView, parseOnboardingAction } from '../onboarding.js'

const app = new Hono()

const admin = (user: Parameters<typeof isAdmin>[0] | undefined) => !user || isAdmin(user)

app.get('/', (c) => c.json(onboardingView(admin(c.get('user')))))

/** Pular/retomar um passo, deixar o roteiro para depois ou recomeçá-lo. */
app.patch('/', async (c) => {
  const action = parseOnboardingAction(await c.req.json().catch(() => null))
  if (!action) return c.json({ error: 'Ação inválida.' }, 400)
  applyOnboardingAction(action)
  return c.json(onboardingView(admin(c.get('user'))))
})

export default app
