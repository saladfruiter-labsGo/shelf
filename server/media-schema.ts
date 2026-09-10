import type Database from 'better-sqlite3'

interface InvalidMediaRow {
  id: number
  type: string
  status: string
  game_status: string | null
}

/**
 * Migration histórica v2. Os valores ficam literais de propósito: migrations já
 * publicadas não devem mudar quando o domínio ganhar novos valores no futuro.
 */
export function rebuildMediaItemsWithDomainChecks(db: Database.Database): void {
  const invalid = db.prepare(`
    SELECT id, type, status, game_status
    FROM media_items
    WHERE type NOT IN ('movie', 'series', 'game', 'book')
       OR status NOT IN ('wishlist', 'in_progress', 'completed', 'dropped')
       OR (game_status IS NOT NULL AND game_status NOT IN
           ('jogando', 'zerado', 'platinado', 'abandonado', 'nunca_jogado'))
    ORDER BY id
    LIMIT 10
  `).all() as InvalidMediaRow[]
  if (invalid.length > 0) {
    const details = invalid.map(row =>
      `#${row.id} type=${JSON.stringify(row.type)} status=${JSON.stringify(row.status)} game_status=${JSON.stringify(row.game_status)}`,
    ).join('; ')
    throw new Error(`media_items contém valores fora do domínio: ${details}`)
  }

  db.exec(`
    CREATE TABLE media_items_next (
      id                INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id       TEXT    NOT NULL,
      type              TEXT    NOT NULL CHECK (type IN ('movie', 'series', 'game', 'book')),
      title             TEXT    NOT NULL,
      cover_url         TEXT,
      year              INTEGER,
      genre             TEXT,
      runtime           INTEGER,
      rating            REAL    DEFAULT 0,
      status            TEXT    NOT NULL DEFAULT 'wishlist'
                                CHECK (status IN ('wishlist', 'in_progress', 'completed', 'dropped')),
      notes             TEXT,
      synopsis          TEXT,
      creators          TEXT,
      author            TEXT,
      release_date      TEXT,
      hype              INTEGER DEFAULT 0,
      added_at          TEXT    NOT NULL DEFAULT (datetime('now')),
      updated_at        TEXT    NOT NULL DEFAULT (datetime('now')),
      original_filename TEXT,
      completed_at      TEXT,
      tmdb_id           TEXT,
      pages_total       INTEGER,
      pages_read        INTEGER,
      playtime_seconds  INTEGER,
      game_status       TEXT CHECK (
        game_status IS NULL OR game_status IN
          ('jogando', 'zerado', 'platinado', 'abandonado', 'nunca_jogado')
      ),
      last_played_at    TEXT,
      publisher         TEXT,
      library           TEXT,
      steam_appid       INTEGER,
      favorite          INTEGER DEFAULT 0,
      UNIQUE(external_id, type)
    );

    INSERT INTO media_items_next (
      id, external_id, type, title, cover_url, year, genre, runtime, rating, status,
      notes, synopsis, creators, author, release_date, hype, added_at, updated_at,
      original_filename, completed_at, tmdb_id, pages_total, pages_read, playtime_seconds,
      game_status, last_played_at, publisher, library, steam_appid, favorite
    )
    SELECT
      id, external_id, type, title, cover_url, year, genre, runtime, rating, status,
      notes, synopsis, creators, author, release_date, hype, added_at, updated_at,
      original_filename, completed_at, tmdb_id, pages_total, pages_read, playtime_seconds,
      game_status, last_played_at, publisher, library, steam_appid, favorite
    FROM media_items;

    DROP TABLE media_items;
    ALTER TABLE media_items_next RENAME TO media_items;

    CREATE INDEX idx_media_type    ON media_items(type);
    CREATE INDEX idx_media_status  ON media_items(status);
    CREATE INDEX idx_media_added   ON media_items(added_at);
    CREATE INDEX idx_media_release ON media_items(release_date);
    CREATE INDEX idx_media_steam   ON media_items(steam_appid);
    CREATE INDEX idx_media_fav     ON media_items(favorite);
  `)
}
