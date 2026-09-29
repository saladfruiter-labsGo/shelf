import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-quick-rating-'))

let db: Database.Database
let applyQuickRating: typeof import('./quick-rating.js').applyQuickRating
let isQuickRating: typeof import('./quick-rating.js').isQuickRating

before(async () => {
  db = (await import('./db.js')).db
  const quickRating = await import('./quick-rating.js')
  applyQuickRating = quickRating.applyQuickRating
  isQuickRating = quickRating.isQuickRating
})

after(() => db.close())

test('aceita apenas notas de meia em meia estrela', () => {
  assert.equal(isQuickRating(0), false)
  assert.equal(isQuickRating(0.5), true)
  assert.equal(isQuickRating(4.5), true)
  assert.equal(isQuickRating(4.2), false)
  assert.equal(isQuickRating(5.5), false)
})

test('avalia a mídia e a conclusão sem nota mais recente', () => {
  const mediaId = Number(db.prepare(`
    INSERT INTO media_items (external_id, type, title, status, rating, completed_at)
    VALUES ('quick-rating', 'game', 'Jogo concluído', 'completed', 0, '2026-09-10')
  `).run().lastInsertRowid)
  const insertDiary = db.prepare(`
    INSERT INTO diary_entries (media_item_id, watched_at, rating, source) VALUES (?, ?, NULL, 'playnite')
  `)
  const olderId = Number(insertDiary.run(mediaId, '2026-09-01').lastInsertRowid)
  const latestId = Number(insertDiary.run(mediaId, '2026-09-10').lastInsertRowid)

  const result = applyQuickRating(mediaId, 4.5, db)

  assert.equal(result?.diaryEntryId, latestId)
  assert.equal(result?.changed, true)
  assert.equal((db.prepare('SELECT rating FROM media_items WHERE id = ?').get(mediaId) as { rating: number }).rating, 4.5)
  assert.equal((db.prepare('SELECT rating FROM diary_entries WHERE id = ?').get(latestId) as { rating: number }).rating, 4.5)
  assert.equal((db.prepare('SELECT rating FROM diary_entries WHERE id = ?').get(olderId) as { rating: null }).rating, null)
})

test('snapshot de progresso não recebe a nota da conclusão', () => {
  const mediaId = Number(db.prepare(`
    INSERT INTO media_items (external_id, type, title, status, game_status, rating, completed_at)
    VALUES ('quick-rating-progress', 'game', 'Jogo zerado hoje', 'completed', 'zerado', 0, '2026-09-28T22:00:00.000Z')
  `).run().lastInsertRowid)
  const completionId = Number(db.prepare(`
    INSERT INTO diary_entries (media_item_id, watched_at, rating, source)
    VALUES (?, '2026-09-28T22:00:00.000Z', NULL, 'playnite')
  `).run(mediaId).lastInsertRowid)
  // O snapshot do mesmo dia nasce depois (job da meia-noite) com o mesmo horário.
  const progressId = Number(db.prepare(`
    INSERT INTO diary_entries
      (media_item_id, watched_at, rating, source, progress_day, progress_value, progress_unit)
    VALUES (?, '2026-09-28T22:00:00.000Z', NULL, 'playnite', '2026-09-28', 11480, 'seconds')
  `).run(mediaId).lastInsertRowid)

  const result = applyQuickRating(mediaId, 5, db)

  assert.equal(result?.diaryEntryId, completionId)
  assert.equal((db.prepare('SELECT rating FROM diary_entries WHERE id = ?').get(completionId) as { rating: number }).rating, 5)
  assert.equal((db.prepare('SELECT rating FROM diary_entries WHERE id = ?').get(progressId) as { rating: null }).rating, null)
})
