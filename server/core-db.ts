/**
 * Banco "núcleo" da instância: contas, sessões, chaves de API da instância e
 * tudo o que é compartilhado entre pessoas (feed, comentários, mensagens).
 *
 * Os dados pessoais de cada um — biblioteca, diário, listas, integrações —
 * moram num SQLite próprio por usuário (ver `db.ts`). O isolamento é físico:
 * uma consulta esquecida sem filtro nunca enxerga a biblioteca de outra pessoa.
 */
import Database from 'better-sqlite3'
import fs from 'node:fs'
import path from 'node:path'
import { runMigrations, type Migration } from './migrations.js'

export const dataDir = path.resolve(process.env.DATA_DIR ?? './data')
fs.mkdirSync(dataDir, { recursive: true })

export const coreDbPath = path.join(dataDir, 'core.db')
export const coreDbExisted = fs.existsSync(coreDbPath) && fs.statSync(coreDbPath).size > 0
export const coreDb = new Database(coreDbPath)

coreDb.pragma('journal_mode = WAL')
coreDb.pragma('foreign_keys = ON')
coreDb.pragma('busy_timeout = 5000')

export const coreMigrations: Migration[] = [{
  version: 1,
  name: 'accounts',
  up: () => {
    coreDb.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id                   INTEGER PRIMARY KEY AUTOINCREMENT,
        username             TEXT    NOT NULL UNIQUE COLLATE NOCASE,
        display_name         TEXT    NOT NULL,
        password_hash        TEXT    NOT NULL,
        role                 TEXT    NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member')),
        status               TEXT    NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
        must_change_password INTEGER NOT NULL DEFAULT 1,
        db_file              TEXT    NOT NULL UNIQUE,
        avatar_file          TEXT,
        bio                  TEXT,
        created_by           INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at           TEXT    NOT NULL DEFAULT (datetime('now')),
        updated_at           TEXT    NOT NULL DEFAULT (datetime('now')),
        password_changed_at  TEXT,
        last_seen_at         TEXT
      );

      -- Só o hash do token fica no banco: um vazamento do arquivo não abre sessões.
      CREATE TABLE IF NOT EXISTS sessions (
        id           INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash   TEXT    NOT NULL UNIQUE,
        user_agent   TEXT,
        created_at   TEXT    NOT NULL DEFAULT (datetime('now')),
        last_seen_at TEXT    NOT NULL DEFAULT (datetime('now')),
        expires_at   TEXT    NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

      -- Chaves de metadados usadas por todo mundo (TMDB, RAWG, IGDB...).
      CREATE TABLE IF NOT EXISTS instance_settings (
        key   TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audit_log (
        id             INTEGER PRIMARY KEY AUTOINCREMENT,
        actor_user_id  INTEGER REFERENCES users(id) ON DELETE SET NULL,
        action         TEXT    NOT NULL,
        target_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        detail         TEXT,
        created_at     TEXT    NOT NULL DEFAULT (datetime('now'))
      );
    `)
  },
}, {
  version: 2,
  name: 'social',
  up: () => {
    coreDb.exec(`
      -- Tudo o que aparece no feed: posts escritos, registros do diário,
      -- conquistas (uma entrada por jogo e dia) e listas compartilhadas.
      -- media_json/data_json guardam um retrato do que foi compartilhado,
      -- para o feed não depender do banco pessoal de quem postou.
      CREATE TABLE IF NOT EXISTS feed_posts (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        author_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind        TEXT    NOT NULL CHECK (kind IN ('post', 'diary', 'achievements', 'list')),
        body        TEXT,
        media_json  TEXT,
        data_json   TEXT,
        refs_json   TEXT,
        mentions_json TEXT,
        source_key  TEXT    UNIQUE,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      );
      CREATE INDEX IF NOT EXISTS idx_feed_created ON feed_posts(created_at DESC, id DESC);
      CREATE INDEX IF NOT EXISTS idx_feed_author  ON feed_posts(author_id, created_at DESC, id DESC);

      CREATE TABLE IF NOT EXISTS feed_images (
        id       INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id  INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
        file     TEXT    NOT NULL UNIQUE,
        width    INTEGER NOT NULL,
        height   INTEGER NOT NULL,
        position INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_feed_images_post ON feed_images(post_id, position);

      -- Um nível de resposta: a resposta de uma resposta vai para o mesmo fio.
      CREATE TABLE IF NOT EXISTS feed_comments (
        id            INTEGER PRIMARY KEY AUTOINCREMENT,
        post_id       INTEGER NOT NULL REFERENCES feed_posts(id) ON DELETE CASCADE,
        author_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        parent_id     INTEGER REFERENCES feed_comments(id) ON DELETE CASCADE,
        body          TEXT    NOT NULL,
        refs_json     TEXT,
        mentions_json TEXT,
        created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        deleted_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_feed_comments_post ON feed_comments(post_id, created_at, id);

      CREATE TABLE IF NOT EXISTS feed_reactions (
        target_type TEXT    NOT NULL CHECK (target_type IN ('post', 'comment')),
        target_id   INTEGER NOT NULL,
        user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        emoji       TEXT    NOT NULL,
        created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        PRIMARY KEY (target_type, target_id, user_id, emoji)
      );
      CREATE INDEX IF NOT EXISTS idx_feed_reactions_target ON feed_reactions(target_type, target_id);

      CREATE TABLE IF NOT EXISTS notifications (
        id         INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        actor_id   INTEGER REFERENCES users(id) ON DELETE CASCADE,
        type       TEXT    NOT NULL,
        post_id    INTEGER REFERENCES feed_posts(id) ON DELETE CASCADE,
        comment_id INTEGER REFERENCES feed_comments(id) ON DELETE CASCADE,
        detail     TEXT,
        created_at TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        read_at    TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read_at, id DESC);
    `)
  },
}, {
  version: 3,
  name: 'direct-messages',
  up: () => {
    coreDb.exec(`
      -- Conversa a dois; o par é guardado sempre na mesma ordem (menor id primeiro).
      CREATE TABLE IF NOT EXISTS dm_conversations (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        user_a          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        user_b          INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        last_message_at TEXT,
        CHECK (user_a < user_b),
        UNIQUE (user_a, user_b)
      );

      -- media_json: retrato do item da biblioteca compartilhado (com a nota de quem mandou).
      CREATE TABLE IF NOT EXISTS dm_messages (
        id              INTEGER PRIMARY KEY AUTOINCREMENT,
        conversation_id INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
        sender_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        body            TEXT,
        media_json      TEXT,
        refs_json       TEXT,
        created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
        deleted_at      TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_dm_messages_conv ON dm_messages(conversation_id, id);

      CREATE TABLE IF NOT EXISTS dm_reads (
        conversation_id      INTEGER NOT NULL REFERENCES dm_conversations(id) ON DELETE CASCADE,
        user_id              INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        last_read_message_id INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (conversation_id, user_id)
      );
    `)
  },
}]

runMigrations(coreDb, coreMigrations)

/**
 * Statements do núcleo, compilados uma vez por SQL. Além de poupar trabalho,
 * evita que statements descartados sejam coletados pelo GC — o better-sqlite3
 * 11 aborta o processo ao destruí-los no Node 24/Windows.
 */
const coreStatements = new Map<string, Database.Statement>()
export function core(sql: string): Database.Statement {
  let statement = coreStatements.get(sql)
  if (!statement) {
    statement = coreDb.prepare(sql)
    coreStatements.set(sql, statement)
  }
  return statement
}
