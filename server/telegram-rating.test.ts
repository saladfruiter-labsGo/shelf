import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-telegram-rating-'))

let db: Database.Database
let setCfg: typeof import('./integrations/config.js').setCfg
let cfg: typeof import('./integrations/config.js').cfg
let telegram: typeof import('./telegram-rating.js')

before(async () => {
  db = (await import('./db.js')).db
  const config = await import('./integrations/config.js')
  setCfg = config.setCfg
  cfg = config.cfg
  telegram = await import('./telegram-rating.js')
})

after(() => db.close())

test('gera callbacks compactos e rejeita outro chat ou tópico', () => {
  const keyboard = telegram.telegramRatingKeyboard(42)
  assert.equal(keyboard.inline_keyboard[0][0].callback_data, 'shelf:rate:42:0.5')
  assert.equal(keyboard.inline_keyboard[1][4].callback_data, 'shelf:rate:42:5')
  const update = {
    update_id: 10,
    callback_query: { id: 'cb', data: 'shelf:rate:42:4', message: { message_id: 7, message_thread_id: 3, chat: { id: -100 } } },
  }
  assert.equal(telegram.ratingRequestFromUpdate(update, '-100', '3')?.rating, 4)
  assert.equal(telegram.ratingRequestFromUpdate(update, '-200', '3'), null)
  assert.equal(telegram.ratingRequestFromUpdate(update, '-100', '4'), null)
})

test('poll aplica a nota, confirma o callback e avança o offset', async () => {
  const mediaId = Number(db.prepare(`
    INSERT INTO media_items (external_id, type, title, status, rating)
    VALUES ('telegram-rating', 'game', 'Jogo no Telegram', 'completed', 0)
  `).run().lastInsertRowid)
  db.prepare(`
    INSERT INTO diary_entries (media_item_id, watched_at, rating, source)
    VALUES (?, '2026-09-10', NULL, 'playnite')
  `).run(mediaId)
  setCfg('TELEGRAM_ENABLED', '1')
  setCfg('TELEGRAM_BOT_TOKEN', 'test-token')
  setCfg('TELEGRAM_CHAT_ID', '123')
  setCfg('TELEGRAM_THREAD_ID', '')
  setCfg('TELEGRAM_UPDATE_OFFSET', '10')

  const methods: string[] = []
  const fakeFetch = async (input: string | URL | Request) => {
    const url = String(input)
    if (url.includes('/getUpdates')) {
      assert.match(url, /offset=10/)
      return Response.json({ ok: true, result: [{
        update_id: 10,
        callback_query: {
          id: 'callback-1', data: `shelf:rate:${mediaId}:5`,
          message: { message_id: 99, chat: { id: 123 } },
        },
      }] })
    }
    methods.push(url.split('/').at(-1) ?? '')
    return Response.json({ ok: true })
  }

  await telegram.pollTelegramRatings(db, fakeFetch as typeof fetch)

  assert.equal((db.prepare('SELECT rating FROM media_items WHERE id = ?').get(mediaId) as { rating: number }).rating, 5)
  assert.equal((db.prepare('SELECT rating FROM diary_entries WHERE media_item_id = ?').get(mediaId) as { rating: number }).rating, 5)
  assert.deepEqual(methods, ['answerCallbackQuery', 'editMessageReplyMarkup'])
  assert.equal(cfg('TELEGRAM_UPDATE_OFFSET'), '11')
})
