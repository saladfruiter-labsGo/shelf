import assert from 'node:assert/strict'
import test from 'node:test'
import { pickLastfmImage } from './lastfm-domain.js'

test('prioriza a imagem extralarge do Last.fm', () => {
  assert.equal(pickLastfmImage([
    { size: 'small', '#text': 'https://images.test/small.jpg' },
    { size: 'extralarge', '#text': 'https://images.test/large.jpg' },
    { size: 'mega', '#text': 'https://images.test/mega.jpg' },
  ]), 'https://images.test/large.jpg')
})

test('ignora o placeholder e entradas inválidas', () => {
  assert.equal(pickLastfmImage([
    { size: 'extralarge', '#text': 'https://lastfm.test/2a96cbd8b46e442fc41c2b86b821562f.png' },
  ]), null)
  assert.equal(pickLastfmImage(null), null)
})
