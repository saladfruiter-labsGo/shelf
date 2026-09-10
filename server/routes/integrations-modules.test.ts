import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

const dataDir = mkdtempSync(join(tmpdir(), 'shelf-integration-modules-'))
process.env.DATA_DIR = dataDir

let db: Database.Database
let cfg: typeof import('../integrations/config.js').cfg
let setCfg: typeof import('../integrations/config.js').setCfg
let ensureSecret: typeof import('../integrations/config.js').ensureSecret
let priceRoutes: typeof import('./integrations/prices.js').default
let steamRoutes: typeof import('./integrations/steam.js').default

before(async () => {
  db = (await import('../db.js')).db
  const config = await import('../integrations/config.js')
  cfg = config.cfg
  setCfg = config.setCfg
  ensureSecret = config.ensureSecret
  priceRoutes = (await import('./integrations/prices.js')).default
  steamRoutes = (await import('./integrations/steam.js')).default
})

after(() => db.close())

test('configuração persistida prevalece e segredo gerado é estável', () => {
  process.env.TEST_INTEGRATION_VALUE = 'ambiente'
  assert.equal(cfg('TEST_INTEGRATION_VALUE'), 'ambiente')

  setCfg('TEST_INTEGRATION_VALUE', 'banco')
  assert.equal(cfg('TEST_INTEGRATION_VALUE'), 'banco')
  setCfg('TEST_INTEGRATION_VALUE', '')
  assert.equal(cfg('TEST_INTEGRATION_VALUE'), 'ambiente')

  const first = ensureSecret('TEST_WEBHOOK_SECRET')
  assert.match(first, /^[a-f0-9]{32}$/)
  assert.equal(ensureSecret('TEST_WEBHOOK_SECRET'), first)
})

test('routers extraídos preservam os caminhos públicos', async () => {
  const resolved = await steamRoutes.request('/steam/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: '76561198000000000' }),
  })
  assert.equal(resolved.status, 200)
  assert.deepEqual(await resolved.json(), { ok: true, steam_id: '76561198000000000' })

  const missingPriceKey = await priceRoutes.request('/itad/test', { method: 'POST' })
  assert.equal(missingPriceKey.status, 400)
  assert.equal((await missingPriceKey.json() as { ok: boolean }).ok, false)
})
