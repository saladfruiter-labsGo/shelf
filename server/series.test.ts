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

before(async () => {
  db = (await import('./db.js')).db
  setEpisodeWatched = (await import('./series.js')).setEpisodeWatched
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

  setEpisodeWatched(id, 1, 2, true, 'Final', '2026-01-02T00:00:00.000Z')
  assert.equal(itemState(id).status, 'completed')
  assert.ok(itemState(id).completed_at)

  setEpisodeWatched(id, 1, 2, false, 'Final')
  assert.deepEqual(itemState(id), { status: 'in_progress', completed_at: null })
})

test('episódio sem total autoritativo não conclui a série inteira', () => {
  const id = addSeries('serie-sem-total', 0)
  setEpisodeWatched(id, 1, 1, true, 'Episódio 1', '2026-02-01T00:00:00.000Z')
  assert.deepEqual(itemState(id), { status: 'in_progress', completed_at: null })
})
