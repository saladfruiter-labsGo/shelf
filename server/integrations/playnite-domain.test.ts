import { test } from 'node:test'
import assert from 'node:assert/strict'
import { joinPlayniteNames, playniteGameStatus, playniteRating } from './playnite-domain.js'

test('converte todos os CompletionStatus conhecidos', () => {
  assert.equal(playniteGameStatus('Beaten', 0), 'platinado')
  assert.equal(playniteGameStatus('Completed', 0), 'zerado')
  assert.equal(playniteGameStatus('Finished', 0), 'zerado')
  assert.equal(playniteGameStatus('Abandoned', 100), 'abandonado')
  assert.equal(playniteGameStatus('Not Played', 0), 'nunca_jogado')
  assert.equal(playniteGameStatus('Plan to Play', 0), 'nunca_jogado')
  assert.equal(playniteGameStatus('Playing', 100), 'jogando')
  assert.equal(playniteGameStatus('On Hold', 100), 'jogando')
})

test('status customizado usa playtime sem inventar conclusão', () => {
  assert.equal(playniteGameStatus('Custom', 1), 'jogando')
  assert.equal(playniteGameStatus('Custom', 0), 'nunca_jogado')
  assert.equal(playniteGameStatus(undefined, 30), 'jogando')
})

test('normaliza nota e listas vindas do PowerShell', () => {
  assert.equal(playniteRating(null), 0)
  assert.equal(playniteRating(0), 0)
  assert.equal(playniteRating(83), 4)
  assert.equal(playniteRating(95), 5)
  assert.equal(joinPlayniteNames(['CD Projekt RED', '  Saber  ']), 'CD Projekt RED, Saber')
  assert.equal(joinPlayniteNames('Valve'), 'Valve')
  assert.equal(joinPlayniteNames([]), null)
})
