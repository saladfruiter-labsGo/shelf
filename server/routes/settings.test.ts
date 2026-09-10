import { before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-settings-'))

let app: typeof import('./settings.js').default
let db: import('better-sqlite3').Database

before(async () => {
  db = (await import('../db.js')).db
  app = (await import('./settings.js')).default
})

test('GET informa estado mascarado sem devolver a chave salva', async () => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('TMDB_API_KEY', 'abcd-segredo-1234')").run()
  const response = await app.request('/')
  const text = await response.text()
  const body = JSON.parse(text)

  assert.equal(text.includes('abcd-segredo-1234'), false)
  assert.deepEqual(body.TMDB_API_KEY, { set: true, masked: 'abcd••••1234' })
  assert.deepEqual(body.RAWG_API_KEY, { set: false, masked: '' })
})

test('PATCH só troca valor explícito e suporta remoção explícita', async () => {
  await app.request('/', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ RAWG_API_KEY: 'nova-chave-rawg' }),
  })
  assert.equal((db.prepare("SELECT value FROM settings WHERE key = 'RAWG_API_KEY'").get() as any).value, 'nova-chave-rawg')
  assert.equal((db.prepare("SELECT value FROM settings WHERE key = 'TMDB_API_KEY'").get() as any).value, 'abcd-segredo-1234')

  await app.request('/', {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ TMDB_API_KEY_clear: true }),
  })
  assert.equal(db.prepare("SELECT 1 FROM settings WHERE key = 'TMDB_API_KEY'").get(), undefined)
})
