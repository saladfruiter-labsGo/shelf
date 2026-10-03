/**
 * Multiusuário de ponta a ponta: setup do dono, contas criadas pelo admin,
 * senha provisória, isolamento dos dados pessoais e webhooks por conta.
 *
 * Tudo passa pela aplicação real (`createApp`), com cookies de sessão de
 * verdade — o ponto é provar que nenhuma rota enxerga o banco de outra pessoa.
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-auth-'))
process.env.SHELF_SETUP_TOKEN = 'codigo-de-teste'
process.env.BACKUP_ENABLED = '0'

type App = { request: (path: string, init?: RequestInit) => Response | Promise<Response> }
let app: App

before(async () => {
  app = (await import('./app.js')).createApp({ log: false })
})

function cookieFrom(res: Response): string {
  const raw = res.headers.get('set-cookie') ?? ''
  const match = /shelf_session=([^;]+)/.exec(raw)
  assert.ok(match, `sem cookie de sessão em: ${raw}`)
  return `shelf_session=${match[1]}`
}

async function call(path: string, init: { method?: string; body?: unknown; cookie?: string } = {}) {
  const res = await app.request(path, {
    method: init.method ?? (init.body !== undefined ? 'POST' : 'GET'),
    headers: {
      'content-type': 'application/json',
      ...(init.cookie ? { cookie: init.cookie } : {}),
    },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* não-JSON */ }
  return { res, status: res.status, json, text }
}

let ownerCookie = ''
let memberCookie = ''
let memberId = 0
let memberPassword = ''

test('antes da primeira conta, a API pede setup e o setup exige o código do log', async () => {
  const state = await call('/api/auth/state')
  assert.deepEqual(state.json, { setup_required: true, user: null })

  const blocked = await call('/api/media')
  assert.equal(blocked.status, 401)
  assert.equal(blocked.json.code, 'setup_required')

  const wrong = await call('/api/auth/setup', {
    body: { setup_code: 'chute', username: 'dono', password: 'senha-muito-boa-1' },
  })
  assert.equal(wrong.status, 403)

  const ok = await call('/api/auth/setup', {
    body: { setup_code: 'codigo-de-teste', username: 'Dono', display_name: 'Dona da Casa', password: 'senha-muito-boa-1' },
  })
  assert.equal(ok.status, 201)
  assert.equal(ok.json.user.username, 'dono')
  assert.equal(ok.json.user.role, 'owner')
  ownerCookie = cookieFrom(ok.res)
  assert.match(ok.res.headers.get('set-cookie') ?? '', /HttpOnly/i)
  assert.match(ok.res.headers.get('set-cookie') ?? '', /SameSite=Lax/i)

  const again = await call('/api/auth/setup', {
    body: { setup_code: 'codigo-de-teste', username: 'outro', password: 'senha-muito-boa-2' },
  })
  assert.equal(again.status, 409)
})

test('sem sessão nada passa; o webhook sem segredo válido também não', async () => {
  assert.equal((await call('/api/media')).status, 401)
  assert.equal((await call('/api/integrations')).status, 401)
  assert.equal((await call('/api/integrations/playnite/webhook?token=', { body: {} })).status, 401)
  assert.equal((await call('/api/health')).status, 200)
})

test('só o admin cria contas, e a senha provisória volta uma vez', async () => {
  const created = await call('/api/admin/users', {
    cookie: ownerCookie,
    body: { username: 'amiga', display_name: 'Amiga' },
  })
  assert.equal(created.status, 201)
  assert.equal(created.json.user.must_change_password, true)
  assert.match(created.json.temporary_password, /^[\w]{4}-[\w]{4}-[\w]{4}$/)
  memberId = created.json.user.id
  memberPassword = created.json.temporary_password

  const list = await call('/api/admin/users', { cookie: ownerCookie })
  assert.equal(list.text.includes('password_hash'), false)
  assert.equal(list.text.includes('scrypt$'), false)
  assert.deepEqual(list.json.map((u: any) => u.username), ['dono', 'amiga'])
})

test('senha provisória: login funciona, mas só libera a troca de senha', async () => {
  const badLogin = await call('/api/auth/login', { body: { username: 'amiga', password: 'errada-errada' } })
  assert.equal(badLogin.status, 401)

  const login = await call('/api/auth/login', { body: { username: 'AMIGA', password: memberPassword } })
  assert.equal(login.status, 200)
  memberCookie = cookieFrom(login.res)

  const blocked = await call('/api/media', { cookie: memberCookie })
  assert.equal(blocked.status, 403)
  assert.equal(blocked.json.code, 'password_change_required')

  const weak = await call('/api/auth/password', {
    cookie: memberCookie, body: { current_password: memberPassword, new_password: 'curta' },
  })
  assert.equal(weak.status, 400)

  const changed = await call('/api/auth/password', {
    cookie: memberCookie, body: { current_password: memberPassword, new_password: 'a-senha-da-amiga-1' },
  })
  assert.equal(changed.status, 200)
  assert.equal(changed.json.user.must_change_password, false)
  assert.equal((await call('/api/media', { cookie: memberCookie })).status, 200)
})

