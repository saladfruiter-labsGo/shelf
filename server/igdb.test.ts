import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-igdb-'))

let database: Database.Database
let igdb: typeof import('./igdb.js')
let setCfg: (key: string, value: string) => void
const realFetch = globalThis.fetch
let tokenCalls = 0
let revokeOnce = false
const bodies: string[] = []

// IGDB simulada: Witcher 3 (Steam 292030 → IGDB 1942) tem tempos; Hades (1145360) não está na IGDB.
const fakeIgdb = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = new URL(String(input))
  if (url.hostname === 'id.twitch.tv') {
    tokenCalls++
    return new Response(JSON.stringify({ access_token: `token-${tokenCalls}`, expires_in: 5_000_000, token_type: 'bearer' }))
  }
  if (url.hostname === 'api.igdb.com') {
    const body = String(init?.body ?? '')
    bodies.push(body)
    if (revokeOnce) { revokeOnce = false; return new Response('', { status: 401 }) }
    if (url.pathname === '/v4/external_games') {
      return new Response(JSON.stringify(body.includes('"292030"') ? [{ game: 1942, external_game_source: 1 }] : []))
    }
    if (url.pathname === '/v4/game_time_to_beats') {
      return new Response(JSON.stringify(body.includes('1942') ? [{ hastily: 133_200, normally: 259_200, completely: 583_200 }] : []))
    }
  }
  throw new Error(`fetch inesperado: ${url}`)
}) as typeof fetch

before(async () => {
  database = (await import('./db.js')).db
  igdb = await import('./igdb.js')
  setCfg = (await import('./integrations/config.js')).setCfg
  globalThis.fetch = fakeIgdb
  const add = database.prepare("INSERT INTO media_items (external_id, type, title, status, steam_appid) VALUES (?, 'game', ?, 'in_progress', ?)")
  add.run('steam:292030', 'The Witcher 3: Wild Hunt', 292030)
  add.run('steam:1145360', 'Hades', 1145360)
})

after(() => {
  globalThis.fetch = realFetch
  database.close()
})

const times = (title: string) => database.prepare(
  'SELECT igdb_id, ttb_main_seconds AS main, ttb_extra_seconds AS extra, ttb_complete_seconds AS complete, ttb_fetched_at FROM media_items WHERE title = ?',
).get(title) as Record<string, any>

test('sem credenciais o job não faz nada', async () => {
  const result = await igdb.syncTimeToBeat()
  assert.equal(result.checked, 0)
  assert.equal(tokenCalls, 0)
})

test('busca o tempo pelo AppID da Steam e grava; jogo fora da IGDB fica marcado sem tempo', async () => {
  setCfg('IGDB_CLIENT_ID', 'client')
  setCfg('IGDB_CLIENT_SECRET', 'secret')
  const result = await igdb.syncTimeToBeat()
  assert.deepEqual([result.checked, result.found, result.errors], [2, 1, []])

  const witcher = times('The Witcher 3: Wild Hunt')
  assert.deepEqual([witcher.igdb_id, witcher.main, witcher.extra, witcher.complete], [1942, 133_200, 259_200, 583_200])
  const hades = times('Hades')
  assert.equal(hades.main, null)
  assert.ok(hades.ttb_fetched_at) // consultado: não repete até vencer
  assert.match(bodies[0], /where uid = "292030" & external_game_source = 1/)

  // Token reaproveitado entre as consultas.
  assert.equal(tokenCalls, 1)

  // Dado fresco: nova rodada não consulta.
  const again = await igdb.syncTimeToBeat()
  assert.equal(again.checked, 0)
})

test('token revogado é renovado uma vez e a consulta segue', async () => {
  revokeOnce = true
  const result = await igdb.timeToBeatForSteamApp(292030)
  assert.equal(result.main, 133_200)
  assert.equal(tokenCalls, 2)
})

test('a página do jogo consulta quando o dado venceu', async () => {
  const app = (await import('./routes/games.js')).default as any
  const id = (database.prepare("SELECT id FROM media_items WHERE title = 'The Witcher 3: Wild Hunt'").get() as { id: number }).id
  database.prepare('UPDATE media_items SET ttb_fetched_at = NULL, ttb_main_seconds = NULL WHERE id = ?').run(id)
  const body = await (await app.request(`/${id}/time-to-beat`)).json() as any
  assert.deepEqual(body, { configured: true, main: 133_200, extra: 259_200, complete: 583_200 })
})
