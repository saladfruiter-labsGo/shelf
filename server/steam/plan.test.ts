/** Plano de sincronização bidirecional: o que entra, o que sai e para que lado. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { planWishlistSync, nextKnown } from './plan.js'

const BOTH = { pull: true, push: true, removals: false }

test('novidade de cada lado é copiada para o outro', () => {
  const p = planWishlistSync([1, 2], [2, 3], [], BOTH)
  assert.deepEqual(p.toShelf, [1])
  assert.deepEqual(p.toSteam, [3])
  assert.deepEqual(p.removeFromShelf, [])
  assert.deepEqual(p.removeFromSteam, [])
})

test('item já sincronizado que sumiu de um lado não é recriado', () => {
  // 7 estava nos dois; sumiu da Steam. Sem propagar remoções, ninguém mexe.
  const p = planWishlistSync([], [7], [7], BOTH)
  assert.deepEqual(p.toSteam, [])
  assert.deepEqual(p.removeFromShelf, [])
})

test('com remoções ligadas, a saída se propaga para o lado certo', () => {
  const opts = { pull: true, push: true, removals: true }
  const removedOnSteam = planWishlistSync([], [7], [7], opts)
  assert.deepEqual(removedOnSteam.removeFromShelf, [7])

  const removedOnShelf = planWishlistSync([9], [], [9], opts)
  assert.deepEqual(removedOnShelf.removeFromSteam, [9])
})

test('modo só-leitura não escreve na Steam', () => {
  const p = planWishlistSync([1], [2], [], { pull: true, push: false, removals: false })
  assert.deepEqual(p.toShelf, [1])
  assert.deepEqual(p.toSteam, [])
})

test('modo só-escrita não traz a wishlist da Steam', () => {
  const p = planWishlistSync([1], [2], [], { pull: false, push: true, removals: false })
  assert.deepEqual(p.toShelf, [])
  assert.deepEqual(p.toSteam, [2])
})

test('itens presentes nos dois lados ficam parados', () => {
  const p = planWishlistSync([4, 5], [5, 4], [4], BOTH)
  assert.deepEqual(p, { toShelf: [], toSteam: [], removeFromShelf: [], removeFromSteam: [] })
})

test('nextKnown guarda o que ficou nos dois lados depois do plano', () => {
  const steam = [1, 2]
  const shelf = [2, 3]
  const plan = planWishlistSync(steam, shelf, [], BOTH)
  assert.deepEqual(nextKnown(steam, shelf, plan).sort(), [1, 2, 3])
})

test('nextKnown esquece o que foi removido', () => {
  const opts = { pull: true, push: true, removals: true }
  const plan = planWishlistSync([], [7], [7], opts)
  assert.deepEqual(nextKnown([], [7], plan), [])
})
