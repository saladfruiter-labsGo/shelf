/**
 * Arte de capa personalizada.
 *
 * A arte escolhida vira o `cover_url` da mídia — o diário e a biblioteca leem
 * dali —, e a capa do provedor fica guardada para o Story e para restaurar.
 */
import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import type Database from 'better-sqlite3'

const dataDir = mkdtempSync(join(tmpdir(), 'shelf-covers-'))
process.env.DATA_DIR = dataDir
delete process.env.TMDB_API_KEY

const ORIGINAL = 'https://image.tmdb.org/t/p/w500/original.jpg'
const ALTERNATIVE = 'https://image.tmdb.org/t/p/w500/alternativa.jpg'

let media: typeof import('./media.js').default
let diary: typeof import('./diary.js').default
let covers: typeof import('./covers.js').default
let db: Database.Database
let movieId: number

before(async () => {
  db = (await import('../db.js')).db
  media = (await import('./media.js')).default
  diary = (await import('./diary.js')).default
  covers = (await import('./covers.js')).default
  movieId = Number(db.prepare(`
    INSERT INTO media_items (external_id, type, title, cover_url, status)
    VALUES ('603', 'movie', 'Matrix', ?, 'completed')
  `).run(ORIGINAL).lastInsertRowid)
  db.prepare(`
    INSERT INTO diary_entries (media_item_id, watched_at, source) VALUES (?, '2026-09-01', 'manual')
  `).run(movieId)
})

after(() => db.close())

const row = () => db.prepare(
  'SELECT cover_url, default_cover_url, cover_custom FROM media_items WHERE id = ?',
).get(movieId) as { cover_url: string | null; default_cover_url: string | null; cover_custom: number }

const put = (url: string) => media.request(`/${movieId}/cover`, {
  method: 'PUT',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify({ url }),
})

test('a galeria traz a capa padrão e explica por que não há alternativas', async () => {
  const res = await media.request(`/${movieId}/covers`)
  assert.equal(res.status, 200)
  const body = await res.json() as { default: string; custom: boolean; options: { url: string; source: string }[]; notice?: string }
  assert.equal(body.default, ORIGINAL)
  assert.equal(body.custom, false)
  assert.deepEqual(body.options, [{ url: ORIGINAL, source: 'default' }])
  assert.match(body.notice ?? '', /TMDB/)
})

test('escolher outra arte troca a capa da mídia e do diário, guardando a padrão', async () => {
  assert.equal((await put(ALTERNATIVE)).status, 200)
  assert.deepEqual(row(), { cover_url: ALTERNATIVE, default_cover_url: ORIGINAL, cover_custom: 1 })

  const entries = await (await diary.request(`/?media_item_id=${movieId}`)).json() as { cover_url: string; default_cover_url: string; cover_custom: number }[]
  assert.equal(entries[0].cover_url, ALTERNATIVE)
  assert.equal(entries[0].default_cover_url, ORIGINAL)
  assert.equal(entries[0].cover_custom, 1)
})

test('trocar de novo não perde a capa padrão original', async () => {
  const again = 'https://image.tmdb.org/t/p/w500/terceira.jpg'
  assert.equal((await put(again)).status, 200)
  assert.deepEqual(row(), { cover_url: again, default_cover_url: ORIGINAL, cover_custom: 1 })
})

test('recusa imagem de host fora da allowlist', async () => {
  const res = await put('https://evil.example/capa.jpg')
  assert.equal(res.status, 400)
  assert.equal(row().cover_url, 'https://image.tmdb.org/t/p/w500/terceira.jpg')
})

test('escolher a capa padrão equivale a restaurá-la', async () => {
  assert.equal((await put(ORIGINAL)).status, 200)
  assert.deepEqual(row(), { cover_url: ORIGINAL, default_cover_url: null, cover_custom: 0 })
})

test('um sync de integração não sobrescreve a arte escolhida', async () => {
  await put(ALTERNATIVE)
  db.prepare(`
    INSERT INTO media_items (external_id, type, title, cover_url, status)
    VALUES ('603', 'movie', 'Matrix', 'https://image.tmdb.org/t/p/w500/do-plex.jpg', 'completed')
    ON CONFLICT(external_id, type) DO UPDATE SET cover_url = COALESCE(media_items.cover_url, excluded.cover_url)
  `).run()
  assert.equal(row().cover_url, ALTERNATIVE)
})

test('envio de imagem grava WebP local, serve e some ao restaurar a padrão', async () => {
  const png = await sharp({ create: { width: 400, height: 600, channels: 3, background: '#335577' } }).png().toBuffer()
  const form = new FormData()
  form.append('file', new File([new Uint8Array(png)], 'capa.png', { type: 'image/png' }))
  const res = await media.request(`/${movieId}/cover/upload`, { method: 'POST', body: form })
  assert.equal(res.status, 200)

  const { cover_url, default_cover_url, cover_custom } = row()
  const match = /^\/api\/covers\/([a-f0-9]{64}\.webp)$/.exec(cover_url ?? '')
  assert.ok(match, `capa enviada deveria ser local: ${cover_url}`)
  assert.equal(default_cover_url, ORIGINAL)
  assert.equal(cover_custom, 1)

  const file = join(dataDir, 'covers', match[1])
  assert.equal(existsSync(file), true)
  const served = await covers.request(`/${match[1]}`)
  assert.equal(served.status, 200)
  assert.equal(served.headers.get('content-type'), 'image/webp')

  const reset = await media.request(`/${movieId}/cover`, { method: 'DELETE' })
  assert.equal(reset.status, 200)
  assert.deepEqual(row(), { cover_url: ORIGINAL, default_cover_url: null, cover_custom: 0 })
  assert.equal(existsSync(file), false)
})

test('recusa envio que não é imagem', async () => {
  const form = new FormData()
  form.append('file', new File(['oi'], 'nota.txt', { type: 'text/plain' }))
  const res = await media.request(`/${movieId}/cover/upload`, { method: 'POST', body: form })
  assert.equal(res.status, 400)
})

test('não serve arquivo fora do padrão de nome', async () => {
  assert.equal((await covers.request('/..%2Fshelf.db')).status, 404)
  assert.equal((await covers.request('/abc.webp')).status, 404)
})
