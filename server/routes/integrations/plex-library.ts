import { Hono } from 'hono'
import { db } from '../../db.js'
import { cfg } from '../../integrations/config.js'
import {
  addPlexMovieToIndex,
  moviesForPlexItem,
  normalizedPlexTitle,
  type PlexLibraryItem,
  type PlexLibrarySection,
  type ShelfMovie,
} from '../../integrations/plex-library-domain.js'
import { originalFilenameFromPlex } from '../../plex.js'

const app = new Hono()

function plexLibraryUrl(pathname: string): string {
  return `${cfg('PLEX_URL').replace(/\/$/, '')}${pathname}`
}

async function fetchPlexJson<T>(pathname: string): Promise<T> {
  const response = await fetch(plexLibraryUrl(pathname), {
    headers: { 'X-Plex-Token': cfg('PLEX_TOKEN'), Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`Plex respondeu ${response.status}`)
  return await response.json() as T
}

async function fetchAllPlexMovies(sections: PlexLibrarySection[]): Promise<PlexLibraryItem[]> {
  const movies: PlexLibraryItem[] = []
  const seen = new Set<string>()
  const pageSize = 500

  for (const section of sections) {
    if (!section.key) continue
    for (let start = 0; ; start += pageSize) {
      const query = new URLSearchParams({
        type: '1',
        'X-Plex-Container-Start': String(start),
        'X-Plex-Container-Size': String(pageSize),
      })
      const data = await fetchPlexJson<{
        MediaContainer?: { Metadata?: PlexLibraryItem[]; totalSize?: number }
      }>(`/library/sections/${encodeURIComponent(section.key)}/all?${query}`)
      const page = data.MediaContainer?.Metadata ?? []
      const countBefore = movies.length
      for (const item of page) {
        const identity = item.ratingKey ?? item.guid ?? `${item.title ?? ''}:${item.year ?? ''}`
        if (!seen.has(identity)) {
          seen.add(identity)
          movies.push(item)
        }
      }

      const totalSize = data.MediaContainer?.totalSize
      if (
        page.length < pageSize ||
        movies.length === countBefore ||
        (totalSize != null && start + page.length >= totalSize)
      ) break
    }
  }
  return movies
}

app.post('/plex/sync-files', async (context) => {
  const url = cfg('PLEX_URL')
  const token = cfg('PLEX_TOKEN')
  if (!url || !token) {
    return context.json({ error: 'Configure a URL e o token do Plex antes de sincronizar' }, 400)
  }

  try {
    const sectionsResponse = await fetchPlexJson<{
      MediaContainer?: { Directory?: PlexLibrarySection[] }
    }>('/library/sections')
    const sections = (sectionsResponse.MediaContainer?.Directory ?? [])
      .filter(section => section.type === 'movie')
    const plexMovies = await fetchAllPlexMovies(sections)
    const shelfMovies = db.prepare(
      "SELECT id, external_id, tmdb_id, title, year FROM media_items WHERE type = 'movie'",
    ).all() as ShelfMovie[]

    const byExternalId = new Map<string, ShelfMovie[]>()
    const byTmdbId = new Map<string, ShelfMovie[]>()
    const byTitleYear = new Map<string, ShelfMovie[]>()
    for (const movie of shelfMovies) {
      addPlexMovieToIndex(byExternalId, movie.external_id, movie)
      addPlexMovieToIndex(byTmdbId, movie.tmdb_id, movie)
      if (/^[1-9]\d*$/.test(movie.external_id)) {
        addPlexMovieToIndex(byTmdbId, movie.external_id, movie)
      }
      addPlexMovieToIndex(
        byTitleYear,
        `${normalizedPlexTitle(movie.title)}::${movie.year ?? ''}`,
        movie,
      )
    }

    const updateFilename = db.prepare(`
      UPDATE media_items SET original_filename = ?, updated_at = datetime('now')
      WHERE id = ? AND (original_filename IS NULL OR original_filename != ?)
    `)
    const result = {
      sections: sections.length,
      scanned: plexMovies.length,
      matched: 0,
      updated: 0,
      without_file: 0,
      unmatched: 0,
    }
    const matchedIds = new Set<number>()

    db.transaction(() => {
      for (const plexMovie of plexMovies) {
        const filename = originalFilenameFromPlex(plexMovie)
        if (!filename) {
          result.without_file++
          continue
        }

        const matches = moviesForPlexItem(plexMovie, byExternalId, byTmdbId, byTitleYear)
        if (matches.length === 0) {
          result.unmatched++
          continue
        }
        for (const movie of matches) {
          matchedIds.add(movie.id)
          result.updated += Number(updateFilename.run(filename, movie.id, filename).changes)
        }
      }
    })()
    result.matched = matchedIds.size
    return context.json(result)
  } catch (error) {
    return context.json({ error: `Não foi possível consultar o Plex: ${(error as Error).message}` }, 502)
  }
})

export default app
