import { Hono } from 'hono'
import { core } from '../core-db.js'
import {
  audit, avatarUrl, cleanDisplayName, createUser, getUser, getUserByUsername, normalizeUsername,
  revokeSessions, setPassword, type Role, type UserRow,
} from '../auth/accounts.js'
import { requireAdmin } from '../auth/middleware.js'
import { passwordProblem, temporaryPassword } from '../auth/password.js'

/**
 * Contas só nascem pelas mãos de um administrador — não existe cadastro
 * aberto nem convite público. A senha inicial é provisória: no primeiro
 * login a pessoa é obrigada a trocá-la.
 *
 * Hierarquia: o dono (quem instalou) não pode ser rebaixado nem desativado;
 * só o dono promove ou rebaixa administradores e mexe na conta deles.
 */
const app = new Hono()
app.use('*', requireAdmin)

function adminView(u: UserRow) {
  return {
    id: u.id,
    username: u.username,
    display_name: u.display_name,
    role: u.role,
    status: u.status,
    avatar_url: avatarUrl(u.avatar_file),
    must_change_password: u.must_change_password === 1,
    created_at: u.created_at,
    last_seen_at: u.last_seen_at,
  }
}

/** Quem pode administrar a conta `target`. */
function canManage(actor: UserRow, target: UserRow): boolean {
  if (target.role === 'owner') return actor.id === target.id
  if (target.role === 'admin') return actor.role === 'owner'
  return true
}

app.get('/users', (c) => {
  const rows = core('SELECT * FROM users ORDER BY created_at, id').all() as UserRow[]
  return c.json(rows.map(adminView))
})

app.post('/users', async (c) => {
  const actor = c.get('user')
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const username = normalizeUsername(b.username)
  if (!username) return c.json({ error: 'Usuário: 3 a 32 caracteres, letras minúsculas, números, ponto, hífen ou _.' }, 400)
  if (getUserByUsername(username)) return c.json({ error: 'Esse usuário já existe.' }, 409)
  const displayName = cleanDisplayName(b.display_name) ?? username
  const role: Role = b.role === 'admin' ? 'admin' : 'member'
  if (role === 'admin' && actor.role !== 'owner') return c.json({ error: 'Só o dono cria administradores.' }, 403)

  let password: string
  let generated = false
  if (typeof b.password === 'string' && b.password) {
    const problem = passwordProblem(b.password)
    if (problem) return c.json({ error: problem }, 400)
    password = b.password
  } else {
    password = temporaryPassword()
    generated = true
  }

  const user = await createUser({
    username, display_name: displayName, password, role,
    must_change_password: true, created_by: actor.id,
  })
  audit(actor.id, 'user_created', user.id, role)
  // A senha provisória volta uma única vez, para o admin repassar.
  return c.json({ user: adminView(user), temporary_password: generated ? password : null }, 201)
})

app.patch('/users/:id', async (c) => {
  const actor = c.get('user')
  const target = getUser(Number(c.req.param('id')))
  if (!target) return c.json({ error: 'Usuário não encontrado.' }, 404)
  if (!canManage(actor, target)) return c.json({ error: 'Você não pode alterar essa conta.' }, 403)
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>

  if ('display_name' in b) {
    const name = cleanDisplayName(b.display_name)
    if (!name) return c.json({ error: 'O nome precisa ter de 1 a 60 caracteres.' }, 400)
    core("UPDATE users SET display_name = ?, updated_at = datetime('now') WHERE id = ?").run(name, target.id)
  }

  if ('role' in b) {
    if (target.role === 'owner' || (b.role !== 'admin' && b.role !== 'member')) {
      return c.json({ error: 'Papel inválido.' }, 400)
    }
    if (actor.role !== 'owner') return c.json({ error: 'Só o dono muda papéis.' }, 403)
    if (b.role !== target.role) {
      core("UPDATE users SET role = ?, updated_at = datetime('now') WHERE id = ?").run(b.role, target.id)
      audit(actor.id, 'role_changed', target.id, String(b.role))
    }
  }

  if ('status' in b) {
    if (b.status !== 'active' && b.status !== 'disabled') return c.json({ error: 'Status inválido.' }, 400)
    if (target.id === actor.id || target.role === 'owner') return c.json({ error: 'Essa conta não pode ser desativada.' }, 400)
    if (b.status !== target.status) {
      core("UPDATE users SET status = ?, updated_at = datetime('now') WHERE id = ?").run(b.status, target.id)
      // Desativar derruba todas as sessões e para as integrações da pessoa.
      if (b.status === 'disabled') revokeSessions(target.id)
      audit(actor.id, b.status === 'disabled' ? 'user_disabled' : 'user_enabled', target.id)
    }
  }

  return c.json(adminView(getUser(target.id)!))
})

app.post('/users/:id/reset-password', async (c) => {
  const actor = c.get('user')
  const target = getUser(Number(c.req.param('id')))
  if (!target) return c.json({ error: 'Usuário não encontrado.' }, 404)
  if (target.id === actor.id) return c.json({ error: 'Para a sua conta, use "Trocar senha".' }, 400)
  if (!canManage(actor, target)) return c.json({ error: 'Você não pode alterar essa conta.' }, 403)

  const password = temporaryPassword()
  await setPassword(target.id, password, true)
  revokeSessions(target.id)
  audit(actor.id, 'password_reset', target.id)
  return c.json({ user: adminView(getUser(target.id)!), temporary_password: password })
})

app.get('/audit', (c) => {
  const rows = core(`
    SELECT a.id, a.action, a.detail, a.created_at,
           actor.display_name AS actor_name, target.display_name AS target_name
      FROM audit_log a
      LEFT JOIN users actor  ON actor.id = a.actor_user_id
      LEFT JOIN users target ON target.id = a.target_user_id
     ORDER BY a.id DESC LIMIT 100
  `).all()
  return c.json(rows)
})

export default app
