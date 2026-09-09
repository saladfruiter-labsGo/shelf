/**
 * Exportação da biblioteca e do backlog.
 *
 * Dois formatos, com propósitos diferentes:
 *
 * - **JSON** (`shelf_export: 1`) — backup completo e re-importável: itens,
 *   diário, temporadas/episódios e listas. As referências entre tabelas usam
 *   `external_id + type` em vez do `id` interno, para que a importação funcione
 *   em outro banco (ids do SQLite não sobrevivem a uma restauração).
 * - **CSV** — uma linha por item, para planilha. Campos longos (sinopse) ficam
 *   de fora de propósito.
 */
import { db } from '../db.js'

export type ExportScope = 'all' | 'library' | 'backlog'

/** Filtro de status por escopo. Backlog = wishlist; biblioteca = o resto. */
function scopeWhere(scope: ExportScope): string {
  if (scope === 'backlog') return "status = 'wishlist'"
  if (scope === 'library') return "status != 'wishlist'"
  return '1=1'
}

export interface ShelfExport {
  shelf_export: 1
  exported_at: string
  scope: ExportScope
  counts: { items: number; diary: number; series: number; lists: number }
  items: Record<string, unknown>[]
  diary: Record<string, unknown>[]
  series: Record<string, unknown>[]
  lists: Record<string, unknown>[]
}

export function buildExport(scope: ExportScope): ShelfExport {
  const items = db.prepare(
    `SELECT * FROM media_items WHERE ${scopeWhere(scope)} ORDER BY type, title`,
  ).all() as Record<string, unknown>[]

  const ids = items.map(i => i.id as number)
  const byId = new Map(items.map(i => [i.id as number, i]))
  const ref = (mediaItemId: number) => {
    const it = byId.get(mediaItemId)
    return { external_id: it?.external_id ?? null, type: it?.type ?? null }
  }

  // `IN (...)` com lista vazia é inválido no SQLite — e não há o que buscar.
  const inIds = ids.length ? `(${ids.map(() => '?').join(',')})` : null

  const diaryRows = inIds
    ? (db.prepare(
        `SELECT media_item_id, watched_at, rating, comment, source, season_number, episode_number
           FROM diary_entries WHERE media_item_id IN ${inIds} ORDER BY watched_at`,
      ).all(...ids) as any[])
    : []
  const diary = diaryRows.map(d => ({
    ...ref(d.media_item_id),
    watched_at: d.watched_at,
    rating: d.rating,
    comment: d.comment,
    source: d.source,
    season_number: d.season_number,
    episode_number: d.episode_number,
  }))

  const seasonRows = inIds
    ? (db.prepare(
        `SELECT media_item_id, season_number, title, episode_count, status, completed_at
           FROM series_seasons WHERE media_item_id IN ${inIds} ORDER BY media_item_id, season_number`,
      ).all(...ids) as any[])
    : []
  const episodeRows = inIds
    ? (db.prepare(
        `SELECT media_item_id, season_number, episode_number, title, watched, watched_at
           FROM series_episodes WHERE media_item_id IN ${inIds} ORDER BY media_item_id, season_number, episode_number`,
      ).all(...ids) as any[])
    : []

  const series = [...new Set(seasonRows.map(s => s.media_item_id as number))].map(mediaId => ({
    ...ref(mediaId),
    seasons: seasonRows.filter(s => s.media_item_id === mediaId).map(s => ({
      season_number: s.season_number,
      title: s.title,
      episode_count: s.episode_count,
      status: s.status,
      completed_at: s.completed_at,
      episodes: episodeRows
        .filter(e => e.media_item_id === mediaId && e.season_number === s.season_number)
        .map(e => ({ episode_number: e.episode_number, title: e.title, watched: e.watched, watched_at: e.watched_at })),
    })),
  }))

  // Listas só entram com os itens dentro do escopo exportado (uma lista mista
  // exportada como "backlog" traz apenas a parte que está no backlog).
  const exported = new Set(items.map(i => `${i.type}::${i.external_id}`))
  const listRows = db.prepare('SELECT id, name, description, mode, created_at FROM lists ORDER BY name').all() as any[]
  const lists = listRows.map(l => ({
    name: l.name,
    description: l.description,
    mode: l.mode,
    created_at: l.created_at,
    // A ordem exportada é a ordem manual da lista (importa para rankings).
    items: (db.prepare(
      `SELECT m.external_id, m.type FROM list_items li
         JOIN media_items m ON m.id = li.media_item_id
        WHERE li.list_id = ? ORDER BY li.position, li.id`,
    ).all(l.id) as { external_id: string; type: string }[])
      .filter(i => exported.has(`${i.type}::${i.external_id}`)),
  })).filter(l => l.items.length > 0)

  return {
    shelf_export: 1,
    exported_at: new Date().toISOString(),
    scope,
    counts: { items: items.length, diary: diary.length, series: series.length, lists: lists.length },
    items,
    diary,
    series,
    lists,
  }
}

/** Contagens por escopo para a tela de exportação — só COUNT, sem montar o payload. */
export function exportSummary(): Record<ExportScope, { items: number; diary: number }> {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n
  const forScope = (scope: ExportScope) => ({
    items: count(`SELECT COUNT(*) n FROM media_items WHERE ${scopeWhere(scope)}`),
    diary: count(`SELECT COUNT(*) n FROM diary_entries d
                    JOIN media_items m ON m.id = d.media_item_id
                   WHERE ${scopeWhere(scope).replace(/status/g, 'm.status')}`),
  })
  return { all: forScope('all'), library: forScope('library'), backlog: forScope('backlog') }
}

/* ─────────────────────────────────── CSV ─────────────────────────────────── */

/** Colunas do CSV, na ordem. Sinopse fica de fora (texto longo). */
export const CSV_COLUMNS = [
  'type', 'title', 'year', 'status', 'game_status', 'rating', 'genre',
  'creators', 'author', 'publisher', 'library', 'runtime', 'playtime_seconds',
  'pages_read', 'pages_total', 'release_date', 'completed_at', 'last_played_at',
  'added_at', 'external_id', 'steam_appid', 'notes',
] as const

/** Escapa um campo conforme RFC 4180 (aspas duplicadas, campo entre aspas). */
export function csvField(value: unknown): string {
  if (value == null) return ''
  const s = String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows: Record<string, unknown>[], columns: readonly string[] = CSV_COLUMNS): string {
  const lines = [columns.join(',')]
  for (const row of rows) lines.push(columns.map(c => csvField(row[c])).join(','))
  return lines.join('\r\n')
}

export function exportCsv(scope: ExportScope): string {
  const rows = db.prepare(
    `SELECT * FROM media_items WHERE ${scopeWhere(scope)} ORDER BY type, title`,
  ).all() as Record<string, unknown>[]
  return toCsv(rows)
}
