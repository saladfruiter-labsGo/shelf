import { db } from './db.js'

/* ─────────────────────────── helpers de config ─────────────────────────── */

const readSetting = db.prepare('SELECT value FROM settings WHERE key = ?')

function apiKey(name: string): string | undefined {
  const row = readSetting.get(name) as { value: string } | undefined
  return row?.value?.trim() || process.env[name]
}

/* ─────────────────────────── statements ─────────────────────────── */

const getItem = db.prepare('SELECT * FROM media_items WHERE id = ?')

const upsertSeason = db.prepare(`
  INSERT INTO series_seasons (media_item_id, season_number, title, episode_count)
  VALUES (@media_item_id, @season_number, @title, @episode_count)
  ON CONFLICT(media_item_id, season_number) DO UPDATE SET
    title         = COALESCE(excluded.title, series_seasons.title),
    episode_count = MAX(series_seasons.episode_count, excluded.episode_count)
`)

const upsertEpisode = db.prepare(`
  INSERT INTO series_episodes (media_item_id, season_number, episode_number, title)
  VALUES (@media_item_id, @season_number, @episode_number, @title)
  ON CONFLICT(media_item_id, season_number, episode_number) DO UPDATE SET
    title = COALESCE(excluded.title, series_episodes.title)
`)

const markEpisode = db.prepare(`
  INSERT INTO series_episodes (media_item_id, season_number, episode_number, title, watched, watched_at)
  VALUES (@media_item_id, @season_number, @episode_number, @title, @watched, @watched_at)
  ON CONFLICT(media_item_id, season_number, episode_number) DO UPDATE SET
    title      = COALESCE(excluded.title, series_episodes.title),
    watched    = excluded.watched,
    watched_at = CASE WHEN excluded.watched = 1
                      THEN COALESCE(series_episodes.watched_at, excluded.watched_at)
                      ELSE NULL END
`)

/* ─────────────────────────── enriquecimento TMDB ─────────────────────────── */

/** Extrai um id numérico do TMDB de um guid do Plex, se presente. */
export function tmdbIdFromGuid(guid?: string | null): string | null {
  if (!guid) return null
  // com.plexapp.agents.themoviedb://12345?lang=...  |  tmdb://12345
  const m = guid.match(/(?:themoviedb|tmdb)[:/]+(\d+)/i)
  return m ? m[1] : null
}

/** Procura o id TMDB de uma série pelo título (fallback quando o guid não expõe tmdb). */
export async function resolveTmdbSeriesId(title: string, year?: number | null): Promise<string | null> {
  const key = apiKey('TMDB_API_KEY')
  if (!key || !title) return null
  try {
    const qs = new URLSearchParams({ api_key: key, query: title, page: '1' })
    if (year) qs.set('first_air_date_year', String(year))
    const res = await fetch(`https://api.themoviedb.org/3/search/tv?${qs}`)
    if (!res.ok) return null
    const data = await res.json() as { results?: any[] }
    return data.results?.[0]?.id != null ? String(data.results[0].id) : null
  } catch {
    return null
  }
}

/** Procura o id TMDB de um filme pelo título (fallback quando o guid não expõe tmdb). */
export async function resolveTmdbMovieId(title: string, year?: number | null): Promise<string | null> {
  const key = apiKey('TMDB_API_KEY')
  if (!key || !title) return null
  try {
    const qs = new URLSearchParams({ api_key: key, query: title, page: '1' })
    if (year) qs.set('primary_release_year', String(year))
    const res = await fetch(`https://api.themoviedb.org/3/search/movie?${qs}`)
    if (!res.ok) return null
    const data = await res.json() as { results?: any[] }
    return data.results?.[0]?.id != null ? String(data.results[0].id) : null
  } catch {
    return null
  }
}

/**
 * Popula temporadas e episódios de uma série a partir do TMDB.
 * `mode: 'watched'` marca todos os episódios já inseridos como não-assistidos por padrão,
 * apenas garante a estrutura. Não sobrescreve o estado `watched` existente.
 */
export async function enrichSeriesStructure(mediaItemId: number, tmdbId: string): Promise<boolean> {
  const key = apiKey('TMDB_API_KEY')
  if (!key || !tmdbId) return false
  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}`)
    if (!res.ok) return false
    const show = await res.json() as any
    const seasons: any[] = (show.seasons ?? []).filter((s: any) => s.season_number >= 1) // ignora especiais (0)
    if (!seasons.length) return false

    // grava o tmdb_id resolvido para futuras buscas de sinopse
    db.prepare(`UPDATE media_items SET tmdb_id = ?, updated_at = datetime('now') WHERE id = ? AND (tmdb_id IS NULL OR tmdb_id = '')`)
      .run(String(tmdbId), mediaItemId)

    for (const s of seasons) {
      const seasonNumber: number = s.season_number
      upsertSeason.run({
        media_item_id: mediaItemId,
        season_number: seasonNumber,
        title: s.name ?? `Temporada ${seasonNumber}`,
        episode_count: s.episode_count ?? 0,
      })

      // busca a lista de episódios da temporada
      try {
        const r = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${key}`)
        if (r.ok) {
          const sd = await r.json() as any
          const eps: any[] = sd.episodes ?? []
          const tx = db.transaction((list: any[]) => {
            for (const ep of list) {
              upsertEpisode.run({
                media_item_id: mediaItemId,
                season_number: seasonNumber,
                episode_number: ep.episode_number,
                title: ep.name ?? null,
              })
            }
          })
          tx(eps)
          // se a contagem oficial faltar, usa o tamanho da lista
          if (!s.episode_count && eps.length) {
            upsertSeason.run({ media_item_id: mediaItemId, season_number: seasonNumber, title: s.name ?? null, episode_count: eps.length })
          }
        }
      } catch { /* segue sem a lista detalhada da temporada */ }
    }
    recomputeSeriesStatus(mediaItemId)
    return true
  } catch {
    return false
  }
}

