import { db } from './db.js'

export type TmdbMediaType = 'movie' | 'series'

export interface TmdbMediaDetails {
  tmdb_id:      string
  type:         TmdbMediaType
  title:        string
  cover_url:    string | null
  year:         number | null
  genre:        string | null
  runtime:      number | null
  synopsis:     string | null
  creators:     string | null
  author:       null
  release_date: string | null
}

const readSetting = db.prepare('SELECT value FROM settings WHERE key = ?')

function apiKey(): string | undefined {
  const row = readSetting.get('TMDB_API_KEY') as { value: string } | undefined
  return row?.value?.trim() || process.env.TMDB_API_KEY
}

function yearFromDate(date: unknown): number | null {
  if (typeof date !== 'string') return null
  const year = Number.parseInt(date.slice(0, 4), 10)
  return Number.isFinite(year) ? year : null
}

/** Busca e normaliza os metadados completos de um filme ou série no TMDB. */
export async function fetchTmdbMediaDetails(type: TmdbMediaType, tmdbId: string): Promise<TmdbMediaDetails | null> {
  const key = apiKey()
  if (!key || !tmdbId) return null

  const endpoint = type === 'movie' ? 'movie' : 'tv'
  const params = new URLSearchParams({ api_key: key, append_to_response: 'credits' })
  const response = await fetch(`https://api.themoviedb.org/3/${endpoint}/${encodeURIComponent(tmdbId)}?${params}`)
  if (!response.ok) return null

  const data = await response.json() as any
  const title = type === 'movie' ? data.title : data.name
  if (typeof title !== 'string' || !title.trim()) return null

  const releaseDate = type === 'movie' ? data.release_date : data.first_air_date
  const creators = type === 'movie'
    ? (data.credits?.crew ?? []).filter((person: any) => person.job === 'Director').map((person: any) => person.name)
    : (data.created_by ?? []).map((person: any) => person.name)

  return {
    tmdb_id: String(data.id ?? tmdbId),
    type,
    title,
    cover_url: data.poster_path ? `https://image.tmdb.org/t/p/w500${data.poster_path}` : null,
    year: yearFromDate(releaseDate),
    genre: (data.genres ?? []).map((genre: any) => genre.name).filter(Boolean).join(', ') || null,
    runtime: type === 'movie' ? (data.runtime ?? null) : (data.episode_run_time?.[0] ?? null),
    synopsis: data.overview || null,
    creators: creators.filter(Boolean).join(', ') || null,
    author: null,
    release_date: releaseDate || null,
  }
}
