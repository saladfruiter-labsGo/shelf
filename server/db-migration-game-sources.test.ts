import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const dataDir = mkdtempSync(join(tmpdir(), 'shelf-game-sources-'))
process.env.DATA_DIR = dataDir
process.env.BACKUP_DIR = join(dataDir, 'backups')

// Banco de antes da v9: games do Playnite, um jogo adicionado à mão e um da
// wishlist da Steam, todos com o domínio antigo de `game_status`.
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
    added_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    playtime_seconds INTEGER,
    game_status TEXT,
    library TEXT,
    UNIQUE(external_id, type)
  );
  CREATE TABLE settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  INSERT INTO media_items (external_id, type, title, status, game_status, playtime_seconds, library) VALUES
    ('rawg-1', 'game', 'Zerado no Playnite', 'completed', 'zerado', 36000, 'Steam'),
    ('rawg-2', 'game', 'Nunca aberto no Playnite', 'wishlist', 'nunca_jogado', NULL, 'Epic'),
    ('rawg-3', 'game', 'Quero comprar', 'wishlist', 'nunca_jogado', NULL, NULL),
    ('steam:4', 'game', 'Da wishlist da Steam', 'wishlist', 'nunca_jogado', NULL, 'Steam');
  INSERT INTO settings (key, value) VALUES ('PLAYNITE_STATE', '${JSON.stringify({
    'guid-1': { externalId: 'rawg-1', gameStatus: 'zerado', rating: 0, playtime: 36000 },
    'guid-2': { externalId: 'rawg-2', gameStatus: 'nunca_jogado', rating: 0, playtime: 0 },
  })}');
`)
legacy.close()

test('v9 separa backlog da wishlist e registra a procedência dos games', async () => {
  const { db } = await import('./db.js')

  const rows = db.prepare(
    "SELECT external_id, status, game_status, game_status_source, playtime_source FROM media_items WHERE type = 'game' ORDER BY external_id",
  ).all()
  assert.deepEqual(rows, [
    { external_id: 'rawg-1', status: 'completed', game_status: 'zerado', game_status_source: 'playnite', playtime_source: 'playnite' },
    // Jogo do Playnite sem jogar é jogo que você tem: vai para o backlog.
    { external_id: 'rawg-2', status: 'wishlist', game_status: 'backlog', game_status_source: 'playnite', playtime_source: null },
    // Wishlist manual e da Steam continuam sendo wishlist.
    { external_id: 'rawg-3', status: 'wishlist', game_status: 'nunca_jogado', game_status_source: null, playtime_source: null },
    { external_id: 'steam:4', status: 'wishlist', game_status: 'nunca_jogado', game_status_source: null, playtime_source: null },
  ])

  // Índices e FKs sobrevivem à reconstrução.
  const indexes = (db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'index' AND tbl_name = 'media_items' AND sql IS NOT NULL",
  ).all() as { name: string }[]).map(r => r.name)
  assert.ok(indexes.includes('idx_media_steam'))
  assert.ok(indexes.includes('idx_media_status'))
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  db.close()
})
