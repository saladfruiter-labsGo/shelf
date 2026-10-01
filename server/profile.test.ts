import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-profile-'))

const STEAM_ID = '76561198000000001'
const API_KEY = 'segredo-da-api-key'
const NOW = new Date('2026-10-01T12:00:00.000Z')

let database: Database.Database
let profile: typeof import('./profile.js')
const summary = { persona: 'Geralt', avatar_url: 'https://avatars.steamstatic.com/abc_full.jpg', profile_url: 'https://steamcommunity.com/id/geralt/' }

before(async () => {
  database = (await import('./db.js')).db
  profile = await import('./profile.js')
  const { setCfg } = await import('./integrations/config.js')
  setCfg('STEAM_ID', STEAM_ID)
  setCfg('STEAM_API_KEY', API_KEY)

  const add = database.prepare(`
    INSERT INTO media_items (external_id, type, title, status, game_status, game_status_source,
      playtime_seconds, playtime_source, completed_at, added_at, rating, favorite)
    VALUES (@external_id, @type, @title, @status, @game_status, @game_status_source,
      @playtime_seconds, @playtime_source, @completed_at, @added_at, @rating, @favorite)
  `)
  const base = { game_status: null, game_status_source: null, playtime_seconds: null, playtime_source: null, completed_at: null, rating: 0, favorite: 0 }
  add.run({ ...base, external_id: 'm1', type: 'movie', title: 'Filme visto', status: 'completed', added_at: '2026-03-01 10:00:00', rating: 4.5, favorite: 2 })
  add.run({ ...base, external_id: 'm2', type: 'movie', title: 'Filme na wishlist', status: 'wishlist', added_at: '2026-04-01 10:00:00' })
  add.run({ ...base, external_id: 'g1', type: 'game', title: 'Zerado este ano', status: 'completed', game_status: 'zerado', game_status_source: 'steam',
    playtime_seconds: 36_000, playtime_source: 'steam', completed_at: '2026-05-10T20:00:00.000Z', added_at: '2025-06-01 10:00:00' })
  add.run({ ...base, external_id: 'g2', type: 'game', title: 'Platinado antigo', status: 'completed', game_status: 'platinado', game_status_source: 'steam',
    playtime_seconds: 72_000, playtime_source: 'steam', completed_at: '2024-02-01T20:00:00.000Z', added_at: '2024-01-01 10:00:00' })
  add.run({ ...base, external_id: 'g3', type: 'game', title: 'Jogando', status: 'in_progress', game_status: 'jogando', game_status_source: 'manual',
    playtime_seconds: 3_600, playtime_source: 'playnite', added_at: '2026-08-01 10:00:00' })
  add.run({ ...base, external_id: 'g4', type: 'game', title: 'Tenho e não joguei', status: 'wishlist', game_status: 'backlog', added_at: '2026-09-01 10:00:00' })

  const filme = database.prepare("SELECT id FROM media_items WHERE external_id = 'm1'").get() as { id: number }
  database.prepare("INSERT INTO diary_entries (media_item_id, watched_at, rating) VALUES (?, '2026-03-01', 4.5)").run(filme.id)
})

after(() => database.close())

test('monta o perfil com prateleira por ano, filas e números de games', async () => {
  const view = await profile.buildProfile({ now: NOW, fetchSteamSummary: async () => summary })

  assert.equal(view.user.display_name, 'Você')
  assert.deepEqual(view.totals, { library: 4, wishlist: 1, backlog: 1, diary: 1, rated: 1 })
  assert.deepEqual(view.shelf_by_year.map(y => y.year), [2026, 2025, 2024, 2023, 2022])
  assert.deepEqual(view.shelf_by_year[0], { year: 2026, total: 2, completed: 1, in_progress: 1 })
  assert.deepEqual(view.shelf_by_year[2], { year: 2024, total: 1, completed: 1, in_progress: 0 })

  assert.equal(view.games.played_hours, 31)
  assert.equal(view.games.playing, 1)
  assert.equal(view.games.backlog, 1)
  assert.equal(view.games.completed_total, 2)
  assert.equal(view.games.platinum_total, 1)
  assert.equal(view.games.completed_this_year, 1)
  assert.equal(view.games.platinum_this_year, 0)
  // Selo só quando tudo veio da Steam: o tempo mistura Playnite, os zerados não.
  assert.equal(view.games.played_source, 'shelf')
  assert.equal(view.games.completed_source, 'steam')
  assert.equal(view.games.achievements_unlocked, 0)
  assert.equal(view.games.rarest_achievement, null)

  assert.deepEqual(view.favorites.map(f => f.title), ['Filme visto'])
  assert.deepEqual(view.recent_ratings.map(r => [r.title, r.rating]), [['Filme visto', 4.5]])
})

test('conta Steam e avatar vêm com procedência, sem SteamID nem API key na resposta', async () => {
  const view = await profile.buildProfile({ now: NOW, fetchSteamSummary: async () => summary })
  assert.deepEqual(view.accounts.steam, { ...summary, source: 'steam' })
  assert.equal(view.user.avatar_url, summary.avatar_url)
  assert.equal(view.user.avatar_source, 'steam')

  const json = JSON.stringify(view)
  assert.equal(json.includes(STEAM_ID), false)
  assert.equal(json.includes(API_KEY), false)
})

test('Steam fora do ar não derruba o perfil: usa o último resumo conhecido', async () => {
  database.prepare(
    "UPDATE settings SET value = json_set(value, '$.at', 0) WHERE key = 'STEAM_PLAYER_SUMMARY'",
  ).run()
  const view = await profile.buildProfile({ now: NOW, fetchSteamSummary: async () => { throw new Error('offline') } })
  assert.equal(view.accounts.steam?.persona, 'Geralt')
})

test('edição valida nome e avatar, e o avatar próprio prevalece sobre o da Steam', async () => {
  assert.equal(profile.parseProfileUpdate({ display_name: '   ' }).ok, false)
  assert.equal(profile.parseProfileUpdate({ display_name: 'x'.repeat(61) }).ok, false)
  assert.equal(profile.parseProfileUpdate({ avatar_url: 'http://inseguro.example/a.png' }).ok, false)
  assert.equal(profile.parseProfileUpdate({}).ok, false)

  const parsed = profile.parseProfileUpdate({ display_name: '  Igor   Augusto ', avatar_url: 'https://example.com/eu.png' })
  assert.equal(parsed.ok, true)
  if (parsed.ok) profile.applyProfileUpdate(parsed.update)

  const view = await profile.buildProfile({ now: NOW, fetchSteamSummary: async () => summary })
  assert.equal(view.user.display_name, 'Igor Augusto')
  assert.equal(view.user.avatar_url, 'https://example.com/eu.png')
  assert.equal(view.user.avatar_source, 'shelf')

  const reset = profile.parseProfileUpdate({ avatar_url: null })
  if (reset.ok) profile.applyProfileUpdate(reset.update)
  const back = await profile.buildProfile({ now: NOW, fetchSteamSummary: async () => summary })
  assert.equal(back.user.avatar_source, 'steam')
})
