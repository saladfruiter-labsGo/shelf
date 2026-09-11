import { after, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'shelf-diary-progress-'))
process.env.DATA_DIR = dataDir
process.env.SHELF_TIMEZONE = 'America/Sao_Paulo'

const { db } = await import('./db.js')
const { localDiaryDay, recordDiaryProgress, runDiaryProgressJob } = await import('./diary-progress.js')

after(() => db.close())

test('fecha somente atualizações reais e usa o último progresso de cada dia', () => {
  const bookId = Number(db.prepare(`
    INSERT INTO media_items (external_id, type, title, status, pages_total, pages_read)
    VALUES ('book-progress', 'book', 'Livro em andamento', 'in_progress', 400, 35)
  `).run().lastInsertRowid)
  const gameId = Number(db.prepare(`
    INSERT INTO media_items (external_id, type, title, status, game_status, playtime_seconds)
    VALUES ('game-progress', 'game', 'Jogo em andamento', 'in_progress', 'jogando', 7200)
  `).run().lastInsertRowid)
  const untouchedBookId = Number(db.prepare(`
    INSERT INTO media_items (external_id, type, title, status, pages_total, pages_read)
    VALUES ('book-untouched', 'book', 'Livro sem atualização', 'in_progress', 200, 0)
  `).run().lastInsertRowid)

  assert.equal(localDiaryDay('2026-09-11T02:30:00.000Z'), '2026-09-10')

  recordDiaryProgress({
    mediaItemId: bookId, source: 'kavita', value: 20, total: 400,
    unit: 'pages', rating: null, observedAt: '2026-09-11T01:00:00.000Z',
  })
  recordDiaryProgress({
    mediaItemId: bookId, source: 'kavita', value: 35, total: 400,
    unit: 'pages', rating: 4.5, observedAt: '2026-09-11T02:30:00.000Z',
  })
  recordDiaryProgress({
    mediaItemId: gameId, source: 'playnite', value: 7200, total: null,
    unit: 'seconds', rating: 4, observedAt: '2026-09-11T02:45:00.000Z',
  })

  // Ainda é 10/09 no fuso do diário; o dia não deve fechar antes da meia-noite.
  assert.equal(runDiaryProgressJob(new Date('2026-09-11T02:59:59.000Z')), 0)
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM diary_entries').get() as { n: number }).n, 0)

  assert.equal(runDiaryProgressJob(new Date('2026-09-11T03:00:01.000Z')), 2)
  assert.equal(runDiaryProgressJob(new Date('2026-09-12T03:00:01.000Z')), 0)

  assert.deepEqual(db.prepare(`
    SELECT media_item_id, source, progress_day, progress_value, progress_total, progress_unit, rating
      FROM diary_entries ORDER BY media_item_id
  `).all(), [
    { media_item_id: bookId, source: 'kavita', progress_day: '2026-09-10', progress_value: 35, progress_total: 400, progress_unit: 'pages', rating: 4.5 },
    { media_item_id: gameId, source: 'playnite', progress_day: '2026-09-10', progress_value: 7200, progress_total: null, progress_unit: 'seconds', rating: 4 },
  ])
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM diary_entries WHERE media_item_id = ?').get(untouchedBookId) as { n: number }).n, 0)
})
