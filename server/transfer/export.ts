/**
 * Exportação da biblioteca e do backlog.
 *
 * Dois formatos, com propósitos diferentes:
 *
 * - **JSON** (`shelf_export: 2`) — export portátil e re-importável: itens,
 *   diário, temporadas/episódios, listas completas, atividade e preços. As referências entre tabelas usam
 *   `external_id + type` em vez do `id` interno, para que a importação funcione
 *   em outro banco (ids do SQLite não sobrevivem a uma restauração). Segredos
 *   de integração não entram; snapshots operacionais cuidam da cópia integral.
 * - **CSV** — uma linha por item, para planilha. Campos longos (sinopse) ficam
 *   de fora de propósito.
 */
import { db } from '../db.js'
import { LIBRARY_STATUS_PREDICATE } from '../media-domain.js'

export type ExportScope = 'all' | 'library' | 'backlog'

/** Filtro de status por escopo. Backlog = wishlist; biblioteca = o resto. */
function scopeWhere(scope: ExportScope): string {
  if (scope === 'backlog') return "status = 'wishlist'"
  if (scope === 'library') return LIBRARY_STATUS_PREDICATE
  return '1=1'
}

export interface ShelfExport {
  shelf_export: 2
  exported_at: string
  scope: ExportScope
  counts: {
    items: number
    diary: number
    series: number
    lists: number
    activity: number
    tracks: number
    prices: number
  }
  items: Record<string, unknown>[]
  diary: Record<string, unknown>[]
  series: Record<string, unknown>[]
  lists: Record<string, unknown>[]
  activity: Record<string, unknown>[]
  tracks: Record<string, unknown>[]
  prices: Record<string, unknown>[]
}

export function buildExport(scope: ExportScope): ShelfExport {
  const itemRows = db.prepare(
    `SELECT * FROM media_items WHERE ${scopeWhere(scope)} ORDER BY type, title`,
  ).all() as Record<string, unknown>[]
  const items = itemRows.map(({ id: _id, ...item }) => item)

  const ids = itemRows.map(i => i.id as number)
  const byId = new Map(itemRows.map(i => [i.id as number, i]))
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
  const listRows = db.prepare(
    'SELECT id, name, description, mode, dim_seen, created_at, updated_at FROM lists ORDER BY name',
  ).all() as any[]
  const lists = listRows.map(l => {
    const tierRows = db.prepare(
      'SELECT id, name, color, position FROM list_tiers WHERE list_id = ? ORDER BY position, id',
    ).all(l.id) as any[]
    const tierKeys = new Map(tierRows.map((t, index) => [t.id, `tier-${index}`]))
    return {
      name: l.name,
      description: l.description,
      mode: l.mode,
      dim_seen: l.dim_seen,
      created_at: l.created_at,
      updated_at: l.updated_at,
      tiers: tierRows.map(t => ({ key: tierKeys.get(t.id), name: t.name, color: t.color, position: t.position })),
      // A ordem e o tier usam referências portáteis, nunca ids internos.
      items: (db.prepare(
        `SELECT m.external_id, m.type, li.position, li.tier_id, li.added_at
           FROM list_items li
           JOIN media_items m ON m.id = li.media_item_id
          WHERE li.list_id = ? ORDER BY li.position, li.id`,
      ).all(l.id) as any[])
        .filter(i => exported.has(`${i.type}::${i.external_id}`))
        .map(i => ({
          external_id: i.external_id,
          type: i.type,
          position: i.position,
          tier_key: i.tier_id == null ? null : (tierKeys.get(i.tier_id) ?? null),
          added_at: i.added_at,
        })),
    }
  }).filter(l => scope === 'all' || l.items.length > 0)

  // Atividade e cache musical não pertencem com segurança a um subconjunto de
  // status; entram apenas no export "Tudo". Os campos normalizados são dados do
  // usuário, enquanto credenciais e estados internos de `settings` ficam fora.
  const activity = scope === 'all'
    ? db.prepare(`
        SELECT source, event_type, media_type, external_ref, title, subtitle, cover_url,
               rating, duration_ms, genre, occurred_at, created_at
          FROM activity_events ORDER BY occurred_at, id
      `).all() as Record<string, unknown>[]
    : []
  const tracks = scope === 'all'
    ? db.prepare(`
        SELECT artist, track, album, duration_ms, genre, mbid, cover_url, play_count,
               first_played, last_played, enriched
          FROM music_tracks ORDER BY artist, track
      `).all() as Record<string, unknown>[]
    : []

  const productRows = inIds
    ? db.prepare('SELECT * FROM game_price_products WHERE media_item_id IN ' + inIds + ' ORDER BY id').all(...ids) as any[]
    : []
  const prices = productRows.map(product => ({
    ...ref(product.media_item_id),
    provider: product.provider,
    platform: product.platform,
    provider_game_id: product.provider_game_id,
    matched_title: product.matched_title,
    match_method: product.match_method,
    match_status: product.match_status,
    currency: product.currency,
    history_low_minor: product.history_low_minor,
    history_low_at: product.history_low_at,
    last_resolved_at: product.last_resolved_at,
    last_synced_at: product.last_synced_at,
    last_error: product.last_error,
    created_at: product.created_at,
    updated_at: product.updated_at,
    offers: db.prepare(`
      SELECT shop_id, shop_name, price_minor, regular_minor, currency, discount_percent,
             url, drm, voucher, available, observed_at, last_seen_at, created_at, updated_at
        FROM game_price_offers WHERE game_price_product_id = ? ORDER BY shop_id
    `).all(product.id),
    history: db.prepare(`
      SELECT shop_id, shop_name, price_minor, regular_minor, currency, discount_percent,
             observed_at, observed_day, source, created_at
        FROM game_price_history WHERE game_price_product_id = ? ORDER BY observed_at, id
    `).all(product.id),
  }))

  return {
    shelf_export: 2,
    exported_at: new Date().toISOString(),
    scope,
    counts: {
      items: items.length,
      diary: diary.length,
      series: series.length,
      lists: lists.length,
      activity: activity.length,
      tracks: tracks.length,
      prices: prices.length,
    },
    items,
    diary,
    series,
    lists,
    activity,
    tracks,
    prices,
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
