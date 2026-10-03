/**
 * Configuração guiada: abre sozinha só enquanto nada está conectado, cada
 * passo se dá por feito olhando a própria configuração, e pular/deixar para
 * depois é decisão de cada conta.
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-onboarding-'))
process.env.SHELF_SETUP_TOKEN = 'codigo'
process.env.BACKUP_ENABLED = '0'

type App = { request: (path: string, init?: RequestInit) => Response | Promise<Response> }
let app: App
let owner = ''
let member = ''

function cookieFrom(res: Response): string {
  return `shelf_session=${/shelf_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`
}

async function call(path: string, cookie: string, method = 'GET', body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  return { res, status: res.status, json: await res.json() as any }
}

before(async () => {
  app = (await import('./app.js')).createApp({ log: false })
  const setup = await app.request('/api/auth/setup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ setup_code: 'codigo', username: 'dono', password: 'senha-do-dono-1' }),
  })
  owner = cookieFrom(setup)
  const created = await call('/api/admin/users', owner, 'POST', { username: 'ana', password: 'senha-provisoria-1' })
  const login = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'ana', password: 'senha-provisoria-1' }),
  })
  member = cookieFrom(login)
  await app.request('/api/auth/password', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: member },
    body: JSON.stringify({ current_password: 'senha-provisoria-1', new_password: 'senha-da-ana-123' }),
  })
  assert.equal(created.status, 201)
})

test('conta nova sem nada conectado: o roteiro abre sozinho, sem o passo das chaves da instância', async () => {
  const { json } = await call('/api/onboarding', member)
  assert.equal(json.auto_open, true)
  assert.equal(json.steps.some((s: any) => s.id === 'instance'), false)
  assert.equal(json.steps.every((s: any) => s.status === 'pending'), true)

  const admin = await call('/api/onboarding', owner)
  assert.equal(admin.json.steps[1].id, 'instance')
})

test('pular um passo é lembrado, e dá para retomar', async () => {
  let { json } = await call('/api/onboarding', member, 'PATCH', { skip: 'plex' })
  assert.equal(json.steps.find((s: any) => s.id === 'plex').status, 'skipped')
  assert.equal(json.auto_open, true)
  ;({ json } = await call('/api/onboarding', member, 'PATCH', { unskip: 'plex' }))
  assert.equal(json.steps.find((s: any) => s.id === 'plex').status, 'pending')
  assert.equal((await call('/api/onboarding', member, 'PATCH', { skip: 'nao-existe' })).status, 400)
})

test('conectar qualquer integração faz o roteiro parar de abrir sozinho — só para quem conectou', async () => {
  await call('/api/integrations', member, 'PATCH', { playnite_enabled: true })
  const { json } = await call('/api/onboarding', member)
  assert.equal(json.steps.find((s: any) => s.id === 'playnite').status, 'done')
  assert.equal(json.auto_open, false)
  assert.equal(json.done, 1)

  const ownerView = await call('/api/onboarding', owner)
  assert.equal(ownerView.json.auto_open, true)
})

test('"fazer depois" fecha o roteiro automático; recomeçar volta tudo', async () => {
  let { json } = await call('/api/onboarding', owner, 'PATCH', { dismiss: true })
  assert.equal(json.auto_open, false)
  assert.equal(json.dismissed, true)
  ;({ json } = await call('/api/onboarding', owner, 'PATCH', { reset: true }))
  assert.equal(json.auto_open, true)
})

test('foto ou bio completam o passo do perfil', async () => {
  await call('/api/account', member, 'PATCH', { bio: 'Gosto de RPG.' })
  const { json } = await call('/api/onboarding', member)
  assert.equal(json.steps.find((s: any) => s.id === 'profile').status, 'done')
})
