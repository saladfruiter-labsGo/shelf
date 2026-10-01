import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-steam-diagnostic-'))

let database: Database.Database
const realFetch = globalThis.fetch

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

// Conta fictícia: Witcher 3 zerado (conquista de final desbloqueada), um jogo
// com conquista oculta sem descrição, um sem conquista de final, um sem
// estatísticas e um nunca jogado.
const OWNED = [
  { appid: 292030, name: 'The Witcher 3: Wild Hunt', playtime_forever: 6000, has_community_visible_stats: true },
  { appid: 111, name: 'Mystery Game', playtime_forever: 300, has_community_visible_stats: true },
  { appid: 222, name: 'Sandbox Builder', playtime_forever: 900, has_community_visible_stats: true },
  { appid: 333, name: 'No Stats Game', playtime_forever: 60, has_community_visible_stats: false },
  { appid: 444, name: 'Unplayed Game', playtime_forever: 0, has_community_visible_stats: true },
]
const SCHEMA: Record<number, unknown[]> = {
  292030: [
    { name: 'TRIAL', displayName: 'Passed the Trial', description: 'Finish the game on any difficulty.', hidden: 0 },
    { name: 'BOOKS', displayName: 'Bookworm', description: 'Read 30 books.', hidden: 0 },
  ],
  111: [{ name: 'SECRET', displayName: 'Something happened', hidden: 1 }],
  222: [{ name: 'BUILD', displayName: 'Architect', description: 'Build 100 houses.', hidden: 0 }],
}
const PLAYER: Record<number, unknown[]> = {
  292030: [{ apiname: 'TRIAL', achieved: 1, unlocktime: 1_700_000_000 }, { apiname: 'BOOKS', achieved: 0, unlocktime: 0 }],
  111: [{ apiname: 'SECRET', achieved: 0, unlocktime: 0 }],
  222: [{ apiname: 'BUILD', achieved: 1, unlocktime: 1_700_000_000 }],
}

before(async () => {
  database = (await import('../db.js')).db
  const { setCfg } = await import('../integrations/config.js')
  setCfg('STEAM_ID', '76561198000000001')
  setCfg('STEAM_API_KEY', 'test-key')

  const add = database.prepare(
    "INSERT INTO media_items (external_id, type, title, status, game_status, steam_appid, library) VALUES (?, 'game', ?, ?, ?, ?, ?)",
  )
  add.run('w3', 'The Witcher 3: Wild Hunt', 'in_progress', 'jogando', 292030, 'Steam')
  add.run('sb', 'Sandbox Builder', 'wishlist', 'backlog', null, 'Steam')
  add.run('gog', 'Disco Elysium', 'completed', 'zerado', null, 'GOG')
  add.run('epic', 'Alan Wake 2', 'in_progress', 'jogando', null, 'Epic')
  add.run('want', 'Quero comprar', 'wishlist', 'nunca_jogado', null, null)

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const appid = Number(url.searchParams.get('appid'))
    if (url.pathname.includes('GetOwnedGames')) return json({ response: { games: OWNED } })
    if (url.pathname.includes('GetSchemaForGame')) return json({ game: { availableGameStats: { achievements: SCHEMA[appid] ?? [] } } })
    if (url.pathname.includes('GetPlayerAchievements')) {
      if (!PLAYER[appid]) return json({ playerstats: { error: 'Requested app has no stats', success: false } }, 400)
      return json({ playerstats: { success: true, achievements: PLAYER[appid] } })
    }
    throw new Error(`fetch inesperado: ${url}`)
  }) as typeof fetch
})

after(() => {
  globalThis.fetch = realFetch
  database.close()
})

test('mede biblioteca, lojas de fora e cobertura do "zerado" sem gravar nos itens', async () => {
  const { startSteamDiagnostic, stopSteamDiagnostic, lastDiagnostic } = await import('./diagnostic.js')
  const before = database.prepare("SELECT COUNT(*) n, MAX(updated_at) u FROM media_items").get()

  startSteamDiagnostic()
  await stopSteamDiagnostic().catch(() => {})
  // stop() interrompe; roda de novo sem interrupção para medir tudo.
  const { diagnostic } = startSteamDiagnostic()
  while (lastDiagnostic()?.running) await new Promise(resolve => setTimeout(resolve, 10))
  const result = lastDiagnostic()!

  assert.equal(diagnostic.started_at <= result.finished_at!, true)
  assert.equal(result.owned_total, 5)
  assert.equal(result.owned_played, 4)
  assert.equal(result.playtime_hours, 121)

  assert.equal(result.shelf.games, 4) // biblioteca + Backlog; a wishlist de compra fica de fora
  assert.equal(result.shelf.matched_by_appid, 1)
  assert.equal(result.shelf.matched_by_title, 1)
  assert.deepEqual(result.shelf.outside_steam, [{ library: 'Epic', count: 1 }, { library: 'GOG', count: 1 }])

  assert.equal(result.achievements.checked, 3)
  assert.equal(result.achievements.auto, 1)
  assert.equal(result.achievements.confirm, 1)
  assert.equal(result.achievements.manual, 1)
  assert.equal(result.achievements.no_achievements, 1)
  assert.equal(result.achievements.would_be_zerado, 1)
  assert.equal(result.achievements.would_be_platinado, 1)
  assert.equal(result.achievements.games_with_hidden_without_description, 1)
  assert.deepEqual(result.samples.auto, [{ title: 'The Witcher 3: Wild Hunt', achievements: ['Passed the Trial'], unlocked: true }])
  assert.deepEqual(result.errors, [])

  assert.deepEqual(database.prepare("SELECT COUNT(*) n, MAX(updated_at) u FROM media_items").get(), before)
})

test('conquistas privadas viram aviso claro, não contagem errada', async () => {
  const previous = globalThis.fetch
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    if (url.pathname.includes('GetPlayerAchievements')) return json({ playerstats: { error: 'Profile is not public', success: false } }, 403)
    return previous(input)
  }) as typeof fetch
  try {
    const { startSteamDiagnostic, lastDiagnostic } = await import('./diagnostic.js')
    startSteamDiagnostic()
    while (lastDiagnostic()?.running) await new Promise(resolve => setTimeout(resolve, 10))
    const result = lastDiagnostic()!
    assert.equal(result.achievements.private, true)
    assert.match(result.errors[0], /Detalhes do jogo: Público/)
  } finally {
    globalThis.fetch = previous
  }
})
