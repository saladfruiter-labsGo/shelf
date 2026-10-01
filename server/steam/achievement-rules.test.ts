import { test } from 'node:test'
import assert from 'node:assert/strict'
import { decideAchievementStatus, shouldAutoAbandon } from './achievement-rules.js'

const snap = (patch: Partial<Parameters<typeof decideAchievementStatus>[1]> = {}) =>
  ({ total: 78, unlocked: 30, finaleUnlocks: [], lastUnlockAt: '2026-05-01T20:00:00.000Z', ...patch })

test('conquista de final desbloqueada vira zerado com a data dela', () => {
  const decision = decideAchievementStatus(
    { game_status: 'jogando', game_status_source: 'steam' },
    snap({ finaleUnlocks: ['2026-03-10T22:00:00.000Z', '2026-02-01T21:00:00.000Z'] }),
  )
  assert.deepEqual(decision, { gameStatus: 'zerado', completedAt: '2026-02-01T21:00:00.000Z' })
})

test('todas as conquistas viram platinado; a data é o primeiro final, senão o último desbloqueio', () => {
  assert.deepEqual(
    decideAchievementStatus({ game_status: 'zerado', game_status_source: 'steam' }, snap({ unlocked: 78, finaleUnlocks: ['2026-02-01T21:00:00.000Z'] })),
    { gameStatus: 'platinado', completedAt: '2026-02-01T21:00:00.000Z' },
  )
  assert.deepEqual(
    decideAchievementStatus({ game_status: 'jogando', game_status_source: 'playnite' }, snap({ unlocked: 78 })),
    { gameStatus: 'platinado', completedAt: '2026-05-01T20:00:00.000Z' },
  )
})

test('nada muda sem final reconhecido, em platinado já existente ou em status manual', () => {
  assert.equal(decideAchievementStatus({ game_status: 'jogando', game_status_source: 'steam' }, snap()).gameStatus, null)
  // Platina é pegajosa: DLC novo baixa a porcentagem mas não o status.
  assert.equal(decideAchievementStatus({ game_status: 'platinado', game_status_source: 'steam' }, snap({ unlocked: 70 })).gameStatus, null)
  assert.equal(
    decideAchievementStatus({ game_status: 'jogando', game_status_source: 'manual' }, snap({ unlocked: 78, finaleUnlocks: ['2026-02-01T21:00:00.000Z'] })).gameStatus,
    null,
  )
})

test('zerar um jogo abandonado ou do backlog também conta', () => {
  for (const gameStatus of ['abandonado', 'pausado', 'backlog']) {
    const decision = decideAchievementStatus({ game_status: gameStatus, game_status_source: 'steam' }, snap({ finaleUnlocks: ['2026-02-01T21:00:00.000Z'] }))
    assert.equal(decision.gameStatus, 'zerado', gameStatus)
  }
})

test('abandono automático só para jogando parado há mais de N dias, sem final e sem escolha manual', () => {
  const now = Date.parse('2026-10-01T12:00:00.000Z')
  const old = '2026-04-01T12:00:00.000Z' // 183 dias antes
  const recent = '2026-08-01T12:00:00.000Z'
  assert.equal(shouldAutoAbandon({ game_status: 'jogando', game_status_source: 'steam', last_played_at: old }, false, 150, now), true)
  assert.equal(shouldAutoAbandon({ game_status: 'jogando', game_status_source: 'steam', last_played_at: recent }, false, 150, now), false)
  assert.equal(shouldAutoAbandon({ game_status: 'jogando', game_status_source: 'steam', last_played_at: old }, true, 150, now), false)
  assert.equal(shouldAutoAbandon({ game_status: 'jogando', game_status_source: 'manual', last_played_at: old }, false, 150, now), false)
  assert.equal(shouldAutoAbandon({ game_status: 'pausado', game_status_source: 'steam', last_played_at: old }, false, 150, now), false)
  assert.equal(shouldAutoAbandon({ game_status: 'jogando', game_status_source: 'steam', last_played_at: old }, false, 0, now), false)
})
