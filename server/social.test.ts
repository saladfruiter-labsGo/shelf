/**
 * Feed social de ponta a ponta, com duas contas: diário e conquistas chegando
 * sozinhos (e só o que é recente), comentários com resposta, reações,
 * menções, notificações, listas compartilhadas e o que cada um pode apagar.
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-social-'))
process.env.SHELF_SETUP_TOKEN = 'codigo'
process.env.BACKUP_ENABLED = '0'

type App = { request: (path: string, init?: RequestInit) => Response | Promise<Response> }
let app: App
let dono = ''
let ana = ''
let anaId = 0

const cookieFrom = (res: Response) => `shelf_session=${/shelf_session=([^;]+)/.exec(res.headers.get('set-cookie') ?? '')![1]}`

async function call(path: string, cookie: string, method = 'GET', body?: unknown) {
  const res = await app.request(path, {
    method,
    headers: { 'content-type': 'application/json', cookie },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  let json: any = null
  try { json = JSON.parse(text) } catch { /* imagem etc. */ }
  return { status: res.status, json, text, res }
}

const today = () => new Date().toISOString().slice(0, 10)

before(async () => {
  app = (await import('./app.js')).createApp({ log: false })
  const setup = await app.request('/api/auth/setup', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ setup_code: 'codigo', username: 'dono', display_name: 'Dono', password: 'senha-do-dono-1' }),
  })
  dono = cookieFrom(setup)
  const created = await call('/api/admin/users', dono, 'POST', { username: 'ana', display_name: 'Ana', password: 'senha-provisoria-1' })
  anaId = created.json.user.id
  const login = await app.request('/api/auth/login', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ username: 'ana', password: 'senha-provisoria-1' }),
  })
  ana = cookieFrom(login)
  await app.request('/api/auth/password', {
    method: 'POST', headers: { 'content-type': 'application/json', cookie: ana },
    body: JSON.stringify({ current_password: 'senha-provisoria-1', new_password: 'senha-da-ana-123' }),
  })
})

let diaryPostId = 0

test('registro de hoje no diário vira post; histórico antigo não', async () => {
  const movie = await call('/api/media', dono, 'POST', { external_id: '603', type: 'movie', title: 'Matrix', year: 1999, status: 'completed' })
  await call('/api/diary', dono, 'POST', { media_item_id: movie.json.id, watched_at: '2019-05-01', rating: 4 })
  await call('/api/diary', dono, 'POST', { media_item_id: movie.json.id, watched_at: today(), rating: 5, comment: 'Ainda perfeito.' })

  const feed = await call('/api/feed', ana)
  assert.equal(feed.status, 200)
  const diary = feed.json.posts.filter((p: any) => p.kind === 'diary')
  assert.equal(diary.length, 1)
  assert.equal(diary[0].media.title, 'Matrix')
  assert.equal(diary[0].data.rating, 5)
  assert.equal(diary[0].data.comment, 'Ainda perfeito.')
  assert.equal(diary[0].author.username, 'dono')
  // O id local da mídia é do banco do autor: não sai para os outros.
  assert.equal('local_id' in diary[0].media, false)
  assert.equal(diary[0].can_delete, false)
  diaryPostId = diary[0].id

  const own = await call('/api/feed', dono)
  assert.equal(own.json.posts.find((p: any) => p.id === diaryPostId).media.local_id, movie.json.id)
})

test('editar a resenha atualiza o post; apagar o registro tira do feed', async () => {
  const entries = await call('/api/diary', dono)
  const todayEntry = entries.json.find((e: any) => e.comment === 'Ainda perfeito.')
  await call(`/api/diary/${todayEntry.id}`, dono, 'PATCH', { comment: 'Melhor da trilogia.' })
  let post = await call(`/api/feed/posts/${diaryPostId}`, ana)
  assert.equal(post.json.post.data.comment, 'Melhor da trilogia.')

  const extra = await call('/api/diary', dono, 'POST', { media_item_id: todayEntry.media_item_id, watched_at: today(), rating: 3 })
  const before = (await call('/api/feed', ana)).json.posts.length
  await call(`/api/diary/${extra.json.id}`, dono, 'DELETE')
  assert.equal((await call('/api/feed', ana)).json.posts.length, before - 1)
  post = await call(`/api/feed/posts/${diaryPostId}`, ana)
  assert.equal(post.status, 200)
})

