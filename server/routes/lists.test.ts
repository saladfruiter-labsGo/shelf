import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

const dataDir = mkdtempSync(join(tmpdir(), 'shelf-lists-'))
process.env.DATA_DIR = dataDir

let app: { request: (path: string, init?: RequestInit) => Promise<Response> }
let database: Database.Database
let listId: number
let tierId: number

before(async () => {
  database = (await import('../db.js')).db
  app = (await import('./lists.js')).default as any
  const list = database.prepare("INSERT INTO lists (name, mode) VALUES ('Lista isolada', 'tier')").run()
  listId = Number(list.lastInsertRowid)
  const tier = database.prepare("INSERT INTO list_tiers (list_id, name, color, position) VALUES (?, 'S', 'gold', 0)").run(listId)
  tierId = Number(tier.lastInsertRowid)
})

after(() => database.close())

const json = (value: unknown) => ({
  method: 'POST',
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(value),
})

test('resultado pesquisado fica somente na lista, sem criar mídia no acervo', async () => {
  const response = await app.request(`/${listId}/items/search`, json({
    external_id: 'tmdb:123',
    type: 'movie',
    title: 'Filme isolado',
    cover_url: 'https://image.tmdb.org/t/p/w300/poster.jpg',
    year: 2026,
    genre: 'Drama',
    release_date: '2026-05-01',
    tier_id: tierId,
  }))

  assert.equal(response.status, 201)
  assert.deepEqual(await response.json(), {
    ok: true,
    list_item_id: 1,
    created: true,
    already_in_list: false,
  })
  assert.equal((database.prepare("SELECT COUNT(*) AS n FROM media_items WHERE external_id = 'tmdb:123'").get() as { n: number }).n, 0)
  assert.deepEqual(database.prepare('SELECT list_id, external_id, type, title, tier_id FROM list_only_items').all(), [{
    list_id: listId,
    external_id: 'tmdb:123',
    type: 'movie',
    title: 'Filme isolado',
    tier_id: tierId,
  }])

  const detail = await (await app.request(`/${listId}`)).json() as { items: { id: number; title: string; list_only: number; tier_id: number }[] }
  assert.deepEqual(detail.items.map(item => ({ id: item.id, title: item.title, list_only: item.list_only, tier_id: item.tier_id })), [{
    id: -1,
    title: 'Filme isolado',
    list_only: 1,
    tier_id: tierId,
  }])
})

test('a mesma busca é idempotente dentro da lista e independente do acervo', async () => {
  database.prepare("INSERT INTO media_items (external_id, type, title, status) VALUES ('tmdb:456', 'movie', 'Filme do acervo', 'completed')").run()

  const payload = {
    external_id: 'tmdb:456',
    type: 'movie',
    title: 'Filme do acervo',
    year: 2025,
  }
  const first = await app.request(`/${listId}/items/search`, json(payload))
  assert.equal(first.status, 201)
  const second = await app.request(`/${listId}/items/search`, json(payload))
  assert.equal(second.status, 200)
  assert.deepEqual(await second.json(), {
    ok: true,
    list_item_id: 2,
    created: false,
    already_in_list: true,
  })
  assert.equal((database.prepare("SELECT COUNT(*) AS n FROM media_items WHERE external_id = 'tmdb:456'").get() as { n: number }).n, 1)
  assert.equal((database.prepare("SELECT COUNT(*) AS n FROM list_only_items WHERE external_id = 'tmdb:456'").get() as { n: number }).n, 1)
})

test('remover e reordenar uma mídia isolada não tocam media_items', async () => {
  const before = database.prepare("SELECT COUNT(*) AS n FROM media_items WHERE type = 'movie'").get() as { n: number }
  const reorder = await app.request(`/${listId}/order`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ media_item_id: -2, tier_id: null }, { media_item_id: -1, tier_id: tierId }] }),
  })
  assert.equal(reorder.status, 200)

  const remove = await app.request(`/${listId}/items/-2`, { method: 'DELETE' })
  assert.equal(remove.status, 200)
  assert.equal((database.prepare("SELECT COUNT(*) AS n FROM media_items WHERE type = 'movie'").get() as { n: number }).n, before.n)
  assert.equal((database.prepare('SELECT COUNT(*) AS n FROM list_only_items WHERE list_id = ?').get(listId) as { n: number }).n, 1)
  assert.equal((database.prepare('SELECT position, tier_id FROM list_only_items WHERE id = 1').get() as { position: number; tier_id: number | null }).position, 1)
})

test('valida o tipo e o tier antes de criar o snapshot isolado', async () => {
  const invalidType = await app.request(`/${listId}/items/search`, json({
    external_id: 'bad', type: 'podcast', title: 'Não suportado', tier_id: tierId,
  }))
  assert.equal(invalidType.status, 400)

  const invalidTier = await app.request(`/${listId}/items/search`, json({
    external_id: 'bad-tier', type: 'book', title: 'Livro', tier_id: 99999,
  }))
  assert.equal(invalidTier.status, 400)
})

test('excluir a lista remove somente os itens pertencentes a ela', async () => {
  const mediaBefore = (database.prepare('SELECT COUNT(*) AS n FROM media_items').get() as { n: number }).n

  const response = await app.request(`/${listId}`, { method: 'DELETE' })

  assert.equal(response.status, 200)
  assert.equal((database.prepare('SELECT COUNT(*) AS n FROM list_only_items WHERE list_id = ?').get(listId) as { n: number }).n, 0)
  assert.equal((database.prepare('SELECT COUNT(*) AS n FROM media_items').get() as { n: number }).n, mediaBefore)
})
