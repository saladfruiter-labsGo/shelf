import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-steam-achievements-'))

let database: Database.Database
let achievements: typeof import('./achievements.js')
const realFetch = globalThis.fetch
const DAY = 24 * 3_600_000
const unix = (ms: number) => Math.floor(ms / 1000)
const OLD_FINALE = unix(Date.parse('2024-03-10T22:00:00.000Z'))
const RECENT = unix(Date.now() - 3_600_000)

let playerCalls = 0
let privateProfile = false

const OWNED = [
  { appid: 292030, name: 'The Witcher 3: Wild Hunt', playtime_forever: 6_000, has_community_visible_stats: true },
  { appid: 1145360, name: 'Hades', playtime_forever: 4_000, has_community_visible_stats: true },
  { appid: 111, name: 'Manual', playtime_forever: 300, has_community_visible_stats: true },
  { appid: 222, name: 'Esquecido', playtime_forever: 120, has_community_visible_stats: true },
]
const SCHEMA: Record<number, unknown[]> = {
  292030: [
    { name: 'TRIAL', displayName: 'Passed the Trial', description: 'Finish the game on any difficulty.', hidden: 0, icon: 'https://steamcdn-a.akamaihd.net/a.jpg', icongray: 'https://steamcdn-a.akamaihd.net/a_g.jpg' },
    { name: 'BOOKS', displayName: 'Bookworm', description: 'Read 30 books.', hidden: 0 },
    { name: 'SECRET', displayName: 'Segredo', description: 'Spoiler do final.', hidden: 1 },
  ],
  1145360: [
    { name: 'ESCAPE', displayName: 'Escaped Tartarus', description: 'Clear an escape attempt.', hidden: 0 },
    { name: 'GODS', displayName: 'Friends in High Places', description: 'Meet all the gods.', hidden: 0 },
  ],
  111: [{ name: 'END', displayName: 'The End', description: 'Finish the game.', hidden: 0 }],
  222: [
    { name: 'START', displayName: 'Começo', description: 'Start the journey.', hidden: 0 },
    { name: 'MIDDLE', displayName: 'Meio', description: 'Reach the second region.', hidden: 0 },
  ],
}
const PLAYER: Record<number, unknown[]> = {
  292030: [{ apiname: 'TRIAL', achieved: 1, unlocktime: OLD_FINALE }, { apiname: 'BOOKS', achieved: 0, unlocktime: 0 }, { apiname: 'SECRET', achieved: 0, unlocktime: 0 }],
  1145360: [{ apiname: 'ESCAPE', achieved: 1, unlocktime: RECENT - 60 }, { apiname: 'GODS', achieved: 1, unlocktime: RECENT }],
  111: [{ apiname: 'END', achieved: 1, unlocktime: RECENT }],
  222: [{ apiname: 'START', achieved: 1, unlocktime: OLD_FINALE }, { apiname: 'MIDDLE', achieved: 0, unlocktime: 0 }],
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

before(async () => {
  database = (await import('../db.js')).db
  achievements = await import('./achievements.js')
  const { setCfg } = await import('../integrations/config.js')
  setCfg('STEAM_ID', '76561198000000001')
  setCfg('STEAM_API_KEY', 'test-key')

  const add = database.prepare(`
    INSERT INTO media_items (external_id, type, title, status, game_status, game_status_source, last_played_at, steam_appid, rating)
    VALUES (?, 'game', ?, ?, ?, ?, ?, ?, ?)
  `)
  const longAgo = new Date(Date.now() - 200 * DAY).toISOString()
  add.run('3328', 'The Witcher 3: Wild Hunt', 'in_progress', 'jogando', 'playnite', longAgo, 292030, 4.5)
  add.run('steam:1145360', 'Hades', 'in_progress', 'jogando', 'steam', new Date().toISOString(), 1145360, 0)
  add.run('steam:111', 'Manual', 'in_progress', 'jogando', 'manual', longAgo, 111, 0)
  add.run('steam:222', 'Esquecido', 'in_progress', 'jogando', 'steam', longAgo, 222, 0)

  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = new URL(String(input))
    const appid = Number(url.searchParams.get('appid') ?? url.searchParams.get('gameid'))
    if (url.pathname.includes('GetOwnedGames')) return json({ response: { games: OWNED } })
    if (url.pathname.includes('GetPlayerAchievements')) {
      playerCalls++
      if (privateProfile) return json({ playerstats: { error: 'Profile is not public', success: false } }, 403)
      return json({ playerstats: { success: true, achievements: PLAYER[appid] } })
    }
    if (url.pathname.includes('GetSchemaForGame')) return json({ game: { availableGameStats: { achievements: SCHEMA[appid] } } })
    if (url.pathname.includes('GetGlobalAchievementPercentagesForApp')) {
      return json({ achievementpercentages: { achievements: (SCHEMA[appid] as any[]).map((a, i) => ({ name: a.name, percent: 60 - i * 25.55 })) } })
    }
    throw new Error(`fetch inesperado: ${url}`)
  }) as typeof fetch
})

