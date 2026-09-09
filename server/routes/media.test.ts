/**
 * Listagem de mídia — o filtro `library`.
 *
 * O ponto do teste: o `LIMIT` tem de ser aplicado **depois** de tirar a
 * wishlist. Enquanto o filtro morava no cliente, um backlog grande ocupava a
 * janela inteira e a biblioteca aparecia vazia, com os contadores zerados.
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'shelf-media-'))
process.env.DATA_DIR = dataDir

let app: { request: (path: string) => Promise<Response> }

before(async () => {
  const db = (await import('../db.js')).db
  app = (await import('./media.js')).default as any

  const add = db.prepare(
    "INSERT INTO media_items (external_id, type, title, status, added_at) VALUES (?, 'movie', ?, ?, ?)",
  )
  // Dez itens de backlog, todos mais recentes que a biblioteca — é o que uma
  // watchlist recém-importada faz com a ordenação por `added_at`.
  for (let i = 1; i <= 10; i++) add.run(`bl-${i}`, `Backlog ${i}`, 'wishlist', `2026-02-${String(i).padStart(2, '0')} 00:00:00`)
  for (let i = 1; i <= 3; i++)  add.run(`lib-${i}`, `Visto ${i}`, 'completed', `2025-01-0${i} 00:00:00`)

  // Sete jogos com o MESMO `added_at` — é o que um import inteiro produz, e o
  // caso em que uma ordenação sem desempate embaralha as páginas. Ficam com a
  // data mais antiga de todas para não interferir nos testes de "mais recentes".
  const game = db.prepare(
    "INSERT INTO media_items (external_id, type, title, status, added_at) VALUES (?, 'game', ?, 'wishlist', '2024-01-01 00:00:00')",
  )
  for (let i = 1; i <= 7; i++) game.run(`gm-${i}`, `Jogo ${i}`)
})

const titles = async (qs: string) =>
  ((await (await app.request(`/?${qs}`)).json()) as { title: string }[]).map(i => i.title)

test('sem library, o limite é ocupado pelos itens mais recentes — inclusive backlog', async () => {
  const got = await titles('limit=5')
  assert.equal(got.length, 5)
  assert.equal(got.every(t => t.startsWith('Backlog')), true)
})

test('com library=1, a wishlist sai antes do limite e a biblioteca aparece', async () => {
  const got = await titles('library=1&limit=5')
  assert.deepEqual(got, ['Visto 3', 'Visto 2', 'Visto 1'])
})

test('library=1 combina com o filtro de tipo', async () => {
  assert.equal((await titles('type=movie&library=1&limit=50')).length, 3)
  assert.equal((await titles('type=book&library=1&limit=50')).length, 0)
})

test('sem library=1 nada muda para quem pede a wishlist de propósito', async () => {
  assert.equal((await titles('type=movie&status=wishlist&limit=50')).length, 10)
  assert.equal((await titles('status=wishlist&limit=50')).length, 17)
})

test('offset percorre a coleção inteira sem repetir nem pular', async () => {
  const inteiro = await titles('type=game&limit=100')
  assert.equal(inteiro.length, 7)

  const paginado: string[] = []
  for (let offset = 0; ; offset += 3) {
    const page = await titles(`type=game&limit=3&offset=${offset}`)
    paginado.push(...page)
    if (page.length < 3) break
  }

  // Mesmos itens, mesma ordem: o desempate por id mantém estável a paginação
  // de linhas que compartilham `added_at`.
  assert.deepEqual(paginado, inteiro)
  assert.equal(new Set(paginado).size, 7)
})

test('offset além do fim devolve lista vazia, não erro', async () => {
  assert.deepEqual(await titles('type=game&limit=10&offset=999'), [])
})

test('offset inválido é tratado como zero', async () => {
  assert.deepEqual(await titles('type=game&limit=2&offset=-5'), await titles('type=game&limit=2'))
  assert.deepEqual(await titles('type=game&limit=2&offset=abc'), await titles('type=game&limit=2'))
})
