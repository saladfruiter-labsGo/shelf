import type Database from 'better-sqlite3'
import { db } from './db.js'

export function isQuickRating(value: unknown): value is number {
  return typeof value === 'number'
    && Number.isFinite(value)
    && value >= 0.5
    && value <= 5
    && Number.isInteger(value * 2)
}

/**
 * Aplica a nota à mídia e à sessão concluída mais recente que ainda não tinha
 * avaliação. Assim o card, o diário e as estatísticas contam a mesma história.
 */
export function applyQuickRating(
  mediaItemId: number,
  rating: number,
  database: Database.Database = db,
): { item: Record<string, unknown>; diaryEntryId: number | null; changed: boolean } | null {
  if (!isQuickRating(rating)) throw new RangeError('rating must be a half-step between 0.5 and 5')

  return database.transaction(() => {
    const before = database.prepare('SELECT * FROM media_items WHERE id = ?').get(mediaItemId) as
      Record<string, unknown> | undefined
    if (!before) return null

    database.prepare(`
      UPDATE media_items SET rating = ?, updated_at = datetime('now') WHERE id = ?
    `).run(rating, mediaItemId)

    const diary = database.prepare(`
      SELECT id FROM diary_entries
      WHERE media_item_id = ? AND (rating IS NULL OR rating <= 0)
      ORDER BY watched_at DESC, id DESC
      LIMIT 1
    `).get(mediaItemId) as { id: number } | undefined
    if (diary) database.prepare('UPDATE diary_entries SET rating = ? WHERE id = ?').run(rating, diary.id)

    return {
      item: database.prepare('SELECT * FROM media_items WHERE id = ?').get(mediaItemId) as Record<string, unknown>,
      diaryEntryId: diary?.id ?? null,
      changed: Number(before.rating ?? 0) !== rating,
    }
  })()
}
