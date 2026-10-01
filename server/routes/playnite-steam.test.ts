/**
 * Convivência Playnite + Steam durante a migração (ST-02): com o tempo de jogo
 * vindo da Steam, o webhook do Playnite não o sobrescreve, não grava progresso
 * duplicado no diário e reaproveita o card criado pela leitura da Steam.
 */
import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-playnite-steam-'))

let database: Database.Database
let app: { request: (path: string, init?: RequestInit) => Promise<Response> }
const realFetch = globalThis.fetch

before(async () => {
  database = (await import('../db.js')).db
  const { setCfg } = await import('../integrations/config.js')
  setCfg('PLAYNITE_ENABLED', '1')
  setCfg('PLAYNITE_WEBHOOK_SECRET', 'segredo')
  // Sem RAWG: o Playnite não pode achar outro card por fora.
  globalThis.fetch = (async () => new Response('{}', { status: 500 })) as unknown as typeof fetch
  app = (await import('./integrations/playnite.js')).default as any

  database.prepare(`
    INSERT INTO media_items (external_id, type, title, status, game_status, game_status_source,
      playtime_seconds, playtime_source, last_played_at, library, steam_appid)
    VALUES ('steam:1145360', 'game', 'Hades', 'in_progress', 'jogando', 'steam', 79200, 'steam', '2026-09-30T22:00:00.000Z', 'Steam', 1145360)
  `).run()
})

after(() => {
  globalThis.fetch = realFetch
  database.close()
})

test('webhook do Playnite reaproveita o card da Steam e não sobrescreve o tempo dela', async () => {
  const res = await app.request('/playnite/webhook?token=segredo', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      gameId: 'guid-hades', name: 'Hades', playtimeSeconds: 600, completionStatus: 'Playing',
      lastPlayed: '2026-08-01T20:00:00.000Z', library: 'Steam',
    }),
  })
  assert.equal(res.status, 200)

  const rows = database.prepare("SELECT external_id, playtime_seconds, playtime_source, last_played_at FROM media_items WHERE type = 'game'").all()
  assert.deepEqual(rows, [{
    external_id: 'steam:1145360', playtime_seconds: 79200, playtime_source: 'steam', last_played_at: '2026-09-30T22:00:00.000Z',
  }])
  assert.equal((database.prepare("SELECT COUNT(*) AS n FROM diary_progress WHERE source = 'playnite'").get() as { n: number }).n, 0)
})
