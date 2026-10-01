import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideLibraryUpdate, effectiveGameStatus, type LibraryGameRow } from './library-plan.js'

const owned = (minutes: number, lastPlayed: string | null = '2026-09-30T22:00:00.000Z') =>
  ({ appid: 292030, name: 'The Witcher 3: Wild Hunt', playtime_minutes: minutes, last_played_at: lastPlayed })

const row = (patch: Partial<LibraryGameRow>): LibraryGameRow => ({
  id: 1, title: 'The Witcher 3: Wild Hunt', status: 'in_progress', game_status: 'jogando', game_status_source: 'playnite',
  playtime_seconds: 3_600, playtime_source: 'playnite', last_played_at: '2026-09-01T20:00:00.000Z', steam_appid: 292030,
  ...patch,
})

test('jogo novo entra como jogando quando tem tempo, ou no Backlog quando nunca foi aberto', () => {
  assert.deepEqual(decideLibraryUpdate(owned(90), null), {
    gameStatus: 'jogando', playtimeSeconds: 5_400, lastPlayedAt: '2026-09-30T22:00:00.000Z', started: true,
  })
  assert.deepEqual(decideLibraryUpdate(owned(0, null), null), {
    gameStatus: 'backlog', playtimeSeconds: null, lastPlayedAt: null, started: false,
  })
})

test('comprar um jogo da Wishlist o leva ao Backlog; jogar o leva a jogando', () => {
  const wanted = row({ status: 'wishlist', game_status: 'nunca_jogado', playtime_seconds: null, last_played_at: null })
  assert.equal(decideLibraryUpdate(owned(0, null), wanted).gameStatus, 'backlog')
  assert.equal(decideLibraryUpdate(owned(30), wanted).gameStatus, 'jogando')

  const owning = row({ status: 'wishlist', game_status: 'backlog', playtime_seconds: null, last_played_at: null })
  const decision = decideLibraryUpdate(owned(30), owning)
  assert.equal(decision.gameStatus, 'jogando')
  assert.equal(decision.started, true)
})

test('nunca rebaixa nem mexe em zerado, platinado, pausado ou abandonado', () => {
  for (const gameStatus of ['zerado', 'platinado', 'pausado', 'abandonado'] as const) {
    const decision = decideLibraryUpdate(owned(600), row({ game_status: gameStatus, game_status_source: 'manual' }))
    assert.equal(decision.gameStatus, null, gameStatus)
    assert.equal(decision.started, false)
  }
})

test('tempo e última vez jogada passam a vir da Steam', () => {
  const decision = decideLibraryUpdate(owned(600), row({}))
  assert.equal(decision.playtimeSeconds, 36_000)
  assert.equal(decision.lastPlayedAt, '2026-09-30T22:00:00.000Z')
  assert.equal(decision.gameStatus, null)

  // Mesma leitura de novo: nada muda.
  const same = decideLibraryUpdate(owned(600), row({ playtime_seconds: 36_000, last_played_at: '2026-09-30T22:00:00.000Z' }))
  assert.deepEqual(same, { gameStatus: null, playtimeSeconds: null, lastPlayedAt: null, started: false })
})

test('tempo digitado à mão maior que o da Steam é preservado', () => {
  const manual = row({ playtime_seconds: 90_000, playtime_source: 'manual' })
  assert.equal(decideLibraryUpdate(owned(600), manual).playtimeSeconds, null)
  assert.equal(decideLibraryUpdate(owned(2_000), manual).playtimeSeconds, 120_000)
})

test('jogos antigos sem game_status usam o status base', () => {
  assert.equal(effectiveGameStatus({ status: 'wishlist', game_status: null }), 'nunca_jogado')
  assert.equal(effectiveGameStatus({ status: 'completed', game_status: null }), 'zerado')
  assert.equal(effectiveGameStatus({ status: 'in_progress', game_status: null }), 'jogando')
})
