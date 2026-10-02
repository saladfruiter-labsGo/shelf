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

test('jogo novo da Steam: usa os endereços com hash da API da loja (o antigo dá 404)', async () => {
  const add = database.prepare(`
    INSERT INTO media_items (external_id, type, title, status, steam_appid, cover_url, cover_custom)
    VALUES (?, 'game', ?, 'in_progress', ?, ?, 0)
  `)
  add.run('rawg-control', 'CONTROL Resonant', 3669870, 'https://media.rawg.io/media/games/control-screenshot.jpg')
  add.run('steam:4000000', 'Sem vertical', 4000000, 'https://cdn.cloudflare.steamstatic.com/steam/apps/4000000/header.jpg')

  heads = []
  const storeApi = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (init?.method === 'HEAD') { heads.push(String(input)); return new Response(null, { status: 404 }) }
    assert.match(url.pathname, /IStoreBrowseService\/GetItems/)
    const ids = JSON.parse(url.searchParams.get('input_json')!).ids.map((i: { appid: number }) => i.appid)
    return new Response(JSON.stringify({ response: { store_items: ids.map((appid: number) => ({
      appid, success: 1,
      assets: {
        asset_url_format: `steam/apps/${appid}/\${FILENAME}?t=1790673363`,
        header: 'h4sh/header.jpg',
        ...(appid === 3669870 ? { library_capsule_2x: '7d4b/library_capsule_2x.jpg' } : {}),
      },
    })) } }), { headers: { 'content-type': 'application/json' } })
  }) as typeof fetch

  const changed = await covers.refreshSteamCovers(150, storeApi)
  assert.equal(changed, 2)
  assert.equal(cover('CONTROL Resonant'),
    'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/3669870/7d4b/library_capsule_2x.jpg?t=1790673363')
  assert.ok(covers.isSteamVerticalCover(cover('CONTROL Resonant')))
  // Sem arte vertical: o header antigo (quebrado) vira o header oficial com hash.
  assert.equal(cover('Sem vertical'),
    'https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/4000000/h4sh/header.jpg?t=1790673363')
  assert.deepEqual(heads, [])
})
