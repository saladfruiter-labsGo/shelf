import { tmdbIdFromGuid, type PlexMediaFileMetadata } from '../plex.js'

export interface PlexLibraryItem extends PlexMediaFileMetadata {
  guid?: string
  Guid?: { id?: string }[]
  ratingKey?: string
  title?: string
  year?: number
}

export interface PlexLibrarySection {
  key?: string
  type?: string
}

export interface ShelfMovie {
  id: number
  external_id: string
  tmdb_id: string | null
  title: string
  year: number | null
}

export function plexExternalIds(item: PlexLibraryItem): string[] {
  return [item.guid, ...(item.Guid ?? []).map(guid => guid.id)]
    .filter((id): id is string => typeof id === 'string' && id.length > 0)
}

export function normalizedPlexTitle(title: string): string {
  return title.trim().toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ')
}

export function addPlexMovieToIndex(
  index: Map<string, ShelfMovie[]>,
  key: string | null | undefined,
  movie: ShelfMovie,
): void {
  if (!key) return
  const rows = index.get(key) ?? []
  rows.push(movie)
  index.set(key, rows)
}

export function moviesForPlexItem(
  item: PlexLibraryItem,
  byExternalId: Map<string, ShelfMovie[]>,
  byTmdbId: Map<string, ShelfMovie[]>,
  byTitleYear: Map<string, ShelfMovie[]>,
): ShelfMovie[] {
  const exact = new Map<number, ShelfMovie>()
  for (const id of plexExternalIds(item)) {
    for (const movie of byExternalId.get(id) ?? []) exact.set(movie.id, movie)
  }
  if (item.ratingKey) {
    for (const movie of byExternalId.get(`plex:${item.ratingKey}`) ?? []) exact.set(movie.id, movie)
  }
  if (exact.size > 0) return [...exact.values()]

  const tmdbIds = plexExternalIds(item)
    .map(id => tmdbIdFromGuid(id))
    .filter((id): id is string => id != null)
  const byTmdb = new Map<number, ShelfMovie>()
  for (const id of tmdbIds) {
    for (const movie of byTmdbId.get(id) ?? []) byTmdb.set(movie.id, movie)
  }
  if (byTmdb.size > 0) return [...byTmdb.values()]

  if (!item.title) return []
  const key = `${normalizedPlexTitle(item.title)}::${item.year ?? ''}`
  const titleMatches = byTitleYear.get(key) ?? []
  return titleMatches.length === 1 ? titleMatches : []
}
