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
  ['synopsis',      'TEXT'],
  ['creators',      'TEXT'],
  ['author',        'TEXT'],
  ['release_date',  'TEXT'],
  ['hype',          'INTEGER DEFAULT 0'],
  ['completed_at',  'TEXT'],
  ['tmdb_id',       'TEXT'],    // id TMDB resolvido (séries importadas do Plex têm guid como external_id)
  ['pages_total',   'INTEGER'], // livros (Kavita): total de páginas da série/volume
  ['pages_read',    'INTEGER'], // livros (Kavita): páginas lidas até o último poll
  ['playtime_seconds', 'INTEGER'], // games (Playnite): tempo total jogado, em segundos
  ['game_status',   'TEXT'],    // games (Playnite): status granular (jogando|zerado|platinado|abandonado|nunca_jogado)
  ['last_played_at','TEXT'],    // games (Playnite): última vez jogado (ISO), do LastActivity
  ['publisher',     'TEXT'],    // games (Playnite): distribuidora(s)
  ['library',       'TEXT'],    // games (Playnite): biblioteca/origem (Source: Steam, GOG, Epic...)
]
for (const [col, def] of newCols) {
  if (!cols.includes(col)) db.exec(`ALTER TABLE media_items ADD COLUMN ${col} ${def}`)
}

// Indexes that depend on migrated columns must be created after the ALTERs above
db.exec(`CREATE INDEX IF NOT EXISTS idx_media_release ON media_items(release_date)`)

// ─── Integrations: real-time activity log + music enrichment cache ───
db.exec(`
  CREATE TABLE IF NOT EXISTS activity_events (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    source       TEXT    NOT NULL,              -- 'plex' | 'lastfm'
    event_type   TEXT    NOT NULL,              -- 'scrobble' | 'rate' | 'listen' | 'play' | 'stop' ...
    media_type   TEXT    NOT NULL,              -- 'movie' | 'series' | 'music'
    external_ref TEXT,                          -- plex guid / 'artist|track'
    title        TEXT    NOT NULL,
    subtitle     TEXT,                           -- série / artista
    cover_url    TEXT,
    rating       REAL,                           -- só Plex (media.rate), 0–5
    duration_ms  INTEGER,                        -- música: duração da faixa
    genre        TEXT,
    occurred_at  TEXT    NOT NULL,               -- ISO 8601 (UTC)
    raw          TEXT,                           -- payload original (json)
    created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(source, external_ref, occurred_at)
  );

  CREATE INDEX IF NOT EXISTS idx_activity_occurred ON activity_events(occurred_at);
  CREATE INDEX IF NOT EXISTS idx_activity_source   ON activity_events(source);
  CREATE INDEX IF NOT EXISTS idx_activity_mtype    ON activity_events(media_type);

  CREATE TABLE IF NOT EXISTS music_tracks (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    artist       TEXT    NOT NULL,
    track        TEXT    NOT NULL,
    album        TEXT,
    duration_ms  INTEGER,                        -- via track.getInfo (cache)
    genre        TEXT,                            -- top tag do artista (cache)
    mbid         TEXT,
    cover_url    TEXT,
    play_count   INTEGER NOT NULL DEFAULT 0,
    first_played TEXT,
    last_played  TEXT,
    enriched     INTEGER NOT NULL DEFAULT 0,      -- 1 = já buscou duração/gênero
    UNIQUE(artist, track)
  );

  CREATE INDEX IF NOT EXISTS idx_music_last ON music_tracks(last_played);
`)

// ─── Séries: temporadas + episódios ───
db.exec(`
  CREATE TABLE IF NOT EXISTS series_seasons (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    media_item_id  INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    season_number  INTEGER NOT NULL,
    title          TEXT,
    episode_count  INTEGER NOT NULL DEFAULT 0,       -- total conhecido (TMDB)
    status         TEXT    NOT NULL DEFAULT 'in_progress',
    completed_at   TEXT,
    UNIQUE(media_item_id, season_number)
  );

  CREATE TABLE IF NOT EXISTS series_episodes (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    media_item_id  INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    season_number  INTEGER NOT NULL,
    episode_number INTEGER NOT NULL,
    title          TEXT,
    watched        INTEGER NOT NULL DEFAULT 0,
    watched_at     TEXT,
    UNIQUE(media_item_id, season_number, episode_number)
  );

  CREATE INDEX IF NOT EXISTS idx_seasons_media  ON series_seasons(media_item_id);
  CREATE INDEX IF NOT EXISTS idx_episodes_media ON series_episodes(media_item_id);
`)

// ─── Diário: registros de "visto/concluído" (N por mídia) ───
// Cada visualização (manual ou via Plex) vira uma entrada própria, com data,
// nota e comentário. A mesma mídia pode ter vários registros.
db.exec(`
  CREATE TABLE IF NOT EXISTS diary_entries (
    id            INTEGER PRIMARY KEY AUTOINCREMENT,
    media_item_id INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    watched_at    TEXT    NOT NULL DEFAULT (datetime('now')),   -- ISO date/datetime
    rating        REAL,                                          -- nota do registro (opcional)
    comment       TEXT,                                          -- comentário livre (opcional)
    source        TEXT    NOT NULL DEFAULT 'manual',             -- 'manual' | 'plex' | 'backfill'
    created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_diary_media   ON diary_entries(media_item_id);
  CREATE INDEX IF NOT EXISTS idx_diary_watched ON diary_entries(watched_at);
`)

