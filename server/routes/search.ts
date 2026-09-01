import { Hono } from 'hono'
import { db } from '../db.js'

const app = new Hono()

function apiKey(name: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(name) as { value: string } | undefined
  return row?.value?.trim() || process.env[name]
}

app.get('/', async (c) => {
  const q    = c.req.query('q')?.trim()
  const type = c.req.query('type')
  if (!q) return c.json({ results: [] })

  const tasks: Promise<SearchResult[]>[] = []
  if (!type || type === 'movie')  tasks.push(searchMovies(q))
  if (!type || type === 'series') tasks.push(searchSeries(q))
  if (!type || type === 'game')   tasks.push(searchGames(q))
  if (!type || type === 'book')   tasks.push(searchBooks(q))

  const all = (await Promise.allSettled(tasks))
    .filter((r): r is PromiseFulfilledResult<SearchResult[]> => r.status === 'fulfilled')
    .flatMap(r => r.value)

  return c.json({ results: all })
})

export interface SearchResult {
  external_id:  string
  type:         'movie' | 'series' | 'game' | 'book'
  title:        string
  cover_url:    string | null
  year:         number | null
  genre:        string | null
  author:       string | null
  release_date: string | null
}

async function searchMovies(q: string): Promise<SearchResult[]> {
  const key = apiKey('TMDB_API_KEY')
  if (!key) return []
  const res = await fetch(`https://api.themoviedb.org/3/search/movie?api_key=${key}&query=${encodeURIComponent(q)}&page=1`)
  if (!res.ok) return []
  const data = await res.json() as { results: any[] }
  return data.results.slice(0, 8).map(m => ({
    external_id:  String(m.id),
    type:         'movie',
    title:        m.title,
    cover_url:    m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
    year:         m.release_date ? parseInt(m.release_date) : null,
    genre:        null,
    author:       null,
    release_date: m.release_date ?? null,
  }))
}

async function searchSeries(q: string): Promise<SearchResult[]> {
  const key = apiKey('TMDB_API_KEY')
  if (!key) return []
  const res = await fetch(`https://api.themoviedb.org/3/search/tv?api_key=${key}&query=${encodeURIComponent(q)}&page=1`)
  if (!res.ok) return []
  const data = await res.json() as { results: any[] }
  return data.results.slice(0, 8).map(m => ({
    external_id:  String(m.id),
    type:         'series',
    title:        m.name,
    cover_url:    m.poster_path ? `https://image.tmdb.org/t/p/w300${m.poster_path}` : null,
    year:         m.first_air_date ? parseInt(m.first_air_date) : null,
    genre:        null,
    author:       null,
    release_date: m.first_air_date ?? null,
  }))
}

async function searchGames(q: string): Promise<SearchResult[]> {
  const key = apiKey('RAWG_API_KEY')
  if (!key) return []
  const res = await fetch(`https://api.rawg.io/api/games?key=${key}&search=${encodeURIComponent(q)}&page_size=8`)
  if (!res.ok) return []
  const data = await res.json() as { results: any[] }
  return data.results.slice(0, 8).map(g => ({
    external_id:  String(g.id),
    type:         'game',
    title:        g.name,
    cover_url:    g.background_image ?? null,
    year:         g.released ? parseInt(g.released) : null,
    genre:        g.genres?.[0]?.name ?? null,
    author:       null,
    release_date: g.released ?? null,
  }))
}

async function searchBooks(q: string): Promise<SearchResult[]> {
  const key      = apiKey('GOOGLE_BOOKS_KEY')
  const keyParam = key ? `&key=${key}` : ''
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(q)}&maxResults=8${keyParam}`)
  if (!res.ok) return []
  const data = await res.json() as { items?: any[] }
  return (data.items ?? []).slice(0, 8).map(b => {
    const info = b.volumeInfo ?? {}
    return {
      external_id:  b.id,
      type:         'book',
      title:        info.title,
      cover_url:    info.imageLinks?.thumbnail?.replace('http://', 'https://') ?? null,
      year:         info.publishedDate ? parseInt(info.publishedDate) : null,
      genre:        info.categories?.[0] ?? null,
      author:       (info.authors ?? []).join(', ') || null,
      release_date: info.publishedDate ?? null,
    }
  })
}

export default app