/* ─────────────────────────── preview (sem gravar no banco) ─────────────────────────── */

export interface PreviewEpisode { episode_number: number; title: string | null }
export interface PreviewSeason {
  season_number: number
  title: string | null
  episode_count: number
  episodes: PreviewEpisode[]
}
export interface SeriesPreview {
  tmdb_id: string
  total: number
  seasons: PreviewSeason[]
}

/**
 * Busca temporadas + episódios de uma série no TMDB SEM tocar no banco.
 * Usado pelo modal de adicionar mídia, onde a série ainda não existe na biblioteca.
 */
export async function fetchTmdbSeriesStructure(tmdbId: string): Promise<SeriesPreview | null> {
  const key = apiKey('TMDB_API_KEY')
  if (!key || !tmdbId) return null
  try {
    const res = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}?api_key=${key}`)
    if (!res.ok) return null
    const show = await res.json() as any
    const seasons: any[] = (show.seasons ?? []).filter((s: any) => s.season_number >= 1) // ignora especiais (0)
    if (!seasons.length) return null

    const out: PreviewSeason[] = []
    let total = 0
    for (const s of seasons) {
      const seasonNumber: number = s.season_number
      let episodes: PreviewEpisode[] = []
      try {
        const r = await fetch(`https://api.themoviedb.org/3/tv/${tmdbId}/season/${seasonNumber}?api_key=${key}`)
        if (r.ok) {
          const sd = await r.json() as any
          episodes = (sd.episodes ?? []).map((ep: any) => ({
            episode_number: ep.episode_number,
            title: ep.name ?? null,
          }))
        }
      } catch { /* segue sem a lista detalhada */ }
      const count = s.episode_count || episodes.length
      total += count
      out.push({ season_number: seasonNumber, title: s.name ?? `Temporada ${seasonNumber}`, episode_count: count, episodes })
    }
    return { tmdb_id: String(tmdbId), total, seasons: out }
  } catch {
    return null
  }
}

/**
 * Marca um lote de episódios como vistos numa série já existente e recomputa
 * o status uma única vez. Retorna quantos episódios foram marcados.
 */
export function markEpisodesWatched(
  mediaItemId: number,
  episodes: { season_number: number; episode_number: number }[],
  watchedAt?: string,
): number {
  const now = watchedAt ?? new Date().toISOString()
  const tx = db.transaction((list: { season_number: number; episode_number: number }[]) => {
    for (const e of list) {
      upsertSeason.run({ media_item_id: mediaItemId, season_number: e.season_number, title: null, episode_count: 0 })
      markEpisode.run({
        media_item_id: mediaItemId,
        season_number: e.season_number,
        episode_number: e.episode_number,
        title: null,
        watched: 1,
        watched_at: now,
      })
    }
  })
  tx(episodes)
  recomputeSeriesStatus(mediaItemId)
  return episodes.length
}

/**
 * Garante a estrutura da série. Resolve o tmdb_id (coluna, external_id numérico ou guid)
 * e enriquece via TMDB caso ainda não haja episódios registrados.
 */
export async function ensureSeriesStructure(mediaItemId: number, opts?: { guid?: string | null }): Promise<void> {
  const item = getItem.get(mediaItemId) as any
  if (!item || item.type !== 'series') return

  const already = db.prepare('SELECT COUNT(*) AS n FROM series_episodes WHERE media_item_id = ?').get(mediaItemId) as { n: number }
  if (already.n > 0) return // já estruturada

  let tmdbId: string | null =
    item.tmdb_id ||
    (/^\d+$/.test(item.external_id) ? item.external_id : null) ||
    tmdbIdFromGuid(opts?.guid) ||
    tmdbIdFromGuid(item.external_id)

  if (!tmdbId) tmdbId = await resolveTmdbSeriesId(item.title, item.year)
  if (tmdbId) await enrichSeriesStructure(mediaItemId, tmdbId)
}

/* ─────────────────────────── marcação de progresso ─────────────────────────── */

