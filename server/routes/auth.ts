import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { getCookie } from 'hono/cookie'
import { core } from '../core-db.js'
import { instanceHasUsers } from '../db.js'
import {
  SESSION_COOKIE, audit, cleanDisplayName, createSession, createUser, deleteSession, getUser,
  getUserByUsername, normalizeUsername, publicSelf, revokeSessions, sessionUser, setPassword,
} from '../auth/accounts.js'
import { clearSessionCookie, clientIp, setSessionCookie } from '../auth/middleware.js'
import { dummyPasswordHash, passwordProblem, verifyPassword } from '../auth/password.js'
import { FailureLimiter } from '../auth/rate-limit.js'

const app = new Hono()

/* ─────────────────────────── Código de instalação ─────────────────────────── */

/**
 * O primeiro acesso cria a conta de dono. Para que ninguém na tailnet chegue
 * antes, a criação exige um código que só existe no log do servidor (ou em
 * SHELF_SETUP_TOKEN). Ele muda a cada boot e some depois do setup.
 */
const setupCode = process.env.SHELF_SETUP_TOKEN?.trim() || randomBytes(9).toString('base64url')

export function announceSetupCode(): void {
  if (instanceHasUsers()) return
  const fromEnv = Boolean(process.env.SHELF_SETUP_TOKEN?.trim())
  console.log('──────────────────────────────────────────────────────────────')
  console.log(' Shelf ainda não tem contas. Abra o site e crie a conta de dono.')
  console.log(fromEnv ? ' Código de instalação: o valor de SHELF_SETUP_TOKEN.' : ` Código de instalação: ${setupCode}`)
  console.log('──────────────────────────────────────────────────────────────')
}

function codeMatches(input: string): boolean {
  const a = Buffer.from(input)
  const b = Buffer.from(setupCode)
  return a.length === b.length && timingSafeEqual(a, b)
}

/* ───────────────────────────────── Limites ───────────────────────────────── */

const loginByIp = new FailureLimiter(20, 15 * 60_000)
const loginByUser = new FailureLimiter(8, 15 * 60_000)
const setupByIp = new FailureLimiter(5, 15 * 60_000)
const passwordByUser = new FailureLimiter(8, 15 * 60_000)

function tooMany(c: Context, seconds: number) {
  c.header('Retry-After', String(seconds))
  const minutes = Math.max(1, Math.ceil(seconds / 60))
  return c.json({ error: `Muitas tentativas. Tente de novo em ${minutes} min.` }, 429)
}

async function body(c: { req: { json: () => Promise<unknown> } }): Promise<Record<string, unknown>> {
  const parsed = await c.req.json().catch(() => null)
  return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {}
}

/* ────────────────────────────────── Rotas ────────────────────────────────── */

/** Estado para a tela de entrada: precisa de setup? há alguém logado? */
app.get('/state', (c) => {
  if (!instanceHasUsers()) return c.json({ setup_required: true, user: null })
  const lookup = sessionUser(getCookie(c, SESSION_COOKIE))
  return c.json({ setup_required: false, user: lookup ? publicSelf(lookup.user) : null })
})

app.post('/setup', async (c) => {
  if (instanceHasUsers()) return c.json({ error: 'O Shelf já foi configurado.' }, 409)
  const ip = clientIp(c)
  const wait = setupByIp.retryAfter([ip])
  if (wait) return tooMany(c, wait)

  const b = await body(c)
  if (typeof b.setup_code !== 'string' || !codeMatches(b.setup_code.trim())) {
    setupByIp.fail([ip])
    return c.json({ error: 'Código de instalação incorreto. Ele aparece no log do servidor.' }, 403)
  }
  const username = normalizeUsername(b.username)
  if (!username) return c.json({ error: 'Usuário: 3 a 32 caracteres, letras minúsculas, números, ponto, hífen ou _.' }, 400)
  const displayName = cleanDisplayName(b.display_name) ?? username
  const problem = passwordProblem(b.password)
  if (problem) return c.json({ error: problem }, 400)

  const user = await createUser({
    username, display_name: displayName, password: b.password as string,
    role: 'owner', must_change_password: false, created_by: null,
  })
  audit(user.id, 'setup', user.id)
  setSessionCookie(c, createSession(user.id, c.req.header('user-agent')))
  core("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?").run(user.id)
  return c.json({ user: publicSelf(user) }, 201)
})

app.post('/login', async (c) => {
  const b = await body(c)
  const ip = clientIp(c)
  const username = normalizeUsername(b.username) ?? ''
  const keys = [`ip:${ip}`, `user:${username}`]
  const wait = Math.max(loginByIp.retryAfter([keys[0]]), loginByUser.retryAfter([keys[1]]))
  if (wait) return tooMany(c, wait)

  const password = typeof b.password === 'string' ? b.password : ''
  const user = username ? getUserByUsername(username) : undefined
  // Usuário inexistente gasta o mesmo tempo de um existente.
  const ok = await verifyPassword(password, user?.password_hash ?? await dummyPasswordHash())
  if (!user || !ok || user.status !== 'active') {
    loginByIp.fail([keys[0]])
    loginByUser.fail([keys[1]])
    return c.json({ error: 'Usuário ou senha incorretos.' }, 401)
  }

  loginByUser.clear(keys[1])
  setSessionCookie(c, createSession(user.id, c.req.header('user-agent')))
  core("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?").run(user.id)
  return c.json({ user: publicSelf(user) })
})

app.post('/logout', (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  if (token) deleteSession(token)
  clearSessionCookie(c)
  return c.json({ ok: true })
})

/**
 * Troca de senha pela própria pessoa. Fica em /api/auth porque é a única ação
 * liberada enquanto a senha provisória não foi trocada. Encerra as outras sessões.
 */
app.post('/password', async (c) => {
  const token = getCookie(c, SESSION_COOKIE)
  const lookup = sessionUser(token)
  if (!lookup || !token) return c.json({ error: 'Faça login para continuar.' }, 401)
  const key = `pw:${lookup.user.id}`
  const wait = passwordByUser.retryAfter([key])
  if (wait) return tooMany(c, wait)

  const b = await body(c)
  const current = typeof b.current_password === 'string' ? b.current_password : ''
  if (!(await verifyPassword(current, lookup.user.password_hash))) {
    passwordByUser.fail([key])
    return c.json({ error: 'A senha atual não confere.' }, 403)
  }
  const problem = passwordProblem(b.new_password)
  if (problem) return c.json({ error: problem }, 400)
  if (b.new_password === current) return c.json({ error: 'A nova senha precisa ser diferente da atual.' }, 400)

  await setPassword(lookup.user.id, b.new_password as string, false)
  revokeSessions(lookup.user.id, token)
  passwordByUser.clear(key)
  audit(lookup.user.id, 'password_changed', lookup.user.id)
  return c.json({ user: publicSelf(getUser(lookup.user.id)!) })
})

export default app
