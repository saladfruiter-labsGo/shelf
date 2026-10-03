/**
 * Mensagens diretas: item da biblioteca compartilhado com comentário, lido
 * no banco de quem manda; só os dois participantes leem a conversa; não
 * lidas; apagar a própria mensagem.
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-dm-'))
process.env.SHELF_SETUP_TOKEN = 'codigo'
process.env.BACKUP_ENABLED = '0'

type App = { request: (path: string, init?: RequestInit) => Response | Promise<Response> }
let app: App
const cookies: Record<string, string> = {}

const cookieFrom = (res: Response) => `shelf_session=${/shelf_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`

async function call(path: string, who: string, method = 'GET', body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', cookie: cookies[who] ?? '' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* vazio */ }
  return { status: res.status, json, text }
}

async function member(username: string) {
  await call('/api/admin/users', 'dono', 'POST', { username, password: 'senha-provisoria-1' })
  const login = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username, password: 'senha-provisoria-1' }),
  })
  cookies[username] = cookieFrom(login)
  await call('/api/auth/password', username, 'POST', { current_password: 'senha-provisoria-1', new_password: `senha-de-${username}-123` })
}

before(async () => {
  app = (await import('./app.js')).createApp({ log: false })
  const setup = await app.request('/api/auth/setup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ setup_code: 'codigo', username: 'dono', password: 'senha-do-dono-1' }),
  })
  cookies.dono = cookieFrom(setup)
  await member('ana')
  await member('bia')
})

let messageId = 0

test('compartilhar um item da biblioteca com comentário', async () => {
  const movie = await call('/api/media', 'dono', 'POST', {
    external_id: '27205', type: 'movie', title: 'A Origem', year: 2010, status: 'completed', rating: 4.5, notes: 'anotação privada',
  })
  await call('/api/diary', 'dono', 'POST', { media_item_id: movie.json.id, watched_at: '2024-01-01', rating: 4.5, comment: 'O pião cai?' })

  const sent = await call('/api/messages/with/ana', 'dono', 'POST', { body: 'Você PRECISA ver esse', media_item_id: movie.json.id })
  assert.equal(sent.status, 201)
  assert.equal(sent.json.mine, true)
  assert.equal(sent.json.media.title, 'A Origem')
  assert.equal(sent.json.media.rating, 4.5)
  assert.equal(sent.json.media.review.comment, 'O pião cai?')
  messageId = sent.json.id

  const thread = await call('/api/messages/with/dono', 'ana')
  assert.equal(thread.json.messages.length, 1)
  const msg = thread.json.messages[0]
  assert.equal(msg.mine, false)
  assert.equal(msg.body, 'Você PRECISA ver esse')
  assert.equal(msg.media.title, 'A Origem')
  // Nada do banco pessoal além do retrato: nem id local nem anotações.
  assert.equal('local_id' in msg.media, false)
  assert.equal(thread.text.includes('anotação privada'), false)
})

test('só dá para compartilhar o que é seu', async () => {
  // O id 1 no banco da Ana não existe: o item é procurado no banco de quem manda.
  const res = await call('/api/messages/with/dono', 'ana', 'POST', { body: 'olha', media_item_id: 1 })
  assert.equal(res.status, 404)
})

test('não lidas, lista de conversas e leitura', async () => {
  await call('/api/messages/with/ana', 'dono', 'POST', { body: 'E aí?' })
  const unread = await call('/api/messages/unread', 'bia')
  assert.equal(unread.json.unread, 0)

  const before = await call('/api/messages', 'ana')
  assert.equal(before.json.length, 1)
  assert.equal(before.json[0].other.username, 'dono')
  assert.equal(before.json[0].last.text, 'E aí?')

  await call('/api/messages/with/dono', 'ana')
  assert.equal((await call('/api/messages/unread', 'ana')).json.unread, 0)

  await call('/api/messages/with/dono', 'ana', 'POST', { body: 'Vou ver hoje!' })
  assert.equal((await call('/api/messages/unread', 'dono')).json.unread, 1)
  assert.equal((await call('/api/messages/unread', 'ana')).json.unread, 0)
})

test('terceiros não leem a conversa, nem as capas dela', async () => {
  const bia = await call('/api/messages', 'bia')
  assert.deepEqual(bia.json, [])
  const proxied = await call(`/api/messages/items/${messageId}/cover?src=${encodeURIComponent('/api/integrations/plex/image?path=/x')}`, 'bia')
  assert.equal(proxied.status, 404)
  assert.equal((await call('/api/messages/with/dono', 'dono')).status, 400)
})

test('apagar a própria mensagem; a alheia não', async () => {
  assert.equal((await call(`/api/messages/items/${messageId}`, 'ana', 'DELETE')).status, 403)
  const res = await call(`/api/messages/items/${messageId}`, 'dono', 'DELETE')
  assert.equal(res.json.deleted, true)
  const thread = await call('/api/messages/with/dono', 'ana')
  const first = thread.json.messages[0]
  assert.equal(first.deleted, true)
  assert.equal(first.media, null)
})
