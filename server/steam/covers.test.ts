import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-steam-covers-'))

let database: Database.Database
let covers: typeof import('./covers.js')
let heads: string[] = []

// 292030 tem arte vertical na Steam; 999 não tem.
const fakeCdn = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = String(input)
  if (init?.method === 'HEAD') {
    heads.push(url)
    return new Response(null, { status: url.includes('/292030/') || url.includes('/1145360/') ? 200 : 404 })
  }
  throw new Error(`fetch inesperado: ${url}`)
}) as typeof fetch

before(async () => {
  database = (await import('../db.js')).db
  covers = await import('./covers.js')
  const add = database.prepare(`
    INSERT INTO media_items (external_id, type, title, status, steam_appid, cover_url, cover_custom)
    VALUES (?, 'game', ?, 'in_progress', ?, ?, ?)
  `)
  add.run('3328', 'The Witcher 3', 292030, 'https://media.rawg.io/media/games/618/screenshot.jpg', 0)
  add.run('999', 'Sem arte vertical', 999, 'https://media.rawg.io/media/games/x.jpg', 0)
  add.run('1145360', 'Hades', 1145360, 'https://minha.arte/hades.webp', 1)
  add.run('rawg-1', 'Sem Steam', null, 'https://media.rawg.io/media/games/y.jpg', 0)
})

after(() => database.close())

const cover = (title: string) => (database.prepare('SELECT cover_url FROM media_items WHERE title = ?').get(title) as { cover_url: string }).cover_url

test('troca pela arte vertical da Steam, mantém capa escolhida à mão e jogo sem arte vertical', async () => {
  const changed = await covers.refreshSteamCovers(150, fakeCdn)
  assert.equal(changed, 1)
  assert.equal(cover('The Witcher 3'), 'https://cdn.cloudflare.steamstatic.com/steam/apps/292030/library_600x900_2x.jpg')
  assert.equal(cover('Sem arte vertical'), 'https://media.rawg.io/media/games/x.jpg')
  assert.equal(cover('Hades'), 'https://minha.arte/hades.webp') // cover_custom: nunca mexe
  assert.equal(cover('Sem Steam'), 'https://media.rawg.io/media/games/y.jpg')
  assert.equal(heads.some(h => h.includes('/1145360/')), false)
})

test('segunda passada não consulta de novo nem o que já trocou nem o que não tinha arte', async () => {
  heads = []
  const changed = await covers.refreshSteamCovers(150, fakeCdn)
  assert.equal(changed, 0)
  assert.deepEqual(heads, [])
})
