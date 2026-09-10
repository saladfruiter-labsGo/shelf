import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { readFile, readdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'
import { writeVerifiedDatabaseBackup } from '../database-backup.js'

test('snapshot é consistente, verificado e publicado sem arquivo temporário', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'shelf-backup-'))
  const source = new Database(join(dir, 'source.db'))
  source.exec('CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT); INSERT INTO notes (body) VALUES (\'antes\')')

  const info = await writeVerifiedDatabaseBackup(source, join(dir, 'copies'), 'manual', new Date('2026-09-10T01:02:03.000Z'))
  source.prepare('UPDATE notes SET body = ?').run('depois')
  source.close()

  const copy = new Database(info.path, { readonly: true })
  assert.equal((copy.prepare('SELECT body FROM notes').get() as { body: string }).body, 'antes')
  assert.deepEqual(copy.pragma('quick_check'), [{ quick_check: 'ok' }])
  copy.close()

  assert.match(info.filename, /^shelf-manual-2026-09-10T01-02-03-000Z-[a-f0-9]{6}\.db$/)
  assert.ok(info.size_bytes > 0)
  assert.deepEqual((await readdir(join(dir, 'copies'))).filter(name => name.endsWith('.tmp')), [])
  assert.ok((await readFile(info.path)).length > 0)
})
