import { test } from 'node:test'
import assert from 'node:assert/strict'
import { kavitaRating, kavitaReadingStatus } from './kavita-domain.js'

test('normaliza notas Kavita nas escalas 0-5 e 0-100', () => {
  assert.equal(kavitaRating({ hasUserRated: false, userRating: 5 }), 0)
  assert.equal(kavitaRating({ hasUserRated: true, userRating: 0 }), 0)
  assert.equal(kavitaRating({ hasUserRated: true, userRating: 4.2 }), 4)
  assert.equal(kavitaRating({ hasUserRated: true, userRating: 90 }), 4.5)
})

test('só conclui leitura quando existe total e todas as páginas foram lidas', () => {
  assert.equal(kavitaReadingStatus(0, 10), 'in_progress')
  assert.equal(kavitaReadingStatus(100, 99), 'in_progress')
  assert.equal(kavitaReadingStatus(100, 100), 'completed')
  assert.equal(kavitaReadingStatus(100, 120), 'completed')
})
