import { Hono } from 'hono'
import { db } from '../db.js'

const app = new Hono()

function apiKey(name: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(name) as { value: string } | undefined
  return row?.value?.trim() || process.env[name]
}

const TMDB_BASE = 'https://api.themoviedb.org/3'
const RAWG_BASE = 'https://api.rawg.io/api'
const GBOOKS_BASE = 'https://www.googleapis.com/books/v1'

app.get('/', async (c) => {
  const q = c.req.query('q')?.trim()
  const type = c.req.query('type') // movie | series | game | book | (empty = all)

  if (!q) return c.json({ results: [] })

  const tasks: Promise<SearchResult[]>[] = []

  if (!type || type === 'movie')  tasks.push(searchMovies(q))
  if (!type || type === 'series') tasks.push(searchSeries(q))
  if (!type || type === 'game')   tasks.push(searchGames(q))
  if (!type || type === 'book')   tasks.push(searchBooks(q))

  const all = (await Promise.allSettled(tasks))
    .filter((r): r is PromiseFulfilledResult<SearchResult[]> => r.status === 'fulfilled')
    .flatMap((r) => r.value)

  return c.json({ results: all })
})

export interface SearchResult {
  external_id: string
  type: 'movie' | 'series' | 'game' | 'book'
  title: string
  cover_url: string | null
  year: number | null
  genre: string | null
}

async function searchMovies(q: string): Promise<SearchResult[]> {
  const key = apiKey('TMDB_API_KEY')
  if (!key) return []
  const url = `${TMDB_BASE}/search/movie?api_key=${key}&query=${encodeURIComponent(q)}&page=1`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = (await res.json()) as { results: TmdbMovie[] }
  return data.results.slice(0, 8).map((m) => ({
    external_id: String(m.id),
    type: 'movie',
    title: m.title,
    cover_url: m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
    year: m.release_date ? parseInt(m.release_date) : null,
    genre: null,
  }))
}

async function searchSeries(q: string): Promise<SearchResult[]> {
  const key = apiKey('TMDB_API_KEY')
  if (!key) return []
  const url = `${TMDB_BASE}/search/tv?api_key=${key}&query=${encodeURIComponent(q)}&page=1`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = (await res.json()) as { results: TmdbTv[] }
  return data.results.slice(0, 8).map((m) => ({
    external_id: String(m.id),
    type: 'series',
    title: m.name,
    cover_url: m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
    year: m.first_air_date ? parseInt(m.first_air_date) : null,
    genre: null,
  }))
}

async function searchGames(q: string): Promise<SearchResult[]> {
  const key = apiKey('RAWG_API_KEY')
  if (!key) return []
  const url = `${RAWG_BASE}/games?key=${key}&search=${encodeURIComponent(q)}&page_size=8`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = (await res.json()) as { results: RawgGame[] }
  return data.results.slice(0, 8).map((g) => ({
    external_id: String(g.id),
    type: 'game',
    title: g.name,
    cover_url: g.background_image ?? null,
    year: g.released ? parseInt(g.released) : null,
    genre: g.genres?.[0]?.name ?? null,
  }))
}

async function searchBooks(q: string): Promise<SearchResult[]> {
  const key = apiKey('GOOGLE_BOOKS_KEY')
  const keyParam = key ? `&key=${key}` : ''
  const url = `${GBOOKS_BASE}/volumes?q=${encodeURIComponent(q)}&maxResults=8${keyParam}`
  const res = await fetch(url)
  if (!res.ok) return []
  const data = (await res.json()) as { items?: GBookItem[] }
  return (data.items ?? []).slice(0, 8).map((b) => ({
    external_id: b.id,
    type: 'book',
    title: b.volumeInfo.title,
    cover_url: b.volumeInfo.imageLinks?.thumbnail?.replace('http://', 'https://') ?? null,
    year: b.volumeInfo.publishedDate ? parseInt(b.volumeInfo.publishedDate) : null,
    genre: b.volumeInfo.categories?.[0] ?? null,
  }))
}

interface TmdbMovie { id: number; title: string; poster_path: string | null; release_date: string }
interface TmdbTv    { id: number; name: string;  poster_path: string | null; first_air_date: string }
interface RawgGame  { id: number; name: string;  background_image: string | null; released: string; genres: { name: string }[] }
interface GBookItem { id: string; volumeInfo: { title: string; publishedDate: string; categories?: string[]; imageLinks?: { thumbnail: string } } }

export default app
