import { timingSafeEqual } from 'node:crypto'
import type { Context, MiddlewareHandler, Next } from 'hono'
import { deleteCookie, getCookie, setCookie } from 'hono/cookie'
import { getConnInfo } from '@hono/node-server/conninfo'
import { core } from '../core-db.js'
import { instanceHasUsers, runAsUser } from '../db.js'
import { cfg } from '../integrations/config.js'
import {
  SESSION_COOKIE, SESSION_DAYS, isAdmin, sessionUser, touchSession, type UserRow,
} from './accounts.js'

declare module 'hono' {
  interface ContextVariableMap {
    user: UserRow
    sessionToken: string
  }
}

/** Atrás do `tailscale serve` o TLS termina no proxy; o protocolo vem no cabeçalho. */
export function isHttps(c: Context): boolean {
  const forwarded = c.req.header('x-forwarded-proto')?.split(',')[0]?.trim()
  if (forwarded) return forwarded === 'https'
  return new URL(c.req.url).protocol === 'https:'
}

export function clientIp(c: Context): string {
  try {
    return getConnInfo(c).remote.address ?? 'unknown'
  } catch {
    return 'local'
  }
}

export function setSessionCookie(c: Context, token: string): void {
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: isHttps(c),
    path: '/',
    maxAge: SESSION_DAYS * 24 * 3600,
  })
}

export function clearSessionCookie(c: Context): void {
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: isHttps(c) })
}

function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a)
  const right = Buffer.from(b)
  return left.length === right.length && timingSafeEqual(left, right)
}

/**
 * Webhooks (Plex, Playnite) não têm sessão: quem manda é identificado pelo
 * segredo da própria integração. Segredo vazio nunca casa.
 */
export function findWebhookOwner(secretKey: string, token: string): number | null {
  if (!token || token.length > 200) return null
  const ids = core("SELECT id FROM users WHERE status = 'active' ORDER BY id").all() as { id: number }[]
  for (const { id } of ids) {
    const secret = runAsUser(id, () => cfg(secretKey))
    if (secret && safeEqual(secret, token)) return id
  }
  return null
}

const WEBHOOKS: Record<string, string> = {
  '/api/integrations/plex/webhook': 'PLEX_WEBHOOK_SECRET',
  '/api/integrations/playnite/webhook': 'PLAYNITE_WEBHOOK_SECRET',
}

function unauthenticated(c: Context) {
  return c.json({
    error: 'Faça login para continuar.',
    code: instanceHasUsers() ? 'unauthenticated' : 'setup_required',
  }, 401)
}

async function requireSession(c: Context, next: Next) {
  const token = getCookie(c, SESSION_COOKIE)
  const lookup = sessionUser(token)
  if (!lookup || !token) return unauthenticated(c)
  touchSession(lookup)
  // Com senha provisória, a única coisa liberada é trocá-la (rota em /api/auth).
  if (lookup.user.must_change_password === 1) {
    return c.json({ error: 'Troque a senha provisória antes de continuar.', code: 'password_change_required' }, 403)
  }
  c.set('user', lookup.user)
  c.set('sessionToken', token)
  return runAsUser(lookup.user.id, () => next())
}

/**
 * Porta de entrada de toda a API. Só a saúde e as rotas de login ficam
 * abertas; o resto exige sessão e roda no banco pessoal de quem a abriu.
 */
export const apiAuth: MiddlewareHandler = async (c, next) => {
  const path = c.req.path
  if (path === '/api/health' || path.startsWith('/api/auth/')) return next()

  const webhookKey = WEBHOOKS[path]
  if (webhookKey) {
    // Antes da primeira conta o Shelf ainda é de um banco só.
    if (!instanceHasUsers()) return next()
    const token = c.req.query('token') ?? ''
    const owner = findWebhookOwner(webhookKey, token)
    if (owner == null) return c.json({ error: 'unauthorized' }, 401)
    return runAsUser(owner, () => next())
  }

  return requireSession(c, next)
}

/** Páginas fora de /api que mexem em dados pessoais (volta do login da Steam). */
export const pageAuth: MiddlewareHandler = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE)
  const lookup = sessionUser(token)
  if (!lookup || lookup.user.must_change_password === 1) return c.redirect('/', 302)
  c.set('user', lookup.user)
  return runAsUser(lookup.user.id, () => next())
}

export const requireAdmin: MiddlewareHandler = async (c, next) => {
  const user = c.get('user')
  if (!user || !isAdmin(user)) return c.json({ error: 'Apenas administradores.' }, 403)
  return next()
}