/** Marca (ou desmarca) um episódio e recomputa temporada/série. */
export function setEpisodeWatched(
  mediaItemId: number,
  seasonNumber: number,
  episodeNumber: number,
  watched: boolean,
  title?: string | null,
  watchedAt?: string,
): void {
  // garante que a temporada exista
  upsertSeason.run({ media_item_id: mediaItemId, season_number: seasonNumber, title: null, episode_count: 0 })
  markEpisode.run({
    media_item_id: mediaItemId,
    season_number: seasonNumber,
    episode_number: episodeNumber,
    title: title ?? null,
    watched: watched ? 1 : 0,
    watched_at: watched ? (watchedAt ?? new Date().toISOString()) : null,
  })
  recomputeSeriesStatus(mediaItemId)
}

/**
 * Recalcula status de cada temporada e da série:
 *  - temporada concluída quando todos os episódios conhecidos foram vistos;
 *  - série concluída quando todas as temporadas conhecidas foram concluídas.
 */
export function recomputeSeriesStatus(mediaItemId: number): void {
  const seasons = db.prepare('SELECT * FROM series_seasons WHERE media_item_id = ? ORDER BY season_number').all(mediaItemId) as any[]
  const now = new Date().toISOString()

  let allSeasonsDone = seasons.length > 0
  let anyWatched = false

  for (const s of seasons) {
    const watched = (db.prepare('SELECT COUNT(*) AS n FROM series_episodes WHERE media_item_id = ? AND season_number = ? AND watched = 1')
      .get(mediaItemId, s.season_number) as { n: number }).n

    if (watched > 0) anyWatched = true

    // Só conclui a temporada com a contagem AUTORITATIVA do TMDB (episode_count > 0).
    // Sem esse total, ver um episódio nunca conclui a temporada/série (evita o bug de
    // "1 episódio → série inteira concluída").
    const done = s.episode_count > 0 && watched >= s.episode_count
    if (!done) allSeasonsDone = false

    const newStatus = done ? 'completed' : watched > 0 ? 'in_progress' : 'in_progress'
    if (s.status !== newStatus || (done && !s.completed_at)) {
      db.prepare('UPDATE series_seasons SET status = ?, completed_at = ? WHERE id = ?')
        .run(newStatus, done ? (s.completed_at ?? now) : null, s.id)
    }
  }

  // atualiza a série
  const item = getItem.get(mediaItemId) as any
  if (!item) return
  let status = item.status
  let completedAt = item.completed_at

  if (allSeasonsDone) {
    status = 'completed'
    completedAt = completedAt ?? now
  } else if (anyWatched) {
    if (status === 'wishlist' || status === 'completed') status = 'in_progress'
    completedAt = null
  }

  if (status !== item.status || completedAt !== item.completed_at) {
    db.prepare(`UPDATE media_items SET status = ?, completed_at = ?, updated_at = datetime('now') WHERE id = ?`)
      .run(status, completedAt, mediaItemId)
  }
}

/* ─────────────────────────── leitura (API) ─────────────────────────── */

export interface SeasonView {
  season_number: number
  title: string | null
  status: string
  episode_count: number      // total conhecido (TMDB ou episódios registrados)
  watched_count: number
  episodes: {
    episode_number: number
    title: string | null
    watched: boolean
    watched_at: string | null
  }[]
}

export interface SeriesView {
  media_item_id: number
  total: number
  watched: number
  percent: number            // 0..1
  seasons: SeasonView[]
}

export function getSeriesView(mediaItemId: number): SeriesView {
  const seasons = db.prepare('SELECT * FROM series_seasons WHERE media_item_id = ? ORDER BY season_number').all(mediaItemId) as any[]
  const out: SeasonView[] = []
  // O progresso global só conta temporadas com total autoritativo (TMDB).
  let total = 0
  let watched = 0

  for (const s of seasons) {
    const eps = db.prepare('SELECT * FROM series_episodes WHERE media_item_id = ? AND season_number = ? ORDER BY episode_number')
      .all(mediaItemId, s.season_number) as any[]
    const w = eps.filter(e => e.watched === 1).length
    // Exibe o total do TMDB quando conhecido; senão, os episódios já catalogados.
    const displayTotal = s.episode_count > 0 ? s.episode_count : eps.length
    if (s.episode_count > 0) {
      total += s.episode_count
      watched += Math.min(w, s.episode_count)
    }
    out.push({
      season_number: s.season_number,
      title: s.title,
      status: s.status,
      episode_count: displayTotal,
      watched_count: w,
      episodes: eps.map(e => ({
        episode_number: e.episode_number,
        title: e.title,
        watched: e.watched === 1,
        watched_at: e.watched_at,
      })),
    })
  }

  return {
    media_item_id: mediaItemId,
    total,
    watched,
    percent: total > 0 ? Math.min(1, watched / total) : 0,
    seasons: out,
  }
}

/** Progresso resumido (0..1) por lista de ids — para os cards da biblioteca. */
export function seriesProgressMap(ids: number[]): Record<number, number> {
  const map: Record<number, number> = {}
  for (const id of ids) {
    const v = getSeriesView(id)
    map[id] = v.percent
  }
  return map
}
