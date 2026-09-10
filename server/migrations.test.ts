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

test('reconstrói tabela referenciada e restaura foreign_keys', () => {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  db.exec(`
    CREATE TABLE parent (id INTEGER PRIMARY KEY, status TEXT NOT NULL);
    CREATE TABLE child (id INTEGER PRIMARY KEY, parent_id INTEGER NOT NULL REFERENCES parent(id));
    INSERT INTO parent VALUES (1, 'valid');
    INSERT INTO child VALUES (1, 1);
  `)

  runMigrations(db, [{
    version: 1,
    name: 'rebuild-parent',
    foreignKeys: 'off',
    up: () => db.exec(`
      CREATE TABLE parent_next (id INTEGER PRIMARY KEY, status TEXT NOT NULL CHECK (status = 'valid'));
      INSERT INTO parent_next SELECT * FROM parent;
      DROP TABLE parent;
      ALTER TABLE parent_next RENAME TO parent;
    `),
  }])

  assert.equal(db.pragma('foreign_keys', { simple: true }), 1)
  assert.deepEqual(db.pragma('foreign_key_check'), [])
  assert.deepEqual(db.prepare('SELECT * FROM child').all(), [{ id: 1, parent_id: 1 }])
  assert.throws(() => db.prepare("INSERT INTO parent VALUES (2, 'invalid')").run(), /CHECK constraint/)
  db.close()
})
