import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-steam-legacy-'))

let database: Database.Database
let library: typeof import('./library.js')
let legacy: typeof import('./legacy.js')
let hidden: typeof import('./hidden.js')
let OWNED: any[] = []
const OLD = Math.floor(Date.parse('2024-05-01T20:00:00.000Z') / 1000)
const NEWER = Math.floor(Date.parse('2026-09-20T20:00:00.000Z') / 1000)

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json' } })

before(async () => {
  database = (await import('../db.js')).db
  library = await import('./library.js')
  legacy = await import('./legacy.js')
  hidden = await import('./hidden.js')
  const { setCfg } = await import('../integrations/config.js')
  setCfg('STEAM_ID', '76561198000000001')
  setCfg('STEAM_API_KEY', 'test-key')

  const add = database.prepare(`
    INSERT INTO media_items (external_id, type, title, cover_url, status, game_status, game_status_source,
                             playtime_seconds, playtime_source, rating, steam_appid)
    VALUES (?, 'game', ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  // O estado que o usuário viu: o card do Playnite (com capa e nota) ficou com o
  // AppID antigo, e a leitura da Steam criou outro, sem capa, para o relançamento.
  const playnite = add.run('58175', 'Yakuza Kiwami', 'https://media.rawg.io/media/games/yakuza.jpg', 'completed', 'zerado', 'playnite',
    36_000, 'playnite', 4.5, 834530).lastInsertRowid
  const steamCard = add.run('steam:3717330', 'Yakuza Kiwami', null, 'in_progress', 'jogando', 'steam',
    7_200, 'steam', 0, 3717330).lastInsertRowid
  add.run('steam:431960', 'Wallpaper Engine', null, 'in_progress', 'jogando', 'steam', 900_000, 'steam', 0, 431960)

  database.prepare("INSERT INTO lists (name) VALUES ('Favoritos da SEGA')").run()
  database.prepare('INSERT INTO list_items (list_id, media_item_id) VALUES (1, ?)').run(playnite)
  database.prepare("INSERT INTO diary_entries (media_item_id, watched_at, source) VALUES (?, '2026-09-20', 'steam')").run(steamCard)
  database.prepare(`
    INSERT INTO activity_events (source, event_type, media_type, external_ref, title, occurred_at)
    VALUES ('steam', 'playing', 'game', 'steam:431960', 'Wallpaper Engine', '2026-09-30T10:00:00Z'),
           ('steam', 'playing', 'game', 'steam:3717330', 'Yakuza Kiwami', '2026-09-20T20:00:00Z')
  `).run()
  setCfg('PLAYNITE_STATE', JSON.stringify({ 'pn-yakuza': { externalId: 'steam:3717330', gameStatus: 'jogando', rating: 0, playtime: 0 } }))
  setCfg('STEAM_LIBRARY_STATE', JSON.stringify({ 834530: 36_000, 3717330: 7_200, 431960: 900_000 }))

  OWNED = [
    { appid: 834530, name: 'Yakuza Kiwami (Legacy)', playtime_forever: 600, rtime_last_played: OLD },
    { appid: 3717330, name: 'Yakuza Kiwami', playtime_forever: 120, rtime_last_played: NEWER },
    { appid: 431960, name: 'Wallpaper Engine', playtime_forever: 15_000, rtime_last_played: NEWER },
  ]
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname.includes('GetOwnedGames')) return json({ response: { games: OWNED } })
    if (url.pathname.includes('IStoreBrowseService/GetItems')) return json({ response: { store_items: [] } })
    throw new Error(`fetch inesperado: ${url}`)
  }) as typeof fetch
})

after(() => database.close())

const row = (sql: string, ...args: unknown[]) => database.prepare(sql).get(...args) as Record<string, any>
const count = (sql: string) => (database.prepare(sql).get() as { n: number }).n

test('agrupa "X (Legacy)" com "X": AppID de mais tempo jogado, tempo somado, nome atual', () => {
  const groups = legacy.groupLegacyRelistings([
    { appid: 834530, name: 'Yakuza Kiwami (Legacy)', playtime_minutes: 600, last_played_at: '2024-05-01T20:00:00.000Z' },
    { appid: 3717330, name: 'Yakuza Kiwami', playtime_minutes: 120, last_played_at: '2026-09-20T20:00:00.000Z' },
    { appid: 1, name: 'Dead Space', playtime_minutes: 10, last_played_at: null },
    { appid: 2, name: 'Dead Space™', playtime_minutes: 20, last_played_at: null },
    { appid: 3, name: 'Hogwarts Legacy', playtime_minutes: 0, last_played_at: null },
  ])
  assert.equal(groups.length, 4) // só os Yakuza viram um; os dois Dead Space e Hogwarts Legacy ficam separados
  const yakuza = groups.find(g => g.appids.includes(834530))!
  assert.deepEqual(yakuza.appids, [834530, 3717330])
  assert.equal(yakuza.game.appid, 834530)
  assert.equal(yakuza.game.name, 'Yakuza Kiwami')
  assert.equal(yakuza.game.playtime_minutes, 720)
  assert.equal(yakuza.game.last_played_at, '2026-09-20T20:00:00.000Z')
  assert.deepEqual(yakuza.seconds, { 834530: 36_000, 3717330: 7_200 })
})

test('Legacy sem par na conta continua um jogo só, com o próprio nome', () => {
  const groups = legacy.groupLegacyRelistings([
    { appid: 834530, name: 'Yakuza Kiwami (Legacy)', playtime_minutes: 600, last_played_at: null },
  ])
  assert.deepEqual(groups.map(g => [g.game.name, g.appids]), [['Yakuza Kiwami (Legacy)', [834530]]])
})

test('Wallpaper Engine é programa oculto, por AppID ou por nome', () => {
  assert.equal(hidden.isHiddenGame({ appid: 431960 }), true)
  assert.equal(hidden.isHiddenGame({ title: 'Wallpaper Engine' }), true)
  assert.equal(hidden.isHiddenGame({ appid: 3717330, title: 'Yakuza Kiwami' }), false)
})

test('a leitura funde os dois cards do Yakuza Kiwami e apaga o Wallpaper Engine', async () => {
  const result = await library.syncSteamLibrary()
  assert.deepEqual(result.errors, [])
  assert.equal(result.merged, 1)
  assert.equal(result.created, 0)

  assert.equal(count("SELECT COUNT(*) AS n FROM media_items WHERE type = 'game' AND title LIKE 'Yakuza%'"), 1)
  const yakuza = row("SELECT * FROM media_items WHERE title = 'Yakuza Kiwami'")
  assert.equal(yakuza.external_id, '58175') // fica o card do Playnite, com capa, nota e status
  assert.equal(yakuza.cover_url, 'https://media.rawg.io/media/games/yakuza.jpg')
  assert.equal(yakuza.rating, 4.5)
  assert.equal(yakuza.game_status, 'zerado')
  assert.equal(yakuza.steam_appid, 834530)
  assert.equal(yakuza.playtime_seconds, 43_200) // 10 h no antigo + 2 h no relançamento
  assert.equal(yakuza.playtime_source, 'steam')

  // Diário, listas e atividade do card apagado passam para o que ficou.
  assert.equal(count(`SELECT COUNT(*) AS n FROM diary_entries WHERE media_item_id = ${yakuza.id}`), 1)
  assert.equal(count(`SELECT COUNT(*) AS n FROM list_items WHERE media_item_id = ${yakuza.id}`), 1)
  assert.equal(count("SELECT COUNT(*) AS n FROM activity_events WHERE external_ref = '58175'"), 1)
  // O Playnite passa a apontar para o card que ficou, sem recriar o repetido.
  const { cfg } = await import('../integrations/config.js')
  assert.equal(JSON.parse(cfg('PLAYNITE_STATE'))['pn-yakuza'].externalId, '58175')
  // Mesmo tempo somado da leitura anterior: nada de sessão inventada no diário.
  assert.equal(count("SELECT COUNT(*) AS n FROM diary_progress WHERE source = 'steam'"), 0)

  assert.equal(count("SELECT COUNT(*) AS n FROM media_items WHERE title = 'Wallpaper Engine'"), 0)
  assert.equal(count("SELECT COUNT(*) AS n FROM activity_events WHERE title = 'Wallpaper Engine'"), 0)
})

test('ler de novo não recria nada', async () => {
  const before = count('SELECT COUNT(*) AS n FROM media_items')
  const result = await library.syncSteamLibrary()
  assert.equal(result.merged, 0)
  assert.equal(result.created, 0)
  assert.equal(count('SELECT COUNT(*) AS n FROM media_items'), before)
})

test('jogar o relançamento soma ao tempo do card único', async () => {
  OWNED = OWNED.map(g => g.appid === 3717330 ? { ...g, playtime_forever: 180, rtime_last_played: Math.floor(Date.now() / 1000) - 60 } : g)
  await library.syncSteamLibrary()
  assert.equal(row("SELECT playtime_seconds FROM media_items WHERE title = 'Yakuza Kiwami'").playtime_seconds, 46_800)
  assert.equal(count("SELECT COUNT(*) AS n FROM diary_progress WHERE source = 'steam'"), 1)
})
