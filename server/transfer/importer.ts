/**
 * Importação: backup do próprio Shelf e CSVs do Letterboxd.
 *
 * Duas regras valem para toda importação:
 *
 * 1. **Wishlist nunca convive com biblioteca.** Um item já consumido não volta
 *    para o backlog só porque ainda está na watchlist do outro serviço.
 * 2. **Nada é apagado.** Importar é sempre aditivo: campos vazios são
 *    preenchidos, os já preenchidos só mudam em `mode: 'replace'`.
 */
import type { Statement } from 'better-sqlite3'
import { db } from '../db.js'
import { tmdbMovieLookup } from '../routes/search.js'
import {
  parseLetterboxd, letterboxdSlug,
  type LetterboxdKind, type LetterboxdPlan, type LetterboxdSource,
} from './letterboxd.js'

export type ImportMode = 'merge' | 'replace'

export interface ImportReport {
  created: number
  updated: number
  skipped: number
  diary: number
  /** Títulos que nenhum provedor externo resolveu (importados mesmo assim). */
  unresolved: string[]
  errors: string[]
  restored?: { lists: number; activity: number; tracks: number; prices: number }
}

function emptyReport(): ImportReport {
  return { created: 0, updated: 0, skipped: 0, diary: 0, unresolved: [], errors: [] }
}

const findItem = db.prepare('SELECT * FROM media_items WHERE external_id = ? AND type = ?')

/**
 * `db.prepare` compila SQL toda vez que é chamado. Num import de milhares de
 * linhas, preparar dentro do laço produz milhares de statements para o coletor
 * — desperdício, e no Node 24 + Windows o addon nativo do better-sqlite3 chega
 * a abortar o processo ao coletá-las (o mesmo defeito que `scripts/test.mjs`
 * contorna). As formas de SQL aqui são poucas e repetidas, então guarda cada
 * uma pela própria string.
 */
const compiled = new Map<string, Statement<unknown[]>>()
function prep(sql: string): Statement<unknown[]> {
  let stmt = compiled.get(sql)
  if (!stmt) { stmt = db.prepare(sql); compiled.set(sql, stmt) }
  return stmt
}

const insertDiary = db.prepare(`
  INSERT INTO diary_entries (media_item_id, watched_at, rating, comment, source, season_number, episode_number)
  VALUES (@media_item_id, @watched_at, @rating, @comment, @source, @season_number, @episode_number)
`)

/** Mesma mídia + mesma data + mesma origem = mesma sessão; não duplica ao reimportar. */
const diaryExists = db.prepare(`
  SELECT 1 FROM diary_entries
   WHERE media_item_id = ? AND date(watched_at) = date(?) AND source = ?
   LIMIT 1
`)

function addDiary(mediaItemId: number, watchedAt: string, rating: number | null, comment: string | null, source: string): boolean {
  if (diaryExists.get(mediaItemId, watchedAt, source)) return false
  insertDiary.run({
    media_item_id: mediaItemId, watched_at: watchedAt, rating, comment,
    source, season_number: null, episode_number: null,
  })
  return true
}

/* ─────────────────────────── Backup do próprio Shelf ─────────────────────── */

/** Colunas aceitas na importação — ignora `id` e qualquer campo desconhecido. */
const ITEM_COLUMNS = [
  'external_id', 'type', 'title', 'cover_url', 'year', 'genre', 'runtime', 'rating',
  'status', 'notes', 'synopsis', 'creators', 'author', 'release_date', 'hype', 'favorite',
  'completed_at', 'tmdb_id', 'pages_total', 'pages_read', 'playtime_seconds',
  'game_status', 'last_played_at', 'publisher', 'library', 'steam_appid',
  'original_filename',
  'added_at', 'updated_at',
] as const

export interface ShelfBackup {
  shelf_export?: number
  items?: Record<string, unknown>[]
  diary?: Record<string, unknown>[]
  series?: any[]
  lists?: any[]
  activity?: any[]
  tracks?: any[]
  prices?: any[]
}