test('membro não acessa administração nem altera as chaves da instância', async () => {
  assert.equal((await call('/api/admin/users', { cookie: memberCookie })).status, 403)
  const patch = await call('/api/settings', { method: 'PATCH', cookie: memberCookie, body: { TMDB_API_KEY: 'invasora' } })
  assert.equal(patch.status, 403)
  const settings = await call('/api/settings', { cookie: memberCookie })
  assert.equal(settings.json.can_edit, false)
})

test('cada conta só enxerga a própria biblioteca', async () => {
  const mine = await call('/api/media', {
    cookie: ownerCookie,
    body: { external_id: 'tmdb-1', type: 'movie', title: 'Filme da Dona', status: 'completed', rating: 5 },
  })
  assert.equal(mine.status, 201)

  const theirs = await call('/api/media', {
    cookie: memberCookie,
    body: { external_id: 'tmdb-2', type: 'movie', title: 'Filme da Amiga', status: 'completed', rating: 3 },
  })
  assert.equal(theirs.status, 201)

  // O mesmo filme pode estar nas duas bibliotecas, com notas diferentes.
  const same = await call('/api/media', {
    cookie: memberCookie,
    body: { external_id: 'tmdb-1', type: 'movie', title: 'Filme da Dona', status: 'completed', rating: 1 },
  })
  assert.equal(same.status, 201)

  const ownerList = await call('/api/media', { cookie: ownerCookie })
  assert.deepEqual(ownerList.json.map((m: any) => m.title), ['Filme da Dona'])
  assert.equal(ownerList.json[0].rating, 5)

  const memberList = await call('/api/media', { cookie: memberCookie })
  assert.deepEqual(memberList.json.map((m: any) => m.title).sort(), ['Filme da Amiga', 'Filme da Dona'])
  assert.equal(memberList.json.find((m: any) => m.external_id === 'tmdb-1').rating, 1)

  // Ids são do banco de cada um: apagar "o id 1" da amiga nunca toca na dona.
  const removed = await call(`/api/media/${mine.json.id}`, { method: 'DELETE', cookie: memberCookie })
  assert.equal(removed.status, 200)
  const ownerAfter = await call('/api/media', { cookie: ownerCookie })
  assert.deepEqual(ownerAfter.json.map((m: any) => m.title), ['Filme da Dona'])
})

test('integrações são pessoais: segredos não vazam e o webhook cai na conta certa', async () => {
  const ownerCfg = await call('/api/integrations', { cookie: ownerCookie })
  const memberCfg = await call('/api/integrations', { cookie: memberCookie })
  const ownerSecret = ownerCfg.json.playnite.webhook_secret
  const memberSecret = memberCfg.json.playnite.webhook_secret
  assert.ok(ownerSecret && memberSecret)
  assert.notEqual(ownerSecret, memberSecret)

  await call('/api/integrations', { method: 'PATCH', cookie: memberCookie, body: { playnite_enabled: true, lastfm_api_key: 'chave-lastfm-da-amiga' } })
  const masked = await call('/api/integrations', { cookie: memberCookie })
  assert.equal(masked.text.includes('chave-lastfm-da-amiga'), false)
  const ownerView = await call('/api/integrations', { cookie: ownerCookie })
  assert.equal(ownerView.json.lastfm.api_key_set, false)

  const hook = await call(`/api/integrations/playnite/webhook?token=${memberSecret}`, {
    body: { gameId: 'g-1', name: 'Jogo da Amiga', playtimeSeconds: 3600, completionStatus: 'Playing' },
  })
  assert.equal(hook.status, 200)

  const memberGames = await call('/api/media?type=game', { cookie: memberCookie })
  assert.deepEqual(memberGames.json.map((m: any) => m.title), ['Jogo da Amiga'])
  const ownerGames = await call('/api/media?type=game', { cookie: ownerCookie })
  assert.deepEqual(ownerGames.json, [])
})

test('conta desativada perde a sessão na hora e não loga mais', async () => {
  const disabled = await call(`/api/admin/users/${memberId}`, { method: 'PATCH', cookie: ownerCookie, body: { status: 'disabled' } })
  assert.equal(disabled.status, 200)
  assert.equal((await call('/api/media', { cookie: memberCookie })).status, 401)
  const login = await call('/api/auth/login', { body: { username: 'amiga', password: 'a-senha-da-amiga-1' } })
  assert.equal(login.status, 401)

  // O dono não pode ser desativado, nem por ele mesmo.
  const self = await call('/api/admin/users/1', { method: 'PATCH', cookie: ownerCookie, body: { status: 'disabled' } })
  assert.equal(self.status, 400)
})

test('reset de senha gera nova provisória e encerra as sessões', async () => {
  await call(`/api/admin/users/${memberId}`, { method: 'PATCH', cookie: ownerCookie, body: { status: 'active' } })
  const reset = await call(`/api/admin/users/${memberId}/reset-password`, { method: 'POST', cookie: ownerCookie })
  assert.equal(reset.status, 200)
  const login = await call('/api/auth/login', { body: { username: 'amiga', password: reset.json.temporary_password } })
  assert.equal(login.status, 200)
  const me = await call('/api/auth/state', { cookie: cookieFrom(login.res) })
  assert.equal(me.json.user.must_change_password, true)
})

test('logout derruba a sessão', async () => {
  const out = await call('/api/auth/logout', { method: 'POST', cookie: ownerCookie })
  assert.equal(out.status, 200)
  assert.equal((await call('/api/media', { cookie: ownerCookie })).status, 401)
})
