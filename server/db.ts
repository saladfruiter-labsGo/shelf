import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const dataDir = process.env.DATA_DIR ?? './data'
fs.mkdirSync(dataDir, { recursive: true })

const dbPath = path.join(dataDir, 'shelf.db')
export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

db.exec(`
  CREATE TABLE IF NOT EXISTS media_items (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id  TEXT    NOT NULL,
    type         TEXT    NOT NULL,
    title        TEXT    NOT NULL,
    cover_url    TEXT,
    year         INTEGER,
    genre        TEXT,
    runtime      INTEGER,
    rating       REAL    DEFAULT 0,
    status       TEXT    NOT NULL DEFAULT 'wishlist',
    notes        TEXT,
    synopsis     TEXT,
    creators     TEXT,
    author       TEXT,
    release_date TEXT,
    hype         INTEGER DEFAULT 0,
    added_at     TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(external_id, type)
  );

  CREATE INDEX IF NOT EXISTS idx_media_type        ON media_items(type);
  CREATE INDEX IF NOT EXISTS idx_media_status      ON media_items(status);
  CREATE INDEX IF NOT EXISTS idx_media_added       ON media_items(added_at);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS lists (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    description TEXT,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE IF NOT EXISTS list_items (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id       INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    media_item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    added_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(list_id, media_item_id)
  );

  CREATE INDEX IF NOT EXISTS idx_list_items_list  ON list_items(list_id);
  CREATE INDEX IF NOT EXISTS idx_list_items_media ON list_items(media_item_id);
`)

// Migrations for existing databases
const cols = (db.prepare("PRAGMA table_info(media_items)").all() as { name: string }[]).map(c => c.name)
const newCols: [string, string][] = [
  ['synopsis',     'TEXT'],
  ['creators',     'TEXT'],
  ['author',       'TEXT'],
  ['release_date', 'TEXT'],
  ['hype',         'INTEGER DEFAULT 0'],
]
for (const [col, def] of newCols) {
  if (!cols.includes(col)) db.exec(`ALTER TABLE media_items ADD COLUMN ${col} ${def}`)
}

// Indexes that depend on migrated columns must be created after the ALTERs above
db.exec(`CREATE INDEX IF NOT EXISTS idx_media_release ON media_items(release_date)`)