export function importShelfBackup(payload: ShelfBackup, mode: ImportMode = 'merge'): ImportReport {
  const report = emptyReport()
  if (!payload || !Array.isArray(payload.items)) {
    report.errors.push('Arquivo não parece um export do Shelf (campo "items" ausente).')
    return report
  }
  if (payload.shelf_export != null && payload.shelf_export !== 1 && payload.shelf_export !== 2) {
    report.errors.push(`Versão de export não suportada: ${payload.shelf_export}.`)
    return report
  }

  const restored = { lists: 0, activity: 0, tracks: 0, prices: 0 }
  report.restored = restored

  const run = db.transaction(() => {
    for (const raw of payload.items!) {
      const external_id = String(raw.external_id ?? '').trim()
      const type = String(raw.type ?? '').trim()
      const title = String(raw.title ?? '').trim()
      if (!external_id || !type || !title) { report.skipped++; continue }

      const existing = findItem.get(external_id, type) as Record<string, unknown> | undefined
      const cols = ITEM_COLUMNS.filter(c => raw[c] !== undefined)

      if (!existing) {
        prep(
          `INSERT INTO media_items (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
        ).run(...cols.map(c => (raw[c] as any) ?? null))
        report.created++
        continue
      }

      // merge: só preenche buraco — e só com valor de verdade, para "atualizados"
      // não contar campo nulo sobrescrito por nulo. replace: o arquivo manda.
      const updatable = cols.filter(c => c !== 'external_id' && c !== 'type' && c !== 'added_at')
      const isBlank = (v: unknown) => v == null || v === ''
      const fillsGap = (c: string) => {
        if (isBlank(raw[c])) return false
        // Nota é 0 quando não avaliada — 0 não sobrescreve, e nota nova preenche.
        if (c === 'rating') return Number(raw[c]) > 0 && !Number(existing[c])
        return isBlank(existing[c])
      }
      const fields = mode === 'replace' ? updatable : updatable.filter(fillsGap)
      if (fields.length === 0) { report.skipped++; continue }

      prep(
        `UPDATE media_items SET ${fields.map(f => `${f} = ?`).join(', ')}, updated_at = datetime('now')
          WHERE external_id = ? AND type = ?`,
      ).run(...fields.map(f => (raw[f] as any) ?? null), external_id, type)
      report.updated++
    }

    for (const d of payload.diary ?? []) {
      const item = findItem.get(String(d.external_id ?? ''), String(d.type ?? '')) as { id: number } | undefined
      if (!item || !d.watched_at) continue
      const source = String(d.source ?? 'manual')
      if (diaryExists.get(item.id, String(d.watched_at), source)) continue
      insertDiary.run({
        media_item_id: item.id,
        watched_at: String(d.watched_at),
        rating: (d.rating as number) ?? null,
        comment: (d.comment as string) ?? null,
        source,
        season_number: (d.season_number as number) ?? null,
        episode_number: (d.episode_number as number) ?? null,
      })
      report.diary++
    }

    for (const s of payload.series ?? []) {
      const item = findItem.get(String(s.external_id ?? ''), String(s.type ?? 'series')) as { id: number } | undefined
      if (!item) continue
      for (const season of s.seasons ?? []) {
        prep(`
          INSERT INTO series_seasons (media_item_id, season_number, title, episode_count, status, completed_at)
          VALUES (?, ?, ?, ?, ?, ?)
          ON CONFLICT(media_item_id, season_number) DO UPDATE SET
            title         = COALESCE(series_seasons.title, excluded.title),
            episode_count = MAX(series_seasons.episode_count, excluded.episode_count),
            status        = excluded.status,
            completed_at  = COALESCE(series_seasons.completed_at, excluded.completed_at)
        `).run(item.id, season.season_number, season.title ?? null, season.episode_count ?? 0,
               season.status ?? 'in_progress', season.completed_at ?? null)

        for (const ep of season.episodes ?? []) {
          prep(`
            INSERT INTO series_episodes (media_item_id, season_number, episode_number, title, watched, watched_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(media_item_id, season_number, episode_number) DO UPDATE SET
              title      = COALESCE(series_episodes.title, excluded.title),
              watched    = MAX(series_episodes.watched, excluded.watched),
              watched_at = COALESCE(series_episodes.watched_at, excluded.watched_at)
          `).run(item.id, season.season_number, ep.episode_number, ep.title ?? null,
                 ep.watched ? 1 : 0, ep.watched_at ?? null)
        }
      }
    }

    for (const l of payload.lists ?? []) {
      const name = String(l.name ?? '').trim()
      if (!name) continue
      let list = db.prepare('SELECT id FROM lists WHERE name = ? ORDER BY id LIMIT 1').get(name) as { id: number } | undefined
      const created = !list
      if (!list) {
        const mode = ['list', 'ranking', 'tier'].includes(l.mode) ? l.mode : 'list'
        const res = db.prepare(`
          INSERT INTO lists (name, description, mode, dim_seen, created_at, updated_at)
          VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
        `).run(name, l.description ?? null, mode, l.dim_seen ? 1 : 0, l.created_at ?? null, l.updated_at ?? null)
        list = { id: Number(res.lastInsertRowid) }
      } else if (mode === 'replace') {
        db.prepare(`
          UPDATE lists SET description = ?, mode = ?, dim_seen = ?, updated_at = datetime('now') WHERE id = ?
        `).run(
          l.description ?? null,
          ['list', 'ranking', 'tier'].includes(l.mode) ? l.mode : 'list',
          l.dim_seen ? 1 : 0,
          list.id,
        )
      }

      // V2 leva a estrutura da tierlist. V1 não tinha `tiers` nem `tier_key` e
      // continua caindo naturalmente no comportamento antigo.
      const tierIds = new Map<string, number>()
      for (const [index, tier] of (Array.isArray(l.tiers) ? l.tiers : []).entries()) {
        const tierName = String(tier?.name ?? '').trim().slice(0, 24)
        if (!tierName) continue
        let existing = db.prepare(
          'SELECT id FROM list_tiers WHERE list_id = ? AND name = ? ORDER BY id LIMIT 1',
        ).get(list.id, tierName) as { id: number } | undefined
        const position = Number.isFinite(Number(tier.position)) ? Number(tier.position) : index
        const color = String(tier.color ?? 'accent').trim() || 'accent'
        if (!existing) {
          const result = db.prepare(
            'INSERT INTO list_tiers (list_id, name, color, position) VALUES (?, ?, ?, ?)',
          ).run(list.id, tierName, color, position)
          existing = { id: Number(result.lastInsertRowid) }
        } else if (mode === 'replace') {
          db.prepare('UPDATE list_tiers SET color = ?, position = ? WHERE id = ?')
            .run(color, position, existing.id)
        }
        tierIds.set(String(tier.key ?? `tier-${index}`), existing.id)
      }

      // A ordem do arquivo é a ordem da lista — vira `position` (usada no ranking).
      const maxPos = db.prepare('SELECT MAX(position) AS max FROM list_items WHERE list_id = ?')
        .get(list.id) as { max: number | null }
      let pos = (maxPos.max ?? -1) + 1
      for (const li of l.items ?? []) {
        const item = findItem.get(String(li.external_id ?? ''), String(li.type ?? '')) as { id: number } | undefined
        if (!item) continue
        const filePosition = Number.isFinite(Number(li.position)) ? Number(li.position) : pos
        const position = created || mode === 'replace' ? filePosition : pos
        const tierId = li.tier_key == null ? null : (tierIds.get(String(li.tier_key)) ?? null)
        const res = db.prepare(`
          INSERT OR IGNORE INTO list_items (list_id, media_item_id, position, tier_id, added_at)
          VALUES (?, ?, ?, ?, COALESCE(?, datetime('now')))
        `).run(list.id, item.id, position, tierId, li.added_at ?? null)
        if (res.changes > 0) {
          pos = Math.max(pos, position + 1)
        } else if (mode === 'replace') {
          db.prepare('UPDATE list_items SET position = ?, tier_id = ? WHERE list_id = ? AND media_item_id = ?')
            .run(position, tierId, list.id, item.id)
        }
      }
      restored.lists++
    }

    const activityExists = db.prepare(`
      SELECT 1 FROM activity_events
       WHERE source = ? AND event_type = ? AND media_type = ? AND external_ref IS ?
         AND title = ? AND occurred_at = ? LIMIT 1
    `)
    const insertActivity = db.prepare(`
      INSERT INTO activity_events
        (source, event_type, media_type, external_ref, title, subtitle, cover_url,
         rating, duration_ms, genre, occurred_at, raw, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, COALESCE(?, datetime('now')))
    `)
    for (const event of payload.activity ?? []) {
      const source = String(event.source ?? '').trim()
      const eventType = String(event.event_type ?? '').trim()
      const mediaType = String(event.media_type ?? '').trim()
      const title = String(event.title ?? '').trim()
      const occurredAt = String(event.occurred_at ?? '').trim()
      const externalRef = event.external_ref == null ? null : String(event.external_ref)
      if (!source || !eventType || !mediaType || !title || !occurredAt) continue
      if (activityExists.get(source, eventType, mediaType, externalRef, title, occurredAt)) continue
      insertActivity.run(
        source, eventType, mediaType, externalRef, title, event.subtitle ?? null,
        event.cover_url ?? null, event.rating ?? null, event.duration_ms ?? null,
        event.genre ?? null, occurredAt, event.created_at ?? null,
      )
      restored.activity++
    }

    const upsertTrack = db.prepare(`
      INSERT INTO music_tracks
        (artist, track, album, duration_ms, genre, mbid, cover_url, play_count, first_played, last_played, enriched)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(artist, track) DO UPDATE SET
        album        = COALESCE(music_tracks.album, excluded.album),
        duration_ms  = COALESCE(music_tracks.duration_ms, excluded.duration_ms),
        genre        = COALESCE(music_tracks.genre, excluded.genre),
        mbid         = COALESCE(music_tracks.mbid, excluded.mbid),
        cover_url    = COALESCE(music_tracks.cover_url, excluded.cover_url),
        play_count   = MAX(music_tracks.play_count, excluded.play_count),
        first_played = CASE WHEN music_tracks.first_played IS NULL THEN excluded.first_played
                            WHEN excluded.first_played IS NULL THEN music_tracks.first_played
                            ELSE MIN(music_tracks.first_played, excluded.first_played) END,
        last_played  = CASE WHEN music_tracks.last_played IS NULL THEN excluded.last_played
                            WHEN excluded.last_played IS NULL THEN music_tracks.last_played
                            ELSE MAX(music_tracks.last_played, excluded.last_played) END,
        enriched     = MAX(music_tracks.enriched, excluded.enriched)
    `)
    for (const track of payload.tracks ?? []) {
      const artist = String(track.artist ?? '').trim()
      const title = String(track.track ?? '').trim()
      if (!artist || !title) continue
      const result = upsertTrack.run(
        artist, title, track.album ?? null, track.duration_ms ?? null, track.genre ?? null,
        track.mbid ?? null, track.cover_url ?? null, Math.max(0, Number(track.play_count) || 0),
        track.first_played ?? null, track.last_played ?? null, track.enriched ? 1 : 0,
      )
      if (result.changes > 0) restored.tracks++
    }

    const upsertProduct = db.prepare(`
      INSERT INTO game_price_products
        (media_item_id, provider, provider_game_id, platform, matched_title, match_method,
         match_status, currency, history_low_minor, history_low_at, last_resolved_at,
         last_synced_at, last_error, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
      ON CONFLICT(media_item_id, provider, platform) DO UPDATE SET
        provider_game_id = excluded.provider_game_id, matched_title = excluded.matched_title,
        match_method = excluded.match_method, match_status = excluded.match_status,
        currency = excluded.currency, history_low_minor = excluded.history_low_minor,
        history_low_at = excluded.history_low_at, last_resolved_at = excluded.last_resolved_at,
        last_synced_at = excluded.last_synced_at, last_error = excluded.last_error,
        updated_at = excluded.updated_at
    `)
    const findProduct = db.prepare(
      'SELECT id FROM game_price_products WHERE media_item_id = ? AND provider = ? AND platform = ?',
    )
    const upsertOffer = db.prepare(`
      INSERT INTO game_price_offers
        (game_price_product_id, shop_id, shop_name, price_minor, regular_minor, currency,
         discount_percent, url, drm, voucher, available, observed_at, last_seen_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')), COALESCE(?, datetime('now')))
      ON CONFLICT(game_price_product_id, shop_id) DO UPDATE SET
        shop_name = excluded.shop_name, price_minor = excluded.price_minor,
        regular_minor = excluded.regular_minor, currency = excluded.currency,
        discount_percent = excluded.discount_percent, url = excluded.url,
        drm = excluded.drm, voucher = excluded.voucher, available = excluded.available,
        observed_at = excluded.observed_at, last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `)
    const insertHistory = db.prepare(`
      INSERT OR IGNORE INTO game_price_history
        (game_price_product_id, shop_id, shop_name, price_minor, regular_minor, currency,
         discount_percent, observed_at, observed_day, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE(?, datetime('now')))
    `)
    for (const price of payload.prices ?? []) {
      const item = findItem.get(String(price.external_id ?? ''), String(price.type ?? 'game')) as { id: number } | undefined
      if (!item) continue
      const provider = String(price.provider ?? 'itad')
      const platform = String(price.platform ?? 'pc')
      upsertProduct.run(
        item.id, provider, price.provider_game_id ?? null, platform, price.matched_title ?? null,
        price.match_method ?? null, price.match_status ?? 'pending', price.currency ?? null,
        price.history_low_minor ?? null, price.history_low_at ?? null, price.last_resolved_at ?? null,
        price.last_synced_at ?? null, price.last_error ?? null, price.created_at ?? null, price.updated_at ?? null,
      )
      const product = findProduct.get(item.id, provider, platform) as { id: number }
      for (const offer of price.offers ?? []) {
        upsertOffer.run(
          product.id, offer.shop_id, offer.shop_name, offer.price_minor, offer.regular_minor,
          offer.currency, offer.discount_percent ?? 0, offer.url, offer.drm ?? null,
          offer.voucher ?? null, offer.available == null ? 1 : Number(offer.available),
          offer.observed_at, offer.last_seen_at, offer.created_at ?? null, offer.updated_at ?? null,
        )
      }
      for (const point of price.history ?? []) {
        insertHistory.run(
          product.id, point.shop_id, point.shop_name, point.price_minor, point.regular_minor,
          point.currency, point.discount_percent ?? 0, point.observed_at, point.observed_day,
          point.source, point.created_at ?? null,
        )
      }
      restored.prices++
    }
  })

  try { run() } catch (e) { report.errors.push((e as Error).message) }
  return report
}

/* ────────────────────────────────  Letterboxd  ───────────────────────────── */

const insertMovie = db.prepare(`
  INSERT INTO media_items (external_id, type, title, cover_url, year, genre, release_date, status, rating, completed_at, added_at)
  VALUES (@external_id, 'movie', @title, @cover_url, @year, @genre, @release_date, @status, @rating, @completed_at, @added_at)
`)

/**
 * Só `diary.csv` e `reviews.csv` descrevem sessões.
 *
 * Em `watched.csv` e `ratings.csv` a coluna `Date` é o dia em que a linha foi
 * criada no Letterboxd — quase sempre o dia seguinte ao da sessão, que está no
 * `Watched Date` do diário. Tratar as duas como sessão põe o mesmo filme no
 * diário duas vezes, em dias consecutivos.
 */
function writesDiary(kind: LetterboxdKind): boolean {
  return kind === 'diary'
}

/**
 * `added_at` = quando o filme entrou na estante. Vindo do Letterboxd, a data do
 * arquivo é mais fiel que "agora": sem isso um import de anos de histórico
 * carimba tudo com o dia de hoje, empurra a biblioteca inteira para o topo de
 * "recentes" e concentra as estatísticas do Perfil num ano só.
 *
 * O formato acompanha o `datetime('now')` das outras linhas.
 */
function addedAtFrom(date: string | null): string | null {
  return date ? `${date} 00:00:00` : null
}

/** Um filme já casado com o TMDB (ou o palpite local, quando não casou). */
interface ResolvedMovie {
  external_id: string
  cover_url: string | null
  year: number | null
  genre: string | null
  release_date: string | null
  title: string
}

export interface LetterboxdImportOptions {
  /** Sobrepõe o tipo detectado pelo cabeçalho/nome do arquivo. */
  kind?: LetterboxdKind
  filename?: string
  /**
   * Cache de resolução compartilhado entre chamadas. No zip os mesmos filmes
   * aparecem em quatro arquivos; sem isso o TMDB seria consultado quatro vezes
   * para cada um.
   */
  cache?: Map<string, ResolvedMovie>
  /**
   * Reimportação corretiva: puxa o `added_at` de um item que já existe para a
   * data do arquivo quando ela é mais antiga. Fora daí a importação não mexe
   * em `added_at` de card que já estava aqui, para não reescrever a ordem de
   * uma estante montada à mão.
   */
  fixAddedAt?: boolean
}

export async function importLetterboxd(csv: string, opts: LetterboxdImportOptions = {}): Promise<ImportReport & { kind: LetterboxdKind; rows: number }> {
  const file = parseLetterboxd(csv, opts.filename ?? '')
  const kind = opts.kind ?? file.kind
  const report = emptyReport()

  // Uma resolução por título+ano por execução: o diário repete o mesmo filme.
  const resolved = opts.cache ?? new Map<string, ResolvedMovie>()

  for (const row of file.rows) {
    const cacheKey = `${row.name.toLowerCase()}::${row.year ?? ''}`
    let match = resolved.get(cacheKey)

    if (!match) {
      const found = await tmdbMovieLookup(row.name, row.year).catch(() => null)
      match = found
        ? {
            external_id: found.external_id, cover_url: found.cover_url, year: found.year ?? row.year,
            genre: found.genre, release_date: found.release_date, title: found.title,
          }
        : {
            external_id: `letterboxd:${letterboxdSlug(row.uri, row.name)}`, cover_url: null,
            year: row.year, genre: null, release_date: null, title: row.name,
          }
      if (!found) report.unresolved.push(`${row.name}${row.year ? ` (${row.year})` : ''}`)
      resolved.set(cacheKey, match)
    }

    const existing = findItem.get(match.external_id, 'movie') as any
    const wantsBacklog = kind === 'watchlist'
    const status = wantsBacklog ? 'wishlist' : 'completed'
    const completedAt = wantsBacklog ? null : (row.watchedAt ?? new Date().toISOString().slice(0, 10))

    const addedAt = addedAtFrom(row.watchedAt)

    let mediaId: number
    if (!existing) {
      const res = insertMovie.run({
        external_id: match.external_id, title: match.title, cover_url: match.cover_url,
        year: match.year, genre: match.genre, release_date: match.release_date,
        status, rating: row.rating ?? 0, completed_at: completedAt,
        // Sem data no arquivo, o DEFAULT da coluna (agora) vale.
        added_at: addedAt ?? new Date().toISOString().slice(0, 19).replace('T', ' '),
      })
      mediaId = Number(res.lastInsertRowid)
      report.created++
    } else {
      mediaId = existing.id
      const sets: string[] = []
      const vals: unknown[] = []

      // A watchlist nunca rebaixa um filme já assistido de volta ao backlog.
      if (!wantsBacklog && existing.status !== 'completed') {
        sets.push('status = ?', 'completed_at = COALESCE(completed_at, ?)')
        vals.push('completed', completedAt)
      }
      if (row.rating && row.rating !== existing.rating) { sets.push('rating = ?'); vals.push(row.rating) }
      if (!existing.cover_url && match.cover_url) { sets.push('cover_url = ?'); vals.push(match.cover_url) }
      // Só anda para trás: uma reimportação corretiva nunca "rejuvenesce" um item.
      if (opts.fixAddedAt && addedAt && addedAt < String(existing.added_at)) {
        sets.push('added_at = ?'); vals.push(addedAt)
      }

      if (sets.length) {
        prep(`UPDATE media_items SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals, mediaId)
        report.updated++
      } else {
        report.skipped++
      }
    }

    // Só o diário registra sessões — ver `writesDiary`. A watchlist nunca.
    if (writesDiary(kind) && row.watchedAt) {
      const comment = row.review ?? (row.rewatch ? 'Rewatch' : null)
      if (addDiary(mediaId, row.watchedAt, row.rating, comment, 'letterboxd')) report.diary++
    }
  }

  return { ...report, kind, rows: file.rows.length }
}

/* ─────────────── Letterboxd: aplicar o plano do export inteiro ───────────── */

export interface LetterboxdFileReport extends ImportReport {
  path: string
  kind: LetterboxdKind
  rows: number
}

export interface LetterboxdApplyResult {
  files: LetterboxdFileReport[]
  total: ImportReport & { rows: number }
  /** Registros de diário apagados antes de importar, quando `redo` foi pedido. */
  cleared: number
}

/** Quantos registros do diário vieram de uma importação do Letterboxd. */
export function countLetterboxdDiary(): number {
  const row = db.prepare("SELECT COUNT(*) n FROM diary_entries WHERE source = 'letterboxd'").get() as { n: number }
  return row.n
}

/**
 * Apaga só o que a importação do Letterboxd criou no diário. Registros feitos à
 * mão, pelo Plex ou por qualquer outra origem não são tocados — é o que torna
 * seguro reimportar o mesmo export depois de uma correção no importador.
 */
export function clearLetterboxdDiary(): number {
  return db.prepare("DELETE FROM diary_entries WHERE source = 'letterboxd'").run().changes
}

export interface LetterboxdApplyOptions {
  /**
   * Refazer: apaga os registros de diário que vieram do Letterboxd antes de
   * importar e recoloca o `added_at` dos filmes na data do arquivo. Serve para
   * consertar uma importação anterior sem apagar nada que não veio dali.
   */
  redo?: boolean
}

/**
 * Importa, na ordem do plano, os arquivos que a prévia marcou como aceitos.
 *
 * A ordem importa: `watched`/`ratings` primeiro para o card já nascer com nota,
 * `reviews.csv` antes de `diary.csv` (só ele traz o texto, e a primeira sessão
 * a entrar é a que fica), `watchlist` por último — que nunca rebaixa um filme
 * já assistido, seguindo a regra de que backlog e biblioteca não se misturam.
 */
export async function applyLetterboxdPlan(
  sources: LetterboxdSource[],
  plan: LetterboxdPlan,
  opts: LetterboxdApplyOptions = {},
): Promise<LetterboxdApplyResult> {
  const byPath = new Map(sources.map(s => [s.path, s.text]))
  const cache = new Map<string, ResolvedMovie>()
  const files: LetterboxdFileReport[] = []
  const total = { ...emptyReport(), rows: 0 }

  const cleared = opts.redo ? clearLetterboxdDiary() : 0

  for (const file of plan.files) {
    const csv = byPath.get(file.path)
    if (csv === undefined) {
      total.errors.push(`"${file.path}" não estava no arquivo enviado.`)
      continue
    }

    try {
      const r = await importLetterboxd(csv, { kind: file.kind, filename: file.path, cache, fixAddedAt: opts.redo })
      files.push({ ...r, path: file.path })
      total.created += r.created
      total.updated += r.updated
      total.skipped += r.skipped
      total.diary   += r.diary
      total.rows    += r.rows
      // Com o cache compartilhado, cada título é resolvido (e reportado) uma
      // única vez na rodada inteira — a soma não repete nomes.
      total.unresolved.push(...r.unresolved)
      total.errors.push(...r.errors)
    } catch (e) {
      total.errors.push(`${file.path}: ${(e as Error).message}`)
    }
  }

  return { files, total, cleared }
}
