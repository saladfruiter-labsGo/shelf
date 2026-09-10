import type Database from 'better-sqlite3'

export interface Migration {
  version: number
  name: string
  up: () => void
}

export interface AppliedMigration {
  version: number
  name: string
  applied_at: string
}

const TABLE = 'schema_migrations'

export function hasMigrationTable(db: Database.Database): boolean {
  return Boolean(db.prepare(
    "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?",
  ).get(TABLE))
}

function validatePlan(migrations: Migration[]): void {
  let previous = 0
  for (const migration of migrations) {
    if (!Number.isInteger(migration.version) || migration.version <= 0) {
      throw new Error(`Versão de migration inválida: ${migration.version}`)
    }
    if (!migration.name.trim()) throw new Error(`Migration ${migration.version} sem nome`)
    if (migration.version <= previous) {
      throw new Error('As migrations devem estar em ordem crescente e sem versões duplicadas')
    }
    previous = migration.version
  }
}

export function appliedMigrations(db: Database.Database): AppliedMigration[] {
  if (!hasMigrationTable(db)) return []
  return db.prepare(
    `SELECT version, name, applied_at FROM ${TABLE} ORDER BY version`,
  ).all() as AppliedMigration[]
}

export function hasPendingMigrations(db: Database.Database, migrations: Migration[]): boolean {
  validatePlan(migrations)
  const appliedVersions = new Set(appliedMigrations(db).map(migration => migration.version))
  return migrations.some(migration => !appliedVersions.has(migration.version))
}

/** Executa cada migration uma vez, em transação própria, e registra sua versão. */
export function runMigrations(db: Database.Database, migrations: Migration[]): AppliedMigration[] {
  validatePlan(migrations)
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${TABLE} (
      version    INTEGER PRIMARY KEY,
      name       TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `)

  const known = new Map(migrations.map(migration => [migration.version, migration.name]))
  const applied = appliedMigrations(db)
  for (const migration of applied) {
    const expectedName = known.get(migration.version)
    if (!expectedName) {
      throw new Error(`O banco usa a migration ${migration.version}, desconhecida por esta versão do Shelf`)
    }
    if (expectedName !== migration.name) {
      throw new Error(`A migration ${migration.version} mudou de nome (${migration.name} != ${expectedName})`)
    }
  }

  const appliedVersions = new Set(applied.map(migration => migration.version))
  const record = db.prepare(`INSERT INTO ${TABLE} (version, name) VALUES (?, ?)`)

  for (const migration of migrations) {
    if (appliedVersions.has(migration.version)) continue
    db.transaction(() => {
      migration.up()
      record.run(migration.version, migration.name)
    })()
  }

  return appliedMigrations(db)
}
