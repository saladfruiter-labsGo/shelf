import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { readdir, utimes } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const root = mkdtempSync(join(tmpdir(), 'shelf-retention-'))
const copies = join(root, 'backups')
process.env.DATA_DIR = join(root, 'data')
process.env.BACKUP_DIR = copies
process.env.BACKUP_RETENTION_DAYS = '2'
process.env.BACKUP_RETENTION_WEEKLY = '1'
process.env.BACKUP_RETENTION_SAFETY = '1'

let db: import('better-sqlite3').Database
let writeBackup: typeof import('../database-backup.js').writeVerifiedDatabaseBackup
let pruneBackups: typeof import('../backup.js').pruneBackups

before(async () => {
  db = (await import('../db.js')).db
  writeBackup = (await import('../database-backup.js')).writeVerifiedDatabaseBackup
  pruneBackups = (await import('../backup.js')).pruneBackups
})

async function snapshot(reason: import('../database-backup.js').BackupReason, at: string): Promise<string> {
  const date = new Date(at)
  const info = await writeBackup(db, copies, reason, date)
  await utimes(info.path, date, date)
  return info.filename
}

test('retenção preserva janela recente e a cópia de segurança mais nova de cada tipo', async () => {
  const keepRecent = await snapshot('automatic', '2026-09-09T00:00:00.000Z')
  const dropOldAutomatic = await snapshot('automatic', '2026-08-20T00:00:00.000Z')
  const keepManual = await snapshot('manual', '2026-09-01T00:00:00.000Z')
  const dropManual = await snapshot('manual', '2026-08-01T00:00:00.000Z')
  const keepImport = await snapshot('before-import', '2026-09-02T00:00:00.000Z')
  const dropImport = await snapshot('before-import', '2026-08-02T00:00:00.000Z')
  const keepMigration = await snapshot('before-migration', '2026-09-03T00:00:00.000Z')

  await pruneBackups(new Date('2026-09-10T00:00:00.000Z'))
  const names = new Set(await readdir(copies))

  for (const expected of [keepRecent, keepManual, keepImport, keepMigration]) assert.ok(names.has(expected))
  for (const removed of [dropOldAutomatic, dropManual, dropImport]) assert.equal(names.has(removed), false)
})
