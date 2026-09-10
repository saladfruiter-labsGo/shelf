import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

const dataDir = mkdtempSync(join(tmpdir(), 'shelf-wrap-'))
process.env.DATA_DIR = dataDir

let app: { request: (path: string, init?: RequestInit) => Promise<Response> }
let database: Database.Database

before(async () => {
  const db = (await import('../db.js')).db
  database = db
  app = (await import('./wrap.js')).default as any

  const addMedia = db.prepare(`
    INSERT INTO media_items (external_id, type, title, status, rating, runtime, genre, added_at)
    VALUES (?, ?, ?, 'completed', ?, ?, ?, '2026-09-10 00:00:00')
  `)
  const movie = addMedia.run('wrap-movie', 'movie', 'Filme do Wrap', 4, 120, 'Drama').lastInsertRowid
  const game = addMedia.run('wrap-game', 'game', 'Jogo do Wrap', 5, 90, 'Ação').lastInsertRowid

  const addDiary = db.prepare(
    "INSERT INTO diary_entries (media_item_id, watched_at, rating, source) VALUES (?, ?, ?, 'manual')",
  )
  // As mídias entram em setembro, mas o consumo real aconteceu em janeiro e março.
  addDiary.run(movie, '2026-01-10', 4)
  addDiary.run(movie, '2026-03-20', null)
  addDiary.run(game, '2026-03-02', 5)
})

after(() => database.close())

async function wrap(query: string) {
  const response = await app.request(`/?${query}`)
  assert.equal(response.status, 200)
  return response.json() as Promise<{
    total: number
    byType: { type: string; count: number }[]
    avgRating: { type: string; avg: number }[]
    activity: { period_key: string; count: number }[]
    totalRuntimeMinutes: number
  }>
}

test('Wrap usa as datas do diário e preserva todos os meses do gráfico', async () => {
  const data = await wrap('period=annual&year=2026')

  assert.equal(data.total, 2, 'o total conta mídias consumidas, não a data da importação')
  assert.deepEqual(data.byType.sort((a, b) => a.type.localeCompare(b.type)), [
    { type: 'movie', count: 1 },
    { type: 'game', count: 1 },
  ].sort((a, b) => a.type.localeCompare(b.type)))
  assert.deepEqual(data.avgRating.sort((a, b) => a.type.localeCompare(b.type)), [
    { type: 'movie', avg: 4 },
    { type: 'game', avg: 5 },
  ].sort((a, b) => a.type.localeCompare(b.type)))
  assert.equal(data.totalRuntimeMinutes, 210)
  assert.equal(data.activity.length, 12)
  assert.equal(data.activity[0].count, 1)
  assert.equal(data.activity[2].count, 2)
  assert.equal(data.activity[8].count, 0)
})

test('Wrap mensal usa dias do diário, inclusive os dias sem atividade', async () => {
  const data = await wrap('period=monthly&year=2026&month=3')

  assert.equal(data.activity.length, 31)
  assert.equal(data.activity[1].count, 1)
  assert.equal(data.activity[19].count, 1)
  assert.equal(data.activity[0].count, 0)
})
