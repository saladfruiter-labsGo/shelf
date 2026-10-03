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
