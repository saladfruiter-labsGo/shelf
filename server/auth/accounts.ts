import { createHash, randomBytes } from 'node:crypto'
import { core } from '../core-db.js'
import { OWNER_DB_FILE, instanceHasUsers, newUserDatabaseFile, userDatabase } from '../db.js'
import { hashPassword } from './password.js'

export type Role = 'owner' | 'admin' | 'member'
export type UserStatus = 'active' | 'disabled'

export interface UserRow {
  id: number
  username: string
  display_name: string
  password_hash: string
  role: Role
  status: UserStatus
  must_change_password: number
  db_file: string
  avatar_file: string | null
  bio: string | null
  created_by: number | null
  created_at: string
  updated_at: string
  password_changed_at: string | null
  last_seen_at: string | null
}

/** O que pode sair para o navegador sobre a própria conta. */
export interface PublicSelf {
  id: number
  username: string
  display_name: string
  role: Role
  is_admin: boolean
  avatar_url: string | null
  bio: string | null
  must_change_password: boolean
}

export const USERNAME_RE = /^[a-z0-9](?:[a-z0-9._-]{1,30}[a-z0-9])?$/
export const DISPLAY_NAME_MAX = 60

export function isAdmin(user: Pick<UserRow, 'role'>): boolean {
  return user.role === 'owner' || user.role === 'admin'
}

export function avatarUrl(file: string | null): string | null {
  return file ? `/api/users/avatar/${file}` : null
}

export function publicSelf(user: UserRow): PublicSelf {
  return {
    id: user.id,
    username: user.username,
    display_name: user.display_name,
    role: user.role,
    is_admin: isAdmin(user),
    avatar_url: avatarUrl(user.avatar_file),
    bio: user.bio,
    must_change_password: user.must_change_password === 1,
  }
}

export function normalizeUsername(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const username = raw.trim().toLowerCase()
  return USERNAME_RE.test(username) ? username : null
}

export function cleanDisplayName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw.replace(/\s+/g, ' ').trim()
  return name.length >= 1 && name.length <= DISPLAY_NAME_MAX ? name : null
}

export function getUser(id: number): UserRow | undefined {
  return core('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined
}

export function getUserByUsername(username: string): UserRow | undefined {
  return core('SELECT * FROM users WHERE username = ?').get(username) as UserRow | undefined
}

export function audit(actorId: number | null, action: string, targetId: number | null, detail?: string): void {
  core('INSERT INTO audit_log (actor_user_id, action, target_user_id, detail) VALUES (?, ?, ?, ?)')
    .run(actorId, action, targetId, detail ?? null)
}

/**
 * Cria a conta e o banco pessoal dela. O dono (primeira conta) fica com o
 * `shelf.db` histórico; as demais nascem com um banco vazio já migrado.
 */
export async function createUser(input: {
  username: string
  display_name: string
  password: string
  role: Role
  must_change_password: boolean
  created_by: number | null
}): Promise<UserRow> {
  const hash = await hashPassword(input.password)
  const dbFile = input.role === 'owner' ? OWNER_DB_FILE : newUserDatabaseFile()
  const res = core(`
    INSERT INTO users (username, display_name, password_hash, role, must_change_password, db_file, created_by, password_changed_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'))
  `).run(input.username, input.display_name, hash, input.role, input.must_change_password ? 1 : 0, dbFile, input.created_by)
  const id = Number(res.lastInsertRowid)
  try {
    userDatabase(id)
  } catch (error) {
    core('DELETE FROM users WHERE id = ?').run(id)
    throw error
  }
  instanceHasUsers()
  return getUser(id)!
}

export async function setPassword(userId: number, password: string, mustChange: boolean): Promise<void> {
  const hash = await hashPassword(password)
  core(`
    UPDATE users SET password_hash = ?, must_change_password = ?, password_changed_at = datetime('now'),
                     updated_at = datetime('now')
     WHERE id = ?
  `).run(hash, mustChange ? 1 : 0, userId)
}

/* ─────────────────────────────── Sessões ─────────────────────────────── */

export const SESSION_COOKIE = 'shelf_session'
export const SESSION_DAYS = 30
const TOUCH_EVERY_MS = 60 * 60 * 1000

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

export function createSession(userId: number, userAgent: string | undefined): string {
  const token = randomBytes(32).toString('base64url')
  core(`
    INSERT INTO sessions (user_id, token_hash, user_agent, expires_at)
    VALUES (?, ?, ?, datetime('now', ?))
  `).run(userId, hashToken(token), userAgent?.slice(0, 200) ?? null, `+${SESSION_DAYS} days`)
  return token
}

interface SessionLookup { session_id: number; last_seen_at: string; user: UserRow }

/** Sessão válida e conta ativa — qualquer outra combinação é "não autenticado". */
export function sessionUser(token: string | undefined): SessionLookup | null {
  if (!token || token.length > 200) return null
  const row = core(`
    SELECT s.id AS session_id, s.last_seen_at AS session_seen, u.*
      FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = ? AND s.expires_at > datetime('now') AND u.status = 'active'
  `).get(hashToken(token)) as (UserRow & { session_id: number; session_seen: string }) | undefined
  if (!row) return null
  const { session_id, session_seen, ...user } = row
  return { session_id, last_seen_at: session_seen, user: user as UserRow }
}

/** Renova a validade no máximo uma vez por hora, para não escrever a cada requisição. */
export function touchSession(lookup: SessionLookup): void {
  const seen = Date.parse(lookup.last_seen_at.replace(' ', 'T') + 'Z')
  if (Number.isFinite(seen) && Date.now() - seen < TOUCH_EVERY_MS) return
  core(`
    UPDATE sessions SET last_seen_at = datetime('now'), expires_at = datetime('now', ?) WHERE id = ?
  `).run(`+${SESSION_DAYS} days`, lookup.session_id)
  core("UPDATE users SET last_seen_at = datetime('now') WHERE id = ?").run(lookup.user.id)
}

export function deleteSession(token: string): void {
  core('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token))
}

export function revokeSessions(userId: number, exceptToken?: string): void {
  if (exceptToken) {
    core('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?').run(userId, hashToken(exceptToken))
  } else {
    core('DELETE FROM sessions WHERE user_id = ?').run(userId)
  }
}

export function pruneExpiredSessions(): void {
  core("DELETE FROM sessions WHERE expires_at <= datetime('now')").run()
}
