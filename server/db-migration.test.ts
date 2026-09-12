import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readdirSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const dataDir = mkdtempSync(join(tmpdir(), 'shelf-legacy-db-'))
const backupDir = join(dataDir, 'backups')
process.env.DATA_DIR = dataDir
process.env.BACKUP_DIR = backupDir

const legacy = new Database(join(dataDir, 'shelf.db'))
legacy.exec(`
  CREATE TABLE media_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    cover_url TEXT,
    year INTEGER,
    genre TEXT,
    runtime INTEGER,
    rating REAL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'wishlist',
    notes TEXT,
    synopsis TEXT,
    creators TEXT,
    author TEXT,
    release_date TEXT,
    hype INTEGER DEFAULT 0,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    original_filename TEXT,
    UNIQUE(external_id, type)
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  CREATE TABLE lists (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE TABLE list_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    media_item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(list_id, media_item_id)
  );
  CREATE TABLE series_seasons (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    media_item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    season_number INTEGER NOT NULL,
    title TEXT,
    episode_count INTEGER NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'in_progress',
    completed_at TEXT,
    UNIQUE(media_item_id, season_number)
  );
  INSERT INTO media_items (external_id, type, title, status)
  VALUES ('legacy-1', 'movie', 'Filme preservado', 'completed');
  INSERT INTO media_items (external_id, type, title, status, updated_at)
  VALUES ('legacy-series', 'series', 'Série preservada', 'completed', '2026-08-10 20:00:00');
  INSERT INTO series_seasons (media_item_id, season_number, title, episode_count, status, completed_at)
  VALUES (2, 1, 'Temporada preservada', 8, 'completed', '2026-08-10 20:00:00');
  INSERT INTO lists (name) VALUES ('Lista preservada');
  INSERT INTO list_items (list_id, media_item_id) VALUES (1, 1);
`)
legacy.close()

test('adota banco sem versão, preserva dados e cria snapshot antes da migration', async () => {
  const { db } = await import('./db.js')

  const migrations = db.prepare(
    'SELECT version, name FROM schema_migrations ORDER BY version',
  ).all()
  assert.deepEqual(migrations, [
    { version: 1, name: 'baseline-schema' },
    { version: 2, name: 'media-domain-checks' },
    { version: 3, name: 'allow-music-media-type' },
    { version: 4, name: 'diary-progress-snapshots' },
    { version: 5, name: 'isolated-list-media' },
    { version: 6, name: 'season-ratings' },
  ])

  const item = db.prepare("SELECT title, status FROM media_items WHERE external_id = 'legacy-1'").get()
  assert.deepEqual(item, { title: 'Filme preservado', status: 'completed' })

  const mediaColumns = (db.prepare('PRAGMA table_info(media_items)').all() as { name: string }[]).map(c => c.name)
  assert.ok(mediaColumns.includes('game_status'))
  assert.ok(mediaColumns.includes('favorite'))
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'game_price_history'").get())
  assert.ok(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'diary_progress'").get())
  const diaryColumns = (db.prepare('PRAGMA table_info(diary_entries)').all() as { name: string }[]).map(c => c.name)
  assert.ok(diaryColumns.includes('progress_day'))
  assert.ok(diaryColumns.includes('progress_value'))
  assert.ok(diaryColumns.includes('progress_total'))
  assert.ok(diaryColumns.includes('progress_unit'))
  const seasonColumns = (db.prepare('PRAGMA table_info(series_seasons)').all() as { name: string }[]).map(c => c.name)
  assert.ok(seasonColumns.includes('rating'))
  assert.deepEqual(db.prepare(`
    SELECT d.season_number, d.episode_number, d.watched_at, d.source
      FROM diary_entries d
      JOIN media_items m ON m.id = d.media_item_id
     WHERE m.external_id = 'legacy-series' AND d.season_number = 1
  `).get(), {
    season_number: 1, episode_number: null, watched_at: '2026-08-10 20:00:00', source: 'backfill',
  })
  assert.deepEqual(db.prepare('SELECT list_id, media_item_id FROM list_items').all(), [{ list_id: 1, media_item_id: 1 }])
  assert.equal(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'list_only_items'").get() !== undefined, true)
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  assert.deepEqual(db.pragma('quick_check'), [{ quick_check: 'ok' }])

  assert.throws(() => db.prepare(
    "INSERT INTO media_items (external_id, type, title, status) VALUES ('bad-type', 'podcast', 'Episódio', 'wishlist')",
  ).run(), /CHECK constraint/)
  assert.doesNotThrow(() => db.prepare(
    "INSERT INTO media_items (external_id, type, title, status) VALUES ('music-1', 'music', 'Faixa', 'completed')",
  ).run())
  assert.throws(() => db.prepare(
    "INSERT INTO media_items (external_id, type, title, status) VALUES ('bad-status', 'movie', 'Filme', 'finished')",
  ).run(), /CHECK constraint/)
  assert.throws(() => db.prepare(
    "INSERT INTO media_items (external_id, type, title, status, game_status) VALUES ('bad-game', 'game', 'Jogo', 'completed', 'beaten')",
  ).run(), /CHECK constraint/)

  const snapshots = readdirSync(backupDir).filter(name => /^shelf-before-migration-.*\.db$/.test(name))
  assert.equal(snapshots.length, 1)
  db.close()
})
