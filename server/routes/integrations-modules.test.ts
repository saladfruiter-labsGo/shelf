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
let kavitaRoutes: typeof import('./integrations/kavita.js').default
let pollKavita: typeof import('./integrations/kavita.js').pollKavita
let playniteRoutes: typeof import('./integrations/playnite.js').default
let priceRoutes: typeof import('./integrations/prices.js').default
let steamRoutes: typeof import('./integrations/steam.js').default

before(async () => {
  db = (await import('../db.js')).db
  const config = await import('../integrations/config.js')
  cfg = config.cfg
  setCfg = config.setCfg
  ensureSecret = config.ensureSecret
  const kavita = await import('./integrations/kavita.js')
  kavitaRoutes = kavita.default
  pollKavita = kavita.pollKavita
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

  const invalidCover = await kavitaRoutes.request('/kavita/image?seriesId=abc')
  assert.equal(invalidCover.status, 404)
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

test('poll repetido do Kavita preserva progresso sem duplicar conclusão', async () => {
  setCfg('KAVITA_ENABLED', '1')
  setCfg('KAVITA_URL', 'http://kavita.test')
  setCfg('KAVITA_API_KEY', 'secret')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/api/Plugin/authenticate')) {
      return new Response(JSON.stringify({ token: 'jwt' }), { status: 200 })
    }
    if (url.includes('/api/Series/all-v2')) {
      return new Response(JSON.stringify([{
        id: 42,
        name: 'Livro concluído',
        pages: 200,
        pagesRead: 200,
        userRating: 90,
        hasUserRated: true,
        latestReadDate: '2026-09-10T11:00:00.000Z',
        libraryId: 1,
      }]), { status: 200 })
    }
    if (url.includes('/api/Series/metadata')) {
      return new Response(JSON.stringify({ writers: [{ name: 'Autora' }] }), { status: 200 })
    }
    return new Response(null, { status: 404 })
  }

  try {
    await pollKavita()
    await pollKavita()
  } finally {
    globalThis.fetch = originalFetch
  }

  const book = db.prepare(`
    SELECT status, rating, pages_total, pages_read, author
    FROM media_items WHERE external_id = 'kavita:42'
  `).get()
  assert.deepEqual(book, {
    status: 'completed', rating: 4.5, pages_total: 200, pages_read: 200, author: 'Autora',
  })
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE source = 'kavita' AND event_type = 'read'").get() as { n: number }).n, 1)
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM diary_entries WHERE source = 'kavita'").get() as { n: number }).n, 1)
})
