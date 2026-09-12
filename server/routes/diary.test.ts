import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-diary-routes-'))

let app: typeof import('./diary.js').default
let db: Database.Database
let seriesId: number

before(async () => {
  db = (await import('../db.js')).db
  app = (await import('./diary.js')).default
  seriesId = Number(db.prepare(`
    INSERT INTO media_items (external_id, type, title, status, rating)
    VALUES ('manual-season', 'series', 'Série manual', 'in_progress', 3)
  `).run().lastInsertRowid)
  db.prepare(`
    INSERT INTO series_seasons
      (media_item_id, season_number, title, episode_count, status, completed_at)
    VALUES (?, 2, 'Segundo ano', 8, 'completed', '2026-08-20')
  `).run(seriesId)
})

after(() => db.close())

test('registra e avalia manualmente uma temporada sem concluir a série inteira', async () => {
  const createdResponse = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      media_item_id: seriesId,
      season_number: 2,
      watched_at: '2026-08-21',
      rating: 4,
      comment: 'Ótima temporada',
    }),
  })
  assert.equal(createdResponse.status, 201)
  const created = await createdResponse.json() as { id: number; season_title: string; episode_number: null }
  assert.equal(created.season_title, 'Segundo ano')
  assert.equal(created.episode_number, null)

  assert.deepEqual(db.prepare('SELECT status, rating FROM media_items WHERE id = ?').get(seriesId), {
    status: 'in_progress', rating: 3,
  })
  assert.equal((db.prepare(`
    SELECT rating FROM series_seasons WHERE media_item_id = ? AND season_number = 2
  `).get(seriesId) as { rating: number }).rating, 4)

  const updatedResponse = await app.request(`/${created.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rating: 4.5 }),
  })
  assert.equal(updatedResponse.status, 200)
  assert.equal((db.prepare(`
    SELECT rating FROM series_seasons WHERE media_item_id = ? AND season_number = 2
  `).get(seriesId) as { rating: number }).rating, 4.5)

  const invalidRating = await app.request(`/${created.id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ rating: 4.2 }),
  })
  assert.equal(invalidRating.status, 400)

  const removedResponse = await app.request(`/${created.id}`, { method: 'DELETE' })
  assert.equal(removedResponse.status, 200)
  assert.equal((db.prepare(`
    SELECT rating FROM series_seasons WHERE media_item_id = ? AND season_number = 2
  `).get(seriesId) as { rating: number }).rating, 0)
})

test('rejeita temporada inexistente ou associada a outra mídia', async () => {
  const response = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ media_item_id: seriesId, season_number: 99, rating: 4 }),
  })
  assert.equal(response.status, 404)
})
