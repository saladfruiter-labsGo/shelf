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
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    external_id TEXT    NOT NULL,
    type        TEXT    NOT NULL CHECK(type IN ('movie','series','game','book')),
    title       TEXT    NOT NULL,
    cover_url   TEXT,
    year        INTEGER,
    genre       TEXT,
    runtime     INTEGER,
    rating      REAL    DEFAULT 0,
    status      TEXT    NOT NULL DEFAULT 'wishlist' CHECK(status IN ('wishlist','in_progress','completed','dropped')),
    notes       TEXT,
    added_at    TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at  TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(external_id, type)
  );

  CREATE INDEX IF NOT EXISTS idx_media_type   ON media_items(type);
  CREATE INDEX IF NOT EXISTS idx_media_status ON media_items(status);
  CREATE INDEX IF NOT EXISTS idx_media_added  ON media_items(added_at);

  CREATE TABLE IF NOT EXISTS settings (
    key   TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
`)
