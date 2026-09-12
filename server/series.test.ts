import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

const dataDir = mkdtempSync(join(tmpdir(), 'shelf-series-status-'))
process.env.DATA_DIR = dataDir

let db: Database.Database
let setEpisodeWatched: typeof import('./series.js').setEpisodeWatched
let applySeasonRating: typeof import('./series.js').applySeasonRating
let getUnratedCompletedSeasons: typeof import('./series.js').getUnratedCompletedSeasons
let seriesRoutes: typeof import('./routes/series.js').default

before(async () => {
  db = (await import('./db.js')).db
  const series = await import('./series.js')
  setEpisodeWatched = series.setEpisodeWatched
  applySeasonRating = series.applySeasonRating
  getUnratedCompletedSeasons = series.getUnratedCompletedSeasons
  seriesRoutes = (await import('./routes/series.js')).default
})

after(() => db.close())

function addSeries(externalId: string, episodeCount: number): number {
  const item = db.prepare(
    "INSERT INTO media_items (external_id, type, title, status) VALUES (?, 'series', ?, 'wishlist')",
  ).run(externalId, externalId)
  const id = Number(item.lastInsertRowid)
  db.prepare(
    'INSERT INTO series_seasons (media_item_id, season_number, episode_count) VALUES (?, 1, ?)',
  ).run(id, episodeCount)
  return id
}

function itemState(id: number) {
  return db.prepare('SELECT status, completed_at FROM media_items WHERE id = ?').get(id) as {
    status: string
    completed_at: string | null
  }
}

test('série só conclui quando todos os episódios conhecidos foram vistos', () => {
  const id = addSeries('serie-completa', 2)

  setEpisodeWatched(id, 1, 1, true, 'Piloto', '2026-01-01T00:00:00.000Z')
  assert.deepEqual(itemState(id), { status: 'in_progress', completed_at: null })
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM diary_entries WHERE media_item_id = ?').get(id) as { n: number }).n, 0)

  setEpisodeWatched(id, 1, 2, true, 'Final', '2026-01-02T00:00:00.000Z')
  assert.equal(itemState(id).status, 'completed')
  assert.ok(itemState(id).completed_at)
  assert.deepEqual(db.prepare(`
    SELECT watched_at, rating, source, season_number, episode_number
      FROM diary_entries WHERE media_item_id = ?
  `).get(id), {
    watched_at: '2026-01-02T00:00:00.000Z', rating: null, source: 'automatic',
    season_number: 1, episode_number: null,
  })

  // Retry do mesmo episódio não cria outra conclusão.
  setEpisodeWatched(id, 1, 2, true, 'Final', '2026-01-02T00:00:00.000Z')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM diary_entries WHERE media_item_id = ?').get(id) as { n: number }).n, 1)

  assert.equal(getUnratedCompletedSeasons().some(season => season.media_item_id === id), true)
  const rated = applySeasonRating(id, 1, 4.5)
  assert.ok(rated?.diary_entry_id)
  assert.equal((db.prepare('SELECT rating FROM series_seasons WHERE media_item_id = ?').get(id) as { rating: number }).rating, 4.5)
  assert.equal((db.prepare('SELECT rating FROM diary_entries WHERE media_item_id = ?').get(id) as { rating: number }).rating, 4.5)
  assert.equal((db.prepare('SELECT rating FROM media_items WHERE id = ?').get(id) as { rating: number }).rating, 0)
  assert.equal(getUnratedCompletedSeasons().some(season => season.media_item_id === id), false)

  setEpisodeWatched(id, 1, 2, false, 'Final')
  assert.deepEqual(itemState(id), { status: 'in_progress', completed_at: null })
})

test('episódio sem total autoritativo não conclui a série inteira', () => {
  const id = addSeries('serie-sem-total', 0)
  setEpisodeWatched(id, 1, 1, true, 'Episódio 1', '2026-02-01T00:00:00.000Z')
  assert.deepEqual(itemState(id), { status: 'in_progress', completed_at: null })
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM diary_entries WHERE media_item_id = ?').get(id) as { n: number }).n, 0)
})

test('API lista e avalia rapidamente uma temporada concluída', async () => {
  const id = addSeries('serie-fila-avaliacao', 1)
  setEpisodeWatched(id, 1, 1, true, 'Final', '2026-03-01T20:00:00.000Z')

  const pending = await seriesRoutes.request('/unrated')
  assert.equal(pending.status, 200)
  assert.equal(((await pending.json()) as { media_item_id: number }[]).some(season => season.media_item_id === id), true)

  const invalid = await seriesRoutes.request(`/${id}/season/1/rating`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating: 4.2 }),
  })
  assert.equal(invalid.status, 400)

  const rated = await seriesRoutes.request(`/${id}/season/1/rating`, {
    method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ rating: 5 }),
  })
  assert.equal(rated.status, 200)
  assert.equal((await rated.json() as { rating: number }).rating, 5)
  assert.equal(getUnratedCompletedSeasons().some(season => season.media_item_id === id), false)
})
