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
let playniteRoutes: typeof import('./integrations/playnite.js').default
let priceRoutes: typeof import('./integrations/prices.js').default
let steamRoutes: typeof import('./integrations/steam.js').default

before(async () => {
  db = (await import('../db.js')).db
  const config = await import('../integrations/config.js')
  cfg = config.cfg
  setCfg = config.setCfg
  ensureSecret = config.ensureSecret
  playniteRoutes = (await import('./integrations/playnite.js')).default
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

test('webhook repetido do Playnite não duplica conclusão, atividade ou diário', async () => {
  setCfg('PLAYNITE_ENABLED', '1')
  const secret = ensureSecret('PLAYNITE_WEBHOOK_SECRET')
  const payload = {
    gameId: 'game-1',
    name: 'Jogo idempotente',
    completionStatus: 'Completed',
    playtimeSeconds: 7_200,
    userScore: 80,
    lastPlayed: '2026-09-10T10:00:00.000Z',
  }
  const send = () => playniteRoutes.request(`/playnite/webhook?token=${secret}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  assert.equal((await send()).status, 200)
  assert.equal((await send()).status, 200)

  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM media_items WHERE external_id = 'playnite:game-1'").get() as { n: number }).n, 1)
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE source = 'playnite' AND event_type = 'played'").get() as { n: number }).n, 1)
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM diary_entries WHERE source = 'playnite'").get() as { n: number }).n, 1)
})
