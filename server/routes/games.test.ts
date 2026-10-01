import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-games-'))

let database: Database.Database
let app: { request: (path: string, init?: RequestInit) => Promise<Response> }
const realFetch = globalThis.fetch
let storeCalls = 0
let storeDown = false

const APPDETAILS = {
  1145360: {
    success: true,
    data: {
      name: 'Hades',
      short_description: 'Desafie o deus dos mortos &amp; escape do <b>Submundo</b>.',
      genres: [{ description: 'Ação' }, { description: 'Indie' }],
      developers: ['Supergiant Games'],
      publishers: ['Supergiant Games'],
      release_date: { coming_soon: false, date: '17 set. 2020' },
      header_image: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1145360/header.jpg',
      background_raw: 'https://shared.fastly.steamstatic.com/store_item_assets/steam/apps/1145360/page_bg_raw.jpg',
      screenshots: [{ path_thumbnail: 'https://shared.fastly.steamstatic.com/s1.600x338.jpg', path_full: 'https://shared.fastly.steamstatic.com/s1.1920x1080.jpg' }],
      movies: [
        { name: 'Launch Trailer', thumbnail: 'https://shared.fastly.steamstatic.com/m1.jpg', mp4: { 480: 'https://video.fastly.steamstatic.com/m1_480.mp4', max: 'https://video.fastly.steamstatic.com/m1_max.mp4' } },
        { name: 'Sem miniatura', mp4: { max: 'https://video.fastly.steamstatic.com/m2.mp4' } },
      ],
      metacritic: { score: 93, url: 'https://www.metacritic.com/game/pc/hades' },
    },
  },
}

before(async () => {
  database = (await import('../db.js')).db
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.hostname === 'store.steampowered.com' && url.pathname === '/api/appdetails') {
      storeCalls++
      if (storeDown) return new Response('', { status: 503 })
      return new Response(JSON.stringify({ [url.searchParams.get('appids')!]: (APPDETAILS as any)[url.searchParams.get('appids')!] ?? { success: false } }))
    }
    throw new Error(`fetch inesperado: ${url}`)
  }) as typeof fetch
  app = (await import('./games.js')).default as any

  const add = database.prepare("INSERT INTO media_items (external_id, type, title, status, steam_appid, genre) VALUES (?, 'game', ?, 'in_progress', ?, ?)")
  add.run('steam:1145360', 'Hades', 1145360, 'Roguelike')
  add.run('rawg-1', 'Sem Steam', null, null)
})

after(() => {
  globalThis.fetch = realFetch
  database.close()
})

const idOf = (externalId: string) =>
  (database.prepare('SELECT id FROM media_items WHERE external_id = ?').get(externalId) as { id: number }).id

test('devolve a ficha da loja em texto puro e completa o card sem sobrescrever', async () => {
  const res = await app.request(`/${idOf('steam:1145360')}/steam`)
  const body = await res.json() as any
  assert.equal(body.available, true)
  assert.equal(body.page.short_description, 'Desafie o deus dos mortos & escape do Submundo.')
  assert.deepEqual(body.page.genres, ['Ação', 'Indie'])
  assert.equal(body.page.year, 2020)
  assert.equal(body.page.screenshots.length, 1)
  assert.deepEqual(body.page.movies, [{
    name: 'Launch Trailer', thumbnail: 'https://shared.fastly.steamstatic.com/m1.jpg',
    mp4: 'https://video.fastly.steamstatic.com/m1_max.mp4', webm: null,
  }])
  assert.deepEqual(body.page.metacritic, { score: 93, url: 'https://www.metacritic.com/game/pc/hades' })

  const row = database.prepare("SELECT synopsis, genre, year, creators, publisher FROM media_items WHERE external_id = 'steam:1145360'").get()
  assert.deepEqual(row, {
    synopsis: 'Desafie o deus dos mortos & escape do Submundo.',
    genre: 'Roguelike', // já existia: não é sobrescrito
    year: 2020, creators: 'Supergiant Games', publisher: 'Supergiant Games',
  })
})

test('a segunda visita usa o cache; Steam fora do ar devolve a última cópia', async () => {
  const calls = storeCalls
  await app.request(`/${idOf('steam:1145360')}/steam`)
  assert.equal(storeCalls, calls)

  database.prepare('UPDATE steam_app_cache SET fetched_at = 0').run()
  storeDown = true
  try {
    const body = await (await app.request(`/${idOf('steam:1145360')}/steam`)).json() as any
    assert.equal(body.available, true)
    assert.equal(body.page.name, 'Hades')
  } finally {
    storeDown = false
  }
})

test('jogo sem AppID não consulta a Steam', async () => {
  const calls = storeCalls
  const body = await (await app.request(`/${idOf('rawg-1')}/steam`)).json() as any
  assert.deepEqual(body, { available: false, page: null })
  assert.equal(storeCalls, calls)
})
