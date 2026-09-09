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
}

function emptyReport(): ImportReport {
  return { created: 0, updated: 0, skipped: 0, diary: 0, unresolved: [], errors: [] }
}

const findItem = db.prepare('SELECT * FROM media_items WHERE external_id = ? AND type = ?')

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
  'status', 'notes', 'synopsis', 'creators', 'author', 'release_date', 'hype',
  'completed_at', 'tmdb_id', 'pages_total', 'pages_read', 'playtime_seconds',
  'game_status', 'last_played_at', 'publisher', 'library', 'steam_appid',
  'added_at', 'updated_at',
] as const

export interface ShelfBackup {
  shelf_export?: number
  items?: Record<string, unknown>[]
  diary?: Record<string, unknown>[]
  series?: any[]
  lists?: any[]
}

export function importShelfBackup(payload: ShelfBackup, mode: ImportMode = 'merge'): ImportReport {
  const report = emptyReport()
  if (!payload || !Array.isArray(payload.items)) {
    report.errors.push('Arquivo não parece um export do Shelf (campo "items" ausente).')
    return report
  }

  const run = db.transaction(() => {
    for (const raw of payload.items!) {
      const external_id = String(raw.external_id ?? '').trim()
      const type = String(raw.type ?? '').trim()
      const title = String(raw.title ?? '').trim()
      if (!external_id || !type || !title) { report.skipped++; continue }

      const existing = findItem.get(external_id, type) as Record<string, unknown> | undefined
      const cols = ITEM_COLUMNS.filter(c => raw[c] !== undefined)

      if (!existing) {
        db.prepare(
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

      db.prepare(
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
        db.prepare(`
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
          db.prepare(`
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
      let list = db.prepare('SELECT id FROM lists WHERE name = ?').get(name) as { id: number } | undefined
      if (!list) {
        const res = db.prepare('INSERT INTO lists (name, description) VALUES (?, ?)').run(name, l.description ?? null)
        list = { id: Number(res.lastInsertRowid) }
      }
      for (const li of l.items ?? []) {
        const item = findItem.get(String(li.external_id ?? ''), String(li.type ?? '')) as { id: number } | undefined
        if (!item) continue
        db.prepare('INSERT OR IGNORE INTO list_items (list_id, media_item_id) VALUES (?, ?)').run(list.id, item.id)
      }
    }
  })

  try { run() } catch (e) { report.errors.push((e as Error).message) }
  return report
}

/* ────────────────────────────────  Letterboxd  ───────────────────────────── */

const insertMovie = db.prepare(`
  INSERT INTO media_items (external_id, type, title, cover_url, year, genre, release_date, status, rating, completed_at)
  VALUES (@external_id, 'movie', @title, @cover_url, @year, @genre, @release_date, @status, @rating, @completed_at)
`)

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

    let mediaId: number
    if (!existing) {
      const res = insertMovie.run({
        external_id: match.external_id, title: match.title, cover_url: match.cover_url,
        year: match.year, genre: match.genre, release_date: match.release_date,
        status, rating: row.rating ?? 0, completed_at: completedAt,
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

      if (sets.length) {
        db.prepare(`UPDATE media_items SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...vals, mediaId)
        report.updated++
      } else {
        report.skipped++
      }
    }

    // Só o que foi assistido vira registro no diário; a watchlist não.
    if (!wantsBacklog && row.watchedAt) {
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
}

/**
 * Importa, na ordem do plano, os arquivos que a prévia marcou como aceitos.
 *
 * A ordem importa: `watched`/`ratings` primeiro para o card já nascer com nota,
 * `reviews.csv` antes de `diary.csv` (só ele traz o texto, e a primeira sessão
 * a entrar é a que fica), `watchlist` por último — que nunca rebaixa um filme
 * já assistido, seguindo a regra de que backlog e biblioteca não se misturam.
 */
export async function applyLetterboxdPlan(sources: LetterboxdSource[], plan: LetterboxdPlan): Promise<LetterboxdApplyResult> {
  const byPath = new Map(sources.map(s => [s.path, s.text]))
  const cache = new Map<string, ResolvedMovie>()
  const files: LetterboxdFileReport[] = []
  const total = { ...emptyReport(), rows: 0 }

  for (const file of plan.files) {
    const csv = byPath.get(file.path)
    if (csv === undefined) {
      total.errors.push(`"${file.path}" não estava no arquivo enviado.`)
      continue
    }

    try {
      const r = await importLetterboxd(csv, { kind: file.kind, filename: file.path, cache })
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

  return { files, total }
}
