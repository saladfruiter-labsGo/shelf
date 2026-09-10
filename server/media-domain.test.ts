import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  GAME_STATUS_TO_BASE,
  LIBRARY_STATUS_PREDICATE,
  isGameStatus,
  isLibraryStatus,
  isMediaStatus,
  isMediaType,
} from './media-domain.js'

test('cada status granular de jogo deriva o status base correto', () => {
  assert.deepEqual(GAME_STATUS_TO_BASE, {
    jogando: 'in_progress',
    zerado: 'completed',
    platinado: 'completed',
    abandonado: 'dropped',
    nunca_jogado: 'wishlist',
  })
})

test('reconhece apenas tipos e status persistidos pelo Shelf', () => {
  assert.equal(isMediaType('movie'), true)
  assert.equal(isMediaType('music'), true)
  assert.equal(isMediaType('podcast'), false)
  assert.equal(isMediaStatus('completed'), true)
  assert.equal(isMediaStatus('finished'), false)
  assert.equal(isGameStatus('platinado'), true)
  assert.equal(isGameStatus('beaten'), false)
})

test('wishlist nunca pertence à biblioteca', () => {
  assert.equal(isLibraryStatus('wishlist'), false)
  assert.equal(isLibraryStatus('in_progress'), true)
  assert.equal(isLibraryStatus('completed'), true)
  assert.equal(isLibraryStatus('dropped'), true)
  assert.equal(isLibraryStatus('valor_invalido'), false)
  assert.equal(LIBRARY_STATUS_PREDICATE, "status != 'wishlist'")
})
