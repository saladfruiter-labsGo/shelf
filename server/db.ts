import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'
import { writeVerifiedDatabaseBackup } from './database-backup.js'
import { hasPendingMigrations, runMigrations, type Migration } from './migrations.js'
import { ensureMediaItemsAllowsMusic, rebuildMediaItemsWithDomainChecks } from './media-schema.js'

export const dataDir = path.resolve(process.env.DATA_DIR ?? './data')
fs.mkdirSync(dataDir, { recursive: true })

export const dbPath = path.join(dataDir, 'shelf.db')
const databaseExisted = fs.existsSync(dbPath) && fs.statSync(dbPath).size > 0
export const db = new Database(dbPath)

db.pragma('journal_mode = WAL')
db.pragma('foreign_keys = ON')

/**
 * Detecta estruturas anteriores à versão-base para decidir se o startup precisa
 * proteger o banco antes do primeiro DDL. Falhar o backup impede a migration.
 */
function schemaNeedsUpgrade(): boolean {
  if (!databaseExisted) return false
  const tables = new Set(
    (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as { name: string }[]).map(r => r.name),
  )
  if (!tables.has('media_items')) return false

  const requiredTables = [
    'settings', 'lists', 'list_items', 'list_tiers', 'list_only_items', 'activity_events', 'music_tracks',
    'series_seasons', 'series_episodes', 'diary_entries', 'diary_progress', 'game_price_products',
    'game_price_offers', 'game_price_history',
  ]
  if (requiredTables.some(table => !tables.has(table))) return true

  const columns = (table: string) => new Set(
    (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map(r => r.name),
  )
  const media = columns('media_items')
  const requiredMedia = [
    'synopsis', 'creators', 'author', 'release_date', 'hype', 'completed_at', 'tmdb_id',
    'original_filename', 'pages_total', 'pages_read', 'playtime_seconds', 'game_status',
    'last_played_at', 'publisher', 'library', 'steam_appid', 'favorite',
  ]
  if (requiredMedia.some(column => !media.has(column))) return true

  const diary = columns('diary_entries')
  const seasons = columns('series_seasons')
  return !columns('lists').has('mode')
    || !columns('lists').has('dim_seen')
    || !columns('list_items').has('position')
    || !columns('list_items').has('tier_id')
    || !diary.has('season_number')
    || !diary.has('episode_number')
    || !diary.has('progress_day')
    || !diary.has('progress_value')
    || !diary.has('progress_total')
    || !diary.has('progress_unit')
    || !seasons.has('rating')
}

const migrations: Migration[] = [{
  version: 1,
  name: 'baseline-schema',
  up: () => {
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
    original_filename TEXT,
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
  ['original_filename', 'TEXT'], // nome do arquivo de origem, enviado pelo Plex
  ['pages_total',   'INTEGER'], // livros (Kavita): total de páginas da série/volume
  ['pages_read',    'INTEGER'], // livros (Kavita): páginas lidas até o último poll
  ['playtime_seconds', 'INTEGER'], // games (Playnite): tempo total jogado, em segundos
  ['game_status',   'TEXT'],    // games (Playnite): status granular (jogando|zerado|platinado|abandonado|nunca_jogado)
  ['last_played_at','TEXT'],    // games (Playnite): última vez jogado (ISO), do LastActivity
  ['publisher',     'TEXT'],    // games (Playnite): distribuidora(s)
  ['library',       'TEXT'],    // games (Playnite): biblioteca/origem (Source: Steam, GOG, Epic...)
  ['steam_appid',   'INTEGER'], // games: AppID na Steam — chave estável do conector bidirecional
  ['favorite',      'INTEGER DEFAULT 0'], // curadoria manual: entra no banner "Favoritos" da home
]
for (const [col, def] of newCols) {
  if (!cols.includes(col)) db.exec(`ALTER TABLE media_items ADD COLUMN ${col} ${def}`)
}

// Indexes that depend on migrated columns must be created after the ALTERs above
db.exec(`CREATE INDEX IF NOT EXISTS idx_media_release ON media_items(release_date)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_media_steam   ON media_items(steam_appid)`)
db.exec(`CREATE INDEX IF NOT EXISTS idx_media_fav     ON media_items(favorite)`)

// ─── Listas: modos (lista | ranking | tier), ordem manual e tiers ───
db.exec(`
  CREATE TABLE IF NOT EXISTS list_tiers (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    list_id  INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
    name     TEXT    NOT NULL,
    color    TEXT    NOT NULL DEFAULT 'accent',
    position INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS idx_list_tiers_list ON list_tiers(list_id);
`)

const listCols = (db.prepare('PRAGMA table_info(lists)').all() as { name: string }[]).map(c => c.name)
// 'list' | 'ranking' | 'tier' — como a lista é exibida e reordenada.
if (!listCols.includes('mode'))     db.exec("ALTER TABLE lists ADD COLUMN mode TEXT NOT NULL DEFAULT 'list'")
// Interruptor "esmaecer o que já consumi" (0/1), guardado por lista.
if (!listCols.includes('dim_seen')) db.exec('ALTER TABLE lists ADD COLUMN dim_seen INTEGER NOT NULL DEFAULT 0')

const listItemCols = (db.prepare('PRAGMA table_info(list_items)').all() as { name: string }[]).map(c => c.name)
if (!listItemCols.includes('position')) {
  db.exec('ALTER TABLE list_items ADD COLUMN position INTEGER NOT NULL DEFAULT 0')
  // Bases antigas não tinham ordem manual: a ordem de inclusão vira a posição inicial.
  db.exec(`
    UPDATE list_items SET position = (
      SELECT COUNT(*) FROM list_items x
      WHERE x.list_id = list_items.list_id
        AND (x.added_at < list_items.added_at
             OR (x.added_at = list_items.added_at AND x.id <= list_items.id))
    )
  `)
}
// NULL = item ainda fora dos tiers (fica na bandeja "sem tier").
if (!listItemCols.includes('tier_id')) {
  db.exec('ALTER TABLE list_items ADD COLUMN tier_id INTEGER REFERENCES list_tiers(id) ON DELETE SET NULL')
}

db.exec('CREATE INDEX IF NOT EXISTS idx_list_items_pos ON list_items(list_id, position)')

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
  },
}, {
  version: 2,
  name: 'media-domain-checks',
  foreignKeys: 'off',
  up: () => rebuildMediaItemsWithDomainChecks(db),
}, {
  version: 3,
  name: 'allow-music-media-type',
  foreignKeys: 'off',
  up: () => ensureMediaItemsAllowsMusic(db),
}, {
  version: 4,
  name: 'diary-progress-snapshots',
  up: () => {
    const diaryCols = (db.prepare('PRAGMA table_info(diary_entries)').all() as { name: string }[]).map(c => c.name)
    const newDiaryCols: [string, string][] = [
      ['progress_day', 'TEXT'],
      ['progress_value', 'INTEGER'],
      ['progress_total', 'INTEGER'],
      ['progress_unit', 'TEXT'],
    ]
    for (const [col, def] of newDiaryCols) {
      if (!diaryCols.includes(col)) db.exec(`ALTER TABLE diary_entries ADD COLUMN ${col} ${def}`)
    }

    db.exec(`
      CREATE TABLE IF NOT EXISTS diary_progress (
        media_item_id  INTEGER NOT NULL REFERENCES media_items(id) ON DELETE CASCADE,
        source         TEXT NOT NULL,                 -- 'kavita' | 'playnite'
        progress_day   TEXT NOT NULL,                 -- dia civil em SHELF_TIMEZONE
        progress_value INTEGER NOT NULL CHECK (progress_value >= 0),
        progress_total INTEGER CHECK (progress_total IS NULL OR progress_total >= 0),
        progress_unit  TEXT NOT NULL CHECK (progress_unit IN ('pages', 'seconds')),
        rating         REAL,
        observed_at    TEXT NOT NULL,                 -- última atualização do provedor no dia
        finalized_at   TEXT,                          -- preenchido quando vira diário
        created_at     TEXT NOT NULL DEFAULT (datetime('now')),
        UNIQUE(media_item_id, source, progress_day)
      );

      CREATE INDEX IF NOT EXISTS idx_diary_progress_pending
        ON diary_progress(progress_day, finalized_at);
    `)
  },
}, {
  version: 5,
  name: 'isolated-list-media',
  up: () => {
    // Resultados pesquisados dentro de uma lista não são mídia da biblioteca:
    // guardamos um snapshot local da obra, pertencente somente àquela lista.
    db.exec(`
      CREATE TABLE IF NOT EXISTS list_only_items (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        list_id      INTEGER NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
        external_id  TEXT    NOT NULL,
        type         TEXT    NOT NULL CHECK (type IN ('movie', 'series', 'game', 'book', 'music')),
        title        TEXT    NOT NULL,
        cover_url    TEXT,
        year         INTEGER,
        genre        TEXT,
        author       TEXT,
        release_date TEXT,
        position     INTEGER NOT NULL DEFAULT 0,
        tier_id      INTEGER REFERENCES list_tiers(id) ON DELETE SET NULL,
        added_at     TEXT    NOT NULL DEFAULT (datetime('now')),
        UNIQUE(list_id, external_id, type)
      );

      CREATE INDEX IF NOT EXISTS idx_list_only_list ON list_only_items(list_id, position);
    `)
  },
}, {
  version: 6,
  name: 'season-ratings',
  up: () => {
    const seasonCols = (db.prepare('PRAGMA table_info(series_seasons)').all() as { name: string }[]).map(c => c.name)
    if (!seasonCols.includes('rating')) {
      db.exec('ALTER TABLE series_seasons ADD COLUMN rating REAL NOT NULL DEFAULT 0')
    }

    // Aproveita eventuais registros manuais de temporada que já existam e
    // materializa no diário as temporadas históricas concluídas sem uma linha própria.
    db.exec(`
      UPDATE series_seasons
         SET rating = COALESCE((
           SELECT d.rating
             FROM diary_entries d
            WHERE d.media_item_id = series_seasons.media_item_id
              AND d.season_number = series_seasons.season_number
              AND d.episode_number IS NULL
              AND d.rating > 0
            ORDER BY d.watched_at DESC, d.id DESC
            LIMIT 1
         ), rating, 0);

      INSERT INTO diary_entries
        (media_item_id, watched_at, rating, comment, source, season_number, episode_number)
      SELECT s.media_item_id,
             COALESCE(s.completed_at, m.completed_at, m.updated_at),
             CASE WHEN s.rating > 0 THEN s.rating ELSE NULL END,
             NULL,
             'backfill',
             s.season_number,
             NULL
        FROM series_seasons s
        JOIN media_items m ON m.id = s.media_item_id
       WHERE s.status = 'completed'
         AND NOT EXISTS (
           SELECT 1 FROM diary_entries d
            WHERE d.media_item_id = s.media_item_id
              AND d.season_number = s.season_number
              AND d.episode_number IS NULL
         );

      CREATE INDEX IF NOT EXISTS idx_diary_season
        ON diary_entries(media_item_id, season_number, episode_number, watched_at);
    `)
  },
}, {
  version: 7,
  name: 'episode-diary-entries',
  up: () => {
    // O webhook do Plex gravava o episódio como um comentário ("T1E4 – Título")
    // numa entrada da série inteira. Promove esses registros a entradas de
    // episódio de verdade: temporada e episódio vão para suas colunas e o
    // comentário volta a ser um campo do usuário.
    const legacy = db.prepare(`
      SELECT id, media_item_id, comment FROM diary_entries
       WHERE source = 'plex' AND season_number IS NULL AND episode_number IS NULL
         AND comment IS NOT NULL
    `).all() as { id: number; media_item_id: number; comment: string }[]

    const promote = db.prepare(`
      UPDATE diary_entries SET season_number = ?, episode_number = ?, comment = NULL WHERE id = ?
    `)
    // O título vinha no comentário; ele passa a morar na estrutura da série,
    // que é de onde o diário o lê agora.
    const keepEpisodeTitle = db.prepare(`
      INSERT INTO series_episodes (media_item_id, season_number, episode_number, title, watched, watched_at)
      VALUES (@media_item_id, @season_number, @episode_number, @title, 1, @watched_at)
      ON CONFLICT(media_item_id, season_number, episode_number) DO UPDATE SET
        title = COALESCE(series_episodes.title, excluded.title)
    `)
    const ensureSeason = db.prepare(`
      INSERT INTO series_seasons (media_item_id, season_number) VALUES (?, ?)
      ON CONFLICT(media_item_id, season_number) DO NOTHING
    `)
    const drop = db.prepare('DELETE FROM diary_entries WHERE id = ?')
    const duplicate = db.prepare(`
      SELECT 1 FROM diary_entries
       WHERE media_item_id = @media_item_id AND watched_at = @watched_at AND source = 'plex'
         AND season_number = @season_number AND episode_number = @episode_number
         AND id <> @id
       LIMIT 1
    `)
    const readEntry = db.prepare('SELECT watched_at FROM diary_entries WHERE id = ?')

    db.transaction(() => {
      for (const row of legacy) {
        const match = /^T(\d+)E(\d+)(?:\s+[–-]\s+(.+))?$/.exec(row.comment.trim())
        if (!match) continue
        const season = Number(match[1])
        const episode = Number(match[2])
        const episodeTitle = match[3]?.trim() || null
        const { watched_at } = readEntry.get(row.id) as { watched_at: string }
        const args = {
          id: row.id, media_item_id: row.media_item_id, watched_at,
          season_number: season, episode_number: episode,
        }
        // Uma reentrega do webhook já pode ter criado a linha correta.
        if (duplicate.get(args)) { drop.run(row.id); continue }
        promote.run(season, episode, row.id)
        if (episodeTitle) {
          ensureSeason.run(row.media_item_id, season)
          keepEpisodeTitle.run({
            media_item_id: row.media_item_id, season_number: season,
            episode_number: episode, title: episodeTitle, watched_at,
          })
        }
      }
    })()
  },
}]

if (databaseExisted && (hasPendingMigrations(db, migrations) || schemaNeedsUpgrade())) {
  const destination = path.resolve(process.env.BACKUP_DIR ?? path.join(dataDir, 'backups'))
  try {
    const backup = await writeVerifiedDatabaseBackup(db, destination, 'before-migration')
    console.log(`[backup] snapshot antes da migration: ${backup.filename}`)
  } catch (error) {
    db.close()
    throw new Error(`Não foi possível proteger o banco antes da migration: ${(error as Error).message}`)
  }
}

runMigrations(db, migrations)