after(() => {
  globalThis.fetch = realFetch
  database.close()
})

const game = (title: string) => database.prepare(`
  SELECT status, game_status, game_status_source, completed_at, achievements_total, achievements_unlocked
    FROM media_items WHERE title = ?
`).get(title) as Record<string, any>

test('primeira leitura: zerado com a data real, platinado, manual intocado e abandono automático', async () => {
  const result = await achievements.syncSteamAchievements()
  assert.deepEqual(result.errors, [])
  assert.equal(result.checked, 4)

  const witcher = game('The Witcher 3: Wild Hunt')
  assert.equal(witcher.game_status, 'zerado')
  assert.equal(witcher.game_status_source, 'steam')
  assert.equal(witcher.status, 'completed')
  assert.equal(witcher.completed_at, '2024-03-10T22:00:00.000Z')
  assert.deepEqual([witcher.achievements_total, witcher.achievements_unlocked], [3, 1])

  // Zerado há anos: entra no diário com a data certa, sem atividade nem aviso.
  assert.deepEqual(
    database.prepare("SELECT watched_at, rating, source FROM diary_entries WHERE media_item_id = (SELECT id FROM media_items WHERE title = 'The Witcher 3: Wild Hunt')").all(),
    [{ watched_at: '2024-03-10T22:00:00.000Z', rating: 4.5, source: 'steam' }],
  )

  // Platina recente: atividade gerada.
  assert.equal(game('Hades').game_status, 'platinado')
  assert.equal((database.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE source = 'steam' AND title = 'Hades'").get() as { n: number }).n, 1)

  // Escolha manual prevalece, mesmo com final e 100%.
  assert.equal(game('Manual').game_status, 'jogando')
  assert.equal(game('Manual').game_status_source, 'manual')

  // Parado há 200 dias, sem final: abandonado.
  assert.equal(game('Esquecido').game_status, 'abandonado')
  assert.equal(result.abandonados, 1)
})

test('segunda leitura com o mesmo tempo de jogo não consulta de novo nem duplica o diário', async () => {
  const calls = playerCalls
  await achievements.syncSteamAchievements()
  assert.equal(playerCalls, calls)
  assert.equal((database.prepare("SELECT COUNT(*) AS n FROM diary_entries WHERE source = 'steam'").get() as { n: number }).n, 2)
})

test('a página do jogo esconde o spoiler de conquista oculta ainda bloqueada', async () => {
  const app = (await import('../routes/games.js')).default as any
  const id = (database.prepare("SELECT id FROM media_items WHERE title = 'The Witcher 3: Wild Hunt'").get() as { id: number }).id
  const body = await (await app.request(`/${id}/achievements`)).json() as any
  assert.equal(body.total, 3)
  assert.equal(body.unlocked, 1)
  const trial = body.achievements.find((a: any) => a.api_name === 'TRIAL')
  assert.equal(trial.finale, true)
  assert.equal(trial.global_percent, 60)
  const secret = body.achievements.find((a: any) => a.api_name === 'SECRET')
  assert.equal(secret.hidden, true)
  assert.equal(secret.description, null)
})

test('a Home recebe as últimas conquistas de todos os jogos, da mais recente para a mais antiga', async () => {
  const app = (await import('../routes/games.js')).default as any
  const body = await (await app.request('/achievements/latest?limit=3')).json() as any[]
  assert.equal(body.length, 3)
  const dates = body.map(a => Date.parse(a.unlocked_at))
  assert.deepEqual(dates, [...dates].sort((x, y) => y - x))
  assert.ok(body.every(a => typeof a.game === 'string' && Number.isInteger(a.media_item_id)))
  assert.equal(body.some(a => a.name === 'Bookworm'), false) // bloqueada não entra
})

test('perfil privado vira aviso e não mexe em nada', async () => {
  database.prepare("DELETE FROM settings WHERE key = 'STEAM_ACHIEVEMENTS_STATE'").run()
  const before = database.prepare('SELECT id, game_status FROM media_items ORDER BY id').all()
  privateProfile = true
  try {
    const result = await achievements.syncSteamAchievements()
    assert.equal(result.private, true)
    assert.match(result.errors[0], /Detalhes do jogo: Público/)
    assert.deepEqual(database.prepare('SELECT id, game_status FROM media_items ORDER BY id').all(), before)
  } finally {
    privateProfile = false
  }
})