test('quem desliga o compartilhamento do diário não gera posts novos', async () => {
  await call('/api/feed/preferences', ana, 'PATCH', { share_diary: false })
  const show = await call('/api/media', ana, 'POST', { external_id: '1399', type: 'movie', title: 'Privado', status: 'completed' })
  await call('/api/diary', ana, 'POST', { media_item_id: show.json.id, watched_at: today(), rating: 2 })
  const feed = await call('/api/feed', dono)
  assert.equal(feed.json.posts.some((p: any) => p.media?.title === 'Privado'), false)
  await call('/api/feed/preferences', ana, 'PATCH', { share_diary: true })
})

test('conquistas do mesmo jogo no mesmo dia viram um post só', async () => {
  const { runAsUser, db } = await import('./db.js')
  const { drainSocialOutbox } = await import('./social/feed-sync.js')
  const now = new Date().toISOString()
  runAsUser(anaId, () => {
    db.prepare("INSERT INTO media_items (external_id, type, title, status, steam_appid, game_status) VALUES ('rawg-1', 'game', 'Hades', 'in_progress', 1145360, 'jogando')").run()
    const add = db.prepare(`
      INSERT INTO steam_achievements (appid, api_name, name, achieved, unlocked_at, global_percent) VALUES (1145360, ?, ?, 1, ?, 12.5)
    `)
    add.run('A1', 'Primeira fuga', now)
    add.run('A2', 'Chthonic', now)
    // Conquista de anos atrás (primeira leitura da biblioteca) não entra.
    add.run('OLD', 'Antiga', '2019-01-01T00:00:00Z')
    drainSocialOutbox()
  })
  const feed = await call('/api/feed', dono)
  const ach = feed.json.posts.filter((p: any) => p.kind === 'achievements')
  assert.equal(ach.length, 1)
  assert.equal(ach[0].media.title, 'Hades')
  assert.deepEqual(ach[0].data.items.map((i: any) => i.name), ['Primeira fuga', 'Chthonic'])
})

test('comentário, resposta, menção e reação geram as notificações certas', async () => {
  const c1 = await call(`/api/feed/posts/${diaryPostId}/comments`, ana, 'POST', { body: 'Concordo! <script>alert(1)</script>' })
  assert.equal(c1.status, 201)
  // Texto puro: o servidor guarda exatamente o que foi digitado; a tela escapa.
  assert.equal(c1.json[0].body, 'Concordo! <script>alert(1)</script>')

  const reply = await call(`/api/feed/posts/${diaryPostId}/comments`, dono, 'POST', { body: 'Valeu, @ana', parent_id: c1.json[0].id })
  assert.equal(reply.json[1].parent_id, c1.json[0].id)

  // Resposta a uma resposta continua no mesmo fio.
  const deep = await call(`/api/feed/posts/${diaryPostId}/comments`, ana, 'POST', { body: 'Nada!', parent_id: reply.json[1].id })
  assert.equal(deep.json[2].parent_id, c1.json[0].id)

  const toDono = await call('/api/notifications', dono)
  assert.deepEqual(toDono.json.items.map((n: any) => n.type).sort(), ['comment', 'reply'])
  const toAna = await call('/api/notifications', ana)
  // A resposta já avisa a Ana; a menção na mesma resposta não duplica.
  assert.deepEqual(toAna.json.items.map((n: any) => n.type), ['reply'])

  const r1 = await call('/api/feed/reactions', ana, 'PUT', { target_type: 'post', target_id: diaryPostId, emoji: '❤️' })
  assert.deepEqual(r1.json.reactions.map((r: any) => [r.emoji, r.count, r.mine]), [['❤️', 1, true]])
  await call('/api/feed/reactions', ana, 'PUT', { target_type: 'post', target_id: diaryPostId, emoji: '❤️' })
  const r3 = await call('/api/feed/reactions', ana, 'PUT', { target_type: 'post', target_id: diaryPostId, emoji: '❤️' })
  assert.equal(r3.json.reactions[0].count, 1)
  const reactions = (await call('/api/notifications', dono)).json.items.filter((n: any) => n.type === 'reaction')
  assert.equal(reactions.length, 1)

  const bad = await call('/api/feed/reactions', ana, 'PUT', { target_type: 'post', target_id: diaryPostId, emoji: '💩' })
  assert.equal(bad.status, 400)

  const read = await call('/api/notifications/read', dono, 'POST', {})
  assert.equal(read.json.unread, 0)
})

