import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-steam-library-'))

let database: Database.Database
let library: typeof import('./library.js')
const realFetch = globalThis.fetch
const HOUR = 3_600_000
const recent = () => Math.floor((Date.now() - HOUR) / 1000)
const OLD = Math.floor(Date.parse('2024-05-01T20:00:00.000Z') / 1000)

// A conta Steam, mutável entre leituras.
let OWNED: any[] = []

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

before(async () => {
  database = (await import('../db.js')).db
  library = await import('./library.js')
  const { setCfg } = await import('../integrations/config.js')
  setCfg('STEAM_ID', '76561198000000001')
  setCfg('STEAM_API_KEY', 'test-key')
  setCfg('RAWG_API_KEY', 'rawg-key')

  const add = database.prepare(`
    INSERT INTO media_items (external_id, type, title, status, game_status, game_status_source, playtime_seconds, playtime_source, last_played_at, library)
    VALUES (?, 'game', ?, ?, ?, ?, ?, ?, ?, ?)
  `)
  // Vindo do Playnite com id da RAWG: casa pelo AppID das lojas da RAWG.
  add.run('3328', 'The Witcher 3: Wild Hunt', 'completed', 'zerado', 'playnite', 7_200, 'playnite', '2024-05-01T20:00:00.000Z', 'Steam')
  // Sem RAWG útil: casa pelo título exato.
  add.run('playnite:abc', 'Hades', 'in_progress', 'jogando', 'playnite', 600, 'playnite', null, 'Steam')
  // Wishlist que foi comprada.
  add.run('999', 'Celeste', 'wishlist', 'nunca_jogado', 'manual', null, null, null, null)

  OWNED = [
    { appid: 292030, name: 'The Witcher 3: Wild Hunt', playtime_forever: 6_000, rtime_last_played: OLD },
    { appid: 1145360, name: 'Hades', playtime_forever: 1_200, rtime_last_played: recent() },
    { appid: 504230, name: 'Celeste', playtime_forever: 0, rtime_last_played: 0 },
    { appid: 1091500, name: 'Cyberpunk 2077', playtime_forever: 0, rtime_last_played: 0 },
    { appid: 367520, name: 'Hollow Knight', playtime_forever: 240, rtime_last_played: OLD },
  ]

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname.includes('GetOwnedGames')) return json({ response: { games: OWNED } })
    if (url.hostname === 'api.rawg.io' && url.pathname === '/api/games/3328/stores') {
      return json({ results: [{ url: 'https://store.steampowered.com/app/292030/The_Witcher_3_Wild_Hunt/' }] })
    }
    if (url.hostname === 'api.rawg.io') return json({ results: [] })
    if (init?.method === 'HEAD') return new Response(null, { status: url.pathname.includes('/367520/') ? 404 : 200 })
    throw new Error(`fetch inesperado: ${url}`)
  }) as typeof fetch
})

after(() => {
  globalThis.fetch = realFetch
  database.close()
})

const game = (title: string) => database.prepare(`
  SELECT external_id, status, game_status, game_status_source, playtime_seconds, playtime_source, steam_appid, cover_url
    FROM media_items WHERE type = 'game' AND title = ?
`).get(title) as Record<string, any>

const count = (sql: string) => (database.prepare(sql).get() as { n: number }).n

test('primeira leitura adota os jogos existentes, cria os novos e não inventa sessões antigas', async () => {
  const result = await library.syncSteamLibrary()
  assert.deepEqual(result.errors, [])
  assert.equal(result.owned, 5)
  assert.equal(result.adopted, 2) // Hades e Celeste pelo título; Witcher já tinha AppID pela RAWG
  assert.equal(result.created, 2)

  const witcher = game('The Witcher 3: Wild Hunt')
  assert.equal(witcher.external_id, '3328') // external_id nunca muda
  assert.equal(witcher.steam_appid, 292030)
  assert.equal(witcher.game_status, 'zerado') // zerado não é mexido
  assert.equal(witcher.game_status_source, 'playnite')
  assert.equal(witcher.playtime_seconds, 360_000)
  assert.equal(witcher.playtime_source, 'steam')

  assert.equal(game('Hades').steam_appid, 1145360)
  assert.equal(game('Hades').playtime_source, 'steam')

  // Comprado: sai da Wishlist para o Backlog, com selo da Steam.
  assert.deepEqual([game('Celeste').status, game('Celeste').game_status, game('Celeste').game_status_source], ['wishlist', 'backlog', 'steam'])

  const cyberpunk = game('Cyberpunk 2077')
  assert.equal(cyberpunk.external_id, 'steam:1091500')
  assert.equal(cyberpunk.game_status, 'backlog')
  assert.match(cyberpunk.cover_url, /library_600x900_2x\.jpg$/)

  const hollow = game('Hollow Knight')
  assert.equal(hollow.game_status, 'jogando')
  assert.equal(hollow.status, 'in_progress')
  assert.match(hollow.cover_url, /header\.jpg$/) // sem arte vertical

  // Hollow Knight foi jogado há anos: sem atividade nem diário na primeira leitura.
  assert.equal(count("SELECT COUNT(*) AS n FROM activity_events WHERE source = 'steam'"), 0)
  assert.equal(count("SELECT COUNT(*) AS n FROM diary_progress WHERE source = 'steam'"), 0)
})

test('ler de novo sem mudanças não altera nada nem duplica', async () => {
  const before = count('SELECT COUNT(*) AS n FROM media_items')
  const result = await library.syncSteamLibrary()
  assert.equal(result.created, 0)
  assert.equal(result.updated, 0)
  assert.equal(count('SELECT COUNT(*) AS n FROM media_items'), before)
})

test('jogar gera progresso no diário e atividade com a data da Steam', async () => {
  OWNED = OWNED.map(g => {
    if (g.appid === 1145360) return { ...g, playtime_forever: 1_320, rtime_last_played: recent() }
    if (g.appid === 1091500) return { ...g, playtime_forever: 45, rtime_last_played: recent() }
    return g
  })
  const result = await library.syncSteamLibrary()
  assert.equal(result.started, 1) // Cyberpunk saiu do Backlog

  assert.equal(game('Cyberpunk 2077').game_status, 'jogando')
  assert.equal(game('Hades').playtime_seconds, 79_200)
  assert.equal(count("SELECT COUNT(*) AS n FROM diary_progress WHERE source = 'steam'"), 2)
  assert.equal(count("SELECT COUNT(*) AS n FROM activity_events WHERE source = 'steam' AND event_type = 'playing'"), 1)

  // Repetir a mesma leitura não duplica atividade nem progresso.
  await library.syncSteamLibrary()
  assert.equal(count("SELECT COUNT(*) AS n FROM activity_events WHERE source = 'steam'"), 1)
  assert.equal(count("SELECT COUNT(*) AS n FROM diary_progress WHERE source = 'steam'"), 2)
})

test('biblioteca vazia com histórico (perfil privado) não muda nada', async () => {
  const snapshot = database.prepare('SELECT id, status, game_status, playtime_seconds FROM media_items ORDER BY id').all()
  OWNED = []
  const result = await library.syncSteamLibrary()
  assert.match(result.errors[0], /biblioteca vazia/)
  assert.deepEqual(database.prepare('SELECT id, status, game_status, playtime_seconds FROM media_items ORDER BY id').all(), snapshot)
})
