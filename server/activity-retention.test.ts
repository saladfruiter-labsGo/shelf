import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

const dataDir = mkdtempSync(join(tmpdir(), 'shelf-activity-retention-'))
process.env.DATA_DIR = dataDir

let db: Database.Database
let pruneActivityPayloads: typeof import('./activity-retention.js').pruneActivityPayloads

before(async () => {
  db = (await import('./db.js')).db
  pruneActivityPayloads = (await import('./activity-retention.js')).pruneActivityPayloads
})

after(() => db.close())

test('remove apenas payload bruto antigo e preserva o histórico normalizado', () => {
  const insert = db.prepare(`
    INSERT INTO activity_events
      (source, event_type, media_type, external_ref, title, occurred_at, raw)
    VALUES ('plex', 'scrobble', 'movie', @ref, @title, @occurred_at, @raw)
  `)
  insert.run({ ref: 'old', title: 'Filme antigo', occurred_at: '2026-07-01T00:00:00.000Z', raw: '{"old":true}' })
  insert.run({ ref: 'recent', title: 'Filme recente', occurred_at: '2026-09-01T00:00:00.000Z', raw: '{"recent":true}' })
  db.prepare(`
    INSERT INTO music_tracks (artist, track, play_count, first_played, last_played)
    VALUES ('Artista', 'Faixa histórica', 10, '2020-01-01', '2020-01-01')
  `).run()

  assert.equal(pruneActivityPayloads(db, new Date('2026-09-10T00:00:00.000Z'), 30), 1)
  assert.deepEqual(db.prepare(`
    SELECT external_ref, title, occurred_at, raw FROM activity_events ORDER BY external_ref
  `).all(), [
    { external_ref: 'old', title: 'Filme antigo', occurred_at: '2026-07-01T00:00:00.000Z', raw: null },
    { external_ref: 'recent', title: 'Filme recente', occurred_at: '2026-09-01T00:00:00.000Z', raw: '{"recent":true}' },
  ])
  assert.equal((db.prepare('SELECT play_count FROM music_tracks').get() as { play_count: number }).play_count, 10)
  assert.equal(pruneActivityPayloads(db, new Date('2026-09-10T00:00:00.000Z'), 30), 0)
})
