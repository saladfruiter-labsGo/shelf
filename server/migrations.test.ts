import { test } from 'node:test'
import assert from 'node:assert/strict'
import Database from 'better-sqlite3'
import {
  appliedMigrations,
  hasMigrationTable,
  hasPendingMigrations,
  runMigrations,
  type Migration,
} from './migrations.js'

test('aplica migrations em ordem e não repete as já registradas', () => {
  const db = new Database(':memory:')
  let executions = 0
  const migrations: Migration[] = [
    { version: 1, name: 'create-notes', up: () => { executions++; db.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY)') } },
    { version: 2, name: 'add-body', up: () => { executions++; db.exec('ALTER TABLE notes ADD COLUMN body TEXT') } },
  ]

  assert.equal(hasPendingMigrations(db, migrations), true)
  assert.deepEqual(runMigrations(db, migrations).map(m => [m.version, m.name]), [
    [1, 'create-notes'], [2, 'add-body'],
  ])
  assert.equal(hasPendingMigrations(db, migrations), false)
  runMigrations(db, migrations)

  assert.equal(executions, 2)
  assert.deepEqual((db.prepare('PRAGMA table_info(notes)').all() as { name: string }[]).map(c => c.name), ['id', 'body'])
  db.close()
})

test('falha reverte o DDL e não registra a migration', () => {
  const db = new Database(':memory:')
  assert.throws(() => runMigrations(db, [{
    version: 1,
    name: 'broken',
    up: () => {
      db.exec('CREATE TABLE incomplete (id INTEGER)')
      throw new Error('falha simulada')
    },
  }]), /falha simulada/)

  assert.equal(hasMigrationTable(db), true)
  assert.deepEqual(appliedMigrations(db), [])
  assert.equal(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'incomplete'").get(), undefined)
  db.close()
})

test('recusa plano fora de ordem e banco criado por versão desconhecida', () => {
  const db = new Database(':memory:')
  assert.throws(() => runMigrations(db, [
    { version: 2, name: 'second', up: () => undefined },
    { version: 1, name: 'first', up: () => undefined },
  ]), /ordem crescente/)

  db.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    INSERT INTO schema_migrations (version, name) VALUES (99, 'future');
  `)
  assert.throws(() => runMigrations(db, [
    { version: 1, name: 'baseline', up: () => undefined },
  ]), /desconhecida/)
  db.close()
})