test('post com texto, menção, mídia marcada e print', async () => {
  const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#ff0066' } }).png().toBuffer()
  const form = new FormData()
  form.append('body', 'Zerei [[game:3328|The Witcher 3]] hoje, @ana!')
  form.append('refs', JSON.stringify([{ type: 'game', external_id: '3328', cover_url: 'https://media.rawg.io/x.jpg', year: 2015 }]))
  form.append('images', new File([png], 'print.png', { type: 'image/png' }))
  const res = await app.request('/api/feed/posts', { method: 'POST', headers: { cookie: dono }, body: form })
  assert.equal(res.status, 201)
  const post = await res.json() as any
  assert.deepEqual(post.refs, [{ type: 'game', external_id: '3328', title: 'The Witcher 3', cover_url: 'https://media.rawg.io/x.jpg', year: 2015 }])
  assert.deepEqual(post.mentions.map((m: any) => m.username), ['ana'])
  assert.equal(post.images.length, 1)
  assert.equal(post.images[0].width, 40)

  const img = await app.request(post.images[0].url, { headers: { cookie: ana } })
  assert.equal(img.status, 200)
  assert.equal(img.headers.get('content-type'), 'image/webp')
  assert.equal((await app.request(post.images[0].url)).status, 401)

  const toAna = await call('/api/notifications', ana)
  assert.equal(toAna.json.items[0].type, 'mention')
  assert.equal(toAna.json.items[0].post_id, post.id)

  // Ninguém apaga post alheio, exceto um admin.
  assert.equal((await call(`/api/feed/posts/${post.id}`, ana, 'DELETE')).status, 403)
  const mine = await call('/api/feed/posts', ana, 'POST', { body: 'Oi gente' })
  assert.equal((await call(`/api/feed/posts/${mine.json.id}`, dono, 'DELETE')).status, 200)
  assert.equal((await call(`/api/feed/posts/${mine.json.id}`, ana)).status, 404)
})

test('lista compartilhada aparece no feed e abre para os outros — só ela', async () => {
  const list = await call('/api/lists', dono, 'POST', { name: 'Top filmes', mode: 'ranking' })
  const movie = await call('/api/media', dono, 'POST', { external_id: '680', type: 'movie', title: 'Pulp Fiction', status: 'completed', notes: 'nota privada' })
  await call(`/api/lists/${list.json.id}/items`, dono, 'POST', { media_item_id: movie.json.id })
  const hidden = await call('/api/lists', dono, 'POST', { name: 'Secreta' })

  assert.equal((await call(`/api/social/users/dono/lists/${list.json.id}`, ana)).status, 404)
  const shared = await call('/api/feed/share-list', dono, 'POST', { list_id: list.json.id, body: 'Minha lista!' })
  assert.equal(shared.status, 201)
  assert.equal(shared.json.kind, 'list')
  assert.equal(shared.json.data.name, 'Top filmes')
  assert.equal(shared.json.data.items[0].title, 'Pulp Fiction')

  const view = await call(`/api/social/users/dono/lists/${list.json.id}`, ana)
  assert.equal(view.status, 200)
  assert.equal(view.json.items[0].title, 'Pulp Fiction')
  assert.equal(view.text.includes('nota privada'), false)
  assert.equal((await call(`/api/social/users/dono/lists/${hidden.json.id}`, ana)).status, 404)

  const profile = await call('/api/social/users/dono', ana)
  assert.equal(profile.json.is_me, false)
  assert.equal(profile.json.shared_lists[0].name, 'Top filmes')
})

test('conta desativada some do feed; não dá para comentar no post dela', async () => {
  const post = await call('/api/feed/posts', ana, 'POST', { body: 'Vou sumir' })
  await call(`/api/admin/users/${anaId}`, dono, 'PATCH', { status: 'disabled' })
  const feed = await call('/api/feed', dono)
  assert.equal(feed.json.posts.some((p: any) => p.author.username === 'ana'), false)
  assert.equal((await call(`/api/feed/posts/${post.json.id}/comments`, dono, 'POST', { body: 'oi?' })).status, 404)
})
