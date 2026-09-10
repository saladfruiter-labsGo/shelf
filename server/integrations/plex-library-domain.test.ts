import assert from 'node:assert/strict'
import test from 'node:test'
import { moviesForPlexItem, type ShelfMovie } from './plex-library-domain.js'

const movie: ShelfMovie = {
  id: 1,
  external_id: 'plex:10',
  tmdb_id: '550',
  title: 'Clube da Luta',
  year: 1999,
}

test('casa filme primeiro pela identidade exata do Plex', () => {
  assert.deepEqual(moviesForPlexItem(
    { ratingKey: '10', title: 'Outro título', year: 2020 },
    new Map([['plex:10', [movie]]]),
    new Map(),
    new Map(),
  ), [movie])
})

test('usa Guid TMDB quando a identidade do Plex mudou', () => {
  assert.deepEqual(moviesForPlexItem(
    { guid: 'plex://movie/hash', Guid: [{ id: 'tmdb://550' }] },
    new Map(),
    new Map([['550', [movie]]]),
    new Map(),
  ), [movie])
})

test('fallback por título e ano só aceita correspondência única', () => {
  const key = 'clube da luta::1999'
  assert.deepEqual(moviesForPlexItem(
    { title: 'Clube da Luta', year: 1999 },
    new Map(),
    new Map(),
    new Map([[key, [movie]]]),
  ), [movie])

  assert.deepEqual(moviesForPlexItem(
    { title: 'Clube da Luta', year: 1999 },
    new Map(),
    new Map(),
    new Map([[key, [movie, { ...movie, id: 2 }]]]),
  ), [])
})
