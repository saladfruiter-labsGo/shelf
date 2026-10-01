/**
 * Rotas do "Entrar com a Steam".
 *
 * Ficam fora de `/api` de propósito: a volta da Steam é uma navegação vinda de
 * outro site (`Sec-Fetch-Site: cross-site`), que o `sameOriginApi` recusaria.
 * A proteção aqui é outra: um `state` de uso único com validade curta, o
 * `return_to` exato que o Shelf gerou e a assinatura confirmada com a Steam.
 */
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { Hono, type Context } from 'hono'
import { cfg, setCfg } from '../integrations/config.js'
import { buildSteamLoginUrl, checkAssertionShape, verifyWithSteam } from '../steam/openid.js'

const STATE_KEY = 'STEAM_OPENID_STATE'
const STATE_TTL_MS = 10 * 60_000

interface PendingLogin {
  state: string
  returnTo: string
  expiresAt: number
}

function readPending(): PendingLogin | null {
  try {
    const parsed = JSON.parse(cfg(STATE_KEY) || 'null') as PendingLogin | null
    return parsed && typeof parsed.state === 'string' ? parsed : null
  } catch {
    return null
  }
}

/** Origem que o navegador está usando (respeita um proxy TLS na frente). */
function browserOrigin(c: Context): string {
  const url = new URL(c.req.url)
  const proto = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim() || url.protocol.replace(':', '')
  const host = c.req.header('x-forwarded-host')?.split(',')[0]?.trim() || url.host
  return `${proto}://${host}`
}

function sameState(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

function backToIntegrations(c: Context, result: 'conectado' | 'erro', reason?: string) {
  const qs = new URLSearchParams({ steam: result })
  if (reason) qs.set('motivo', reason)
  return c.redirect(`/integrations?${qs}`, 302)
}

export function createSteamAuthRoutes(fetchImpl: typeof fetch = fetch) {
  const app = new Hono()

  app.get('/login', (c) => {
    const origin = browserOrigin(c)
    const state = randomBytes(16).toString('hex')
    const returnTo = `${origin}/auth/steam/callback?state=${state}`
    setCfg(STATE_KEY, JSON.stringify({ state, returnTo, expiresAt: Date.now() + STATE_TTL_MS } satisfies PendingLogin))
    c.header('Cache-Control', 'no-store')
    return c.redirect(buildSteamLoginUrl(returnTo, origin), 302)
  })

  app.get('/callback', async (c) => {
    c.header('Cache-Control', 'no-store')
    const params = Object.fromEntries(new URL(c.req.url).searchParams.entries())
    const pending = readPending()
    // O state é de uso único: consumido já na primeira volta, valendo ou não.
    setCfg(STATE_KEY, '')

    if (!pending || !params.state || !sameState(params.state, pending.state)) {
      return backToIntegrations(c, 'erro', 'Login expirado ou iniciado em outra aba. Tente de novo.')
    }
    if (Date.now() > pending.expiresAt) {
      return backToIntegrations(c, 'erro', 'Login expirado. Tente de novo.')
    }

    const shape = checkAssertionShape(params, pending.returnTo)
    if (!shape.ok) return backToIntegrations(c, 'erro', shape.reason)

    if (!(await verifyWithSteam(params, fetchImpl))) {
      return backToIntegrations(c, 'erro', 'A Steam não confirmou o login.')
    }

    setCfg('STEAM_ID', shape.steamId)
    return backToIntegrations(c, 'conectado')
  })

  return app
}

export default createSteamAuthRoutes()
