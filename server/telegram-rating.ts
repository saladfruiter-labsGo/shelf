import type Database from 'better-sqlite3'
import { db } from './db.js'
import { cfg, setCfg } from './integrations/config.js'
import { applyQuickRating, isQuickRating } from './quick-rating.js'

const TG_BASE = process.env.TELEGRAM_API_BASE ?? 'https://api.telegram.org'

interface TelegramCallbackUpdate {
  update_id?: number
  callback_query?: {
    id?: string
    data?: string
    message?: {
      message_id?: number
      message_thread_id?: number
      chat?: { id?: number | string }
    }
  }
}

export function telegramRatingKeyboard(mediaItemId: number) {
  const ratings = [0.5, 1, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5]
  const button = (rating: number) => ({
    text: `${rating}★`,
    callback_data: `shelf:rate:${mediaItemId}:${rating}`,
  })
  return {
    inline_keyboard: [ratings.slice(0, 5).map(button), ratings.slice(5).map(button)],
  }
}

export function ratingRequestFromUpdate(
  update: TelegramCallbackUpdate,
  expectedChatId: string,
  expectedThreadId: string,
): { callbackId: string; mediaItemId: number; rating: number; chatId: string; messageId: number } | null {
  const callback = update.callback_query
  const match = callback?.data?.match(/^shelf:rate:(\d+):(\d(?:\.5)?)$/)
  const chatId = String(callback?.message?.chat?.id ?? '')
  const threadId = String(callback?.message?.message_thread_id ?? '')
  const mediaItemId = Number(match?.[1])
  const rating = Number(match?.[2])
  const messageId = Number(callback?.message?.message_id)

  if (!callback?.id || !match || chatId !== expectedChatId) return null
  if (expectedThreadId && threadId !== expectedThreadId) return null
  if (!Number.isInteger(mediaItemId) || mediaItemId <= 0 || !isQuickRating(rating)) return null
  if (!Number.isInteger(messageId) || messageId <= 0) return null
  return { callbackId: callback.id, mediaItemId, rating, chatId, messageId }
}

async function telegramPost(
  token: string,
  method: string,
  body: Record<string, unknown>,
  fetchImpl: typeof fetch,
): Promise<void> {
  const response = await fetchImpl(`${TG_BASE}/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Telegram ${method}: HTTP ${response.status}`)
}

/** Busca callbacks sem exigir que o Shelf esteja publicamente acessível. */
export async function pollTelegramRatings(
  database: Database.Database = db,
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  if (cfg('TELEGRAM_ENABLED') !== '1') return
  const token = cfg('TELEGRAM_BOT_TOKEN')
  const chatId = cfg('TELEGRAM_CHAT_ID')
  const threadId = cfg('TELEGRAM_THREAD_ID')
  if (!token || !chatId) return

  const savedOffset = Number.parseInt(cfg('TELEGRAM_UPDATE_OFFSET') || '0', 10)
  const offset = Number.isFinite(savedOffset) && savedOffset >= 0 ? savedOffset : 0
  const response = await fetchImpl(`${TG_BASE}/bot${token}/getUpdates?offset=${offset}&timeout=0`)
  if (!response.ok) throw new Error(`Telegram getUpdates: HTTP ${response.status}`)
  const payload = await response.json() as { ok?: boolean; result?: TelegramCallbackUpdate[]; description?: string }
  if (!payload.ok || !Array.isArray(payload.result)) throw new Error(payload.description ?? 'Resposta inválida do Telegram')

  let nextOffset = offset
  for (const update of payload.result) {
    if (Number.isInteger(update.update_id)) nextOffset = Math.max(nextOffset, Number(update.update_id) + 1)
    const request = ratingRequestFromUpdate(update, chatId, threadId)
    if (!request) continue

    const result = applyQuickRating(request.mediaItemId, request.rating, database)
    const answer = result ? `Salvo: ${request.rating}★` : 'Item não encontrado no Shelf'
    await telegramPost(token, 'answerCallbackQuery', {
      callback_query_id: request.callbackId,
      text: answer,
    }, fetchImpl).catch(() => {})

    if (result) {
      await telegramPost(token, 'editMessageReplyMarkup', {
        chat_id: request.chatId,
        message_id: request.messageId,
        reply_markup: { inline_keyboard: [] },
      }, fetchImpl).catch(() => {})
    }
  }
  if (nextOffset !== offset) setCfg('TELEGRAM_UPDATE_OFFSET', String(nextOffset))
}