// Migrations do diário: granularidade de episódio (séries).
// Um registro de série sempre aponta para um episódio (season_number + episode_number).
{
  const diaryCols = (db.prepare('PRAGMA table_info(diary_entries)').all() as { name: string }[]).map(c => c.name)
  for (const [col, def] of [['season_number', 'INTEGER'], ['episode_number', 'INTEGER']] as [string, string][]) {
    if (!diaryCols.includes(col)) db.exec(`ALTER TABLE diary_entries ADD COLUMN ${col} ${def}`)
  }
}

// Backfill único: cada item já concluído vira uma entrada no diário, para
// preservar o histórico que hoje aparece no Diário. Roda só uma vez.
const backfilled = (db.prepare("SELECT value FROM settings WHERE key = 'DIARY_BACKFILLED'").get() as { value: string } | undefined)?.value
if (backfilled !== '1') {
  db.prepare(`
    INSERT INTO diary_entries (media_item_id, watched_at, rating, comment, source)
    SELECT id,
           COALESCE(completed_at, updated_at, added_at),
           CASE WHEN rating > 0 THEN rating ELSE NULL END,
           NULL,
           'backfill'
    FROM media_items
    WHERE status = 'completed' OR completed_at IS NOT NULL
  `).run()
  db.prepare("INSERT INTO settings (key, value) VALUES ('DIARY_BACKFILLED', '1') ON CONFLICT(key) DO UPDATE SET value = '1'").run()
}

// ─── Preços de jogos (IsThereAnyDeal): produto casado + ofertas + histórico ───
// Valores monetários são sempre inteiros em centavos (nunca ponto flutuante).
db.exec(`
  CREATE TABLE IF NOT EXISTS game_price_products (
    id                INTEGER PRIMARY KEY AUTOINCREMENT,
    media_item_id     INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
    provider          TEXT    NOT NULL DEFAULT 'itad',
    provider_game_id  TEXT,                                  -- uuid do jogo no provedor
    platform          TEXT    NOT NULL DEFAULT 'pc',
    matched_title     TEXT,
    match_method      TEXT,                                   -- 'steam_id' | 'exact_title' | 'manual'
    match_status      TEXT    NOT NULL DEFAULT 'pending',     -- 'pending' | 'resolved' | 'ambiguous' | 'not_found'
    currency          TEXT,                                   -- moeda dominante das ofertas (BRL)
    history_low_minor INTEGER,                                -- menor histórico informado pelo provedor
    history_low_at    TEXT,
    last_resolved_at  TEXT,
    last_synced_at    TEXT,
    last_error        TEXT,
    created_at        TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at        TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(media_item_id, provider, platform)
  );

  CREATE INDEX IF NOT EXISTS idx_price_products_media  ON game_price_products(media_item_id);
  CREATE INDEX IF NOT EXISTS idx_price_products_status ON game_price_products(match_status);

  CREATE TABLE IF NOT EXISTS game_price_offers (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    game_price_product_id INTEGER NOT NULL REFERENCES game_price_products(id) ON DELETE CASCADE,
    shop_id               INTEGER NOT NULL,
    shop_name             TEXT    NOT NULL,
    price_minor           INTEGER NOT NULL,
    regular_minor         INTEGER NOT NULL,
    currency              TEXT    NOT NULL,
    discount_percent      INTEGER NOT NULL DEFAULT 0,
    url                   TEXT    NOT NULL,
    drm                   TEXT,
    voucher               TEXT,
    available             INTEGER NOT NULL DEFAULT 1,
    observed_at           TEXT    NOT NULL,
    last_seen_at          TEXT    NOT NULL,
    created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    updated_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    UNIQUE(game_price_product_id, shop_id)
  );

  CREATE INDEX IF NOT EXISTS idx_price_offers_product ON game_price_offers(game_price_product_id, available);

  CREATE TABLE IF NOT EXISTS game_price_history (
    id                    INTEGER PRIMARY KEY AUTOINCREMENT,
    game_price_product_id INTEGER NOT NULL REFERENCES game_price_products(id) ON DELETE CASCADE,
    shop_id               INTEGER NOT NULL,
    shop_name             TEXT    NOT NULL,
    price_minor           INTEGER NOT NULL,
    regular_minor         INTEGER NOT NULL,
    currency              TEXT    NOT NULL,
    discount_percent      INTEGER NOT NULL DEFAULT 0,
    observed_at           TEXT    NOT NULL,                   -- ISO 8601
    observed_day          TEXT    NOT NULL,                   -- YYYY-MM-DD (UTC) — dedup diário
    source                TEXT    NOT NULL,                   -- 'provider_import' | 'shelf_poll'
    created_at            TEXT    NOT NULL DEFAULT (datetime('now')),
    -- Um snapshot por dia/loja/preço: mudanças de preço no mesmo dia geram linhas
    -- novas, mas repetir a sincronização não duplica pontos equivalentes.
    UNIQUE(game_price_product_id, shop_id, observed_day, price_minor)
  );

  CREATE INDEX IF NOT EXISTS idx_price_hist_shop    ON game_price_history(game_price_product_id, shop_id, observed_at);
  CREATE INDEX IF NOT EXISTS idx_price_hist_product ON game_price_history(game_price_product_id, observed_at);
`)
