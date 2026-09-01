import { Hono } from 'hono'
import { db } from '../db.js'

const app = new Hono()

function apiKey(name: string): string | undefined {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get(name) as { value: string } | undefined
  return row?.value?.trim() || process.env[name]
}

interface Details {
  synopsis: string | null
  creators: string | null
  author:   string | null
}

async function fetchMovieDetails(id: string): Promise<Details> {
  const key = apiKey('TMDB_API_KEY')
  if (!key) return { synopsis: null, creators: null, author: null }
  const res = await fetch(`https://api.themoviedb.org/3/movie/${id}?api_key=${key}&append_to_response=credits`)
  if (!res.ok) return { synopsis: null, creators: null, author: null }
  const d = await res.json() as any
  const directors = (d.credits?.crew ?? []).filter((p: any) => p.job === 'Director').map((p: any) => p.name)
  return { synopsis: d.overview || null, creators: directors.join(', ') || null, author: null }
}

async function fetchSeriesDetails(id: string): Promise<Details> {
  const key = apiKey('TMDB_API_KEY')
  if (!key) return { synopsis: null, creators: null, author: null }
  const res = await fetch(`https://api.themoviedb.org/3/tv/${id}?api_key=${key}`)
  if (!res.ok) return { synopsis: null, creators: null, author: null }
  const d = await res.json() as any
  const creators = (d.created_by ?? []).map((p: any) => p.name).join(', ')
  return { synopsis: d.overview || null, creators: creators || null, author: null }
}

async function fetchGameDetails(id: string): Promise<Details> {
  const key = apiKey('RAWG_API_KEY')
  if (!key) return { synopsis: null, creators: null, author: null }
  const res = await fetch(`https://api.rawg.io/api/games/${id}?key=${key}`)
  if (!res.ok) return { synopsis: null, creators: null, author: null }
  const d = await res.json() as any
  const devs = (d.developers ?? []).map((v: any) => v.name).join(', ')
  const raw = d.description_raw ?? d.description ?? ''
  const synopsis = raw.replace(/<[^>]+>/g, '').slice(0, 800) || null
  return { synopsis, creators: devs || null, author: null }
}

async function fetchBookDetails(id: string): Promise<Details> {
  const key = apiKey('GOOGLE_BOOKS_KEY')
  const keyParam = key ? `?key=${key}` : ''
  const res = await fetch(`https://www.googleapis.com/books/v1/volumes/${id}${keyParam}`)
  if (!res.ok) return { synopsis: null, creators: null, author: null }
  const d = await res.json() as any
  const info = d.volumeInfo ?? {}
  const synopsis = (info.description ?? '').replace(/<[^>]+>/g, '').slice(0, 800) || null
  const author  = (info.authors ?? []).join(', ') || null
  const publisher = info.publisher || null
  return { synopsis, creators: publisher, author }
}

app.get('/:type/:external_id', async (c) => {
  const type       = c.req.param('type')
  const externalId = c.req.param('external_id')

  const item = db.prepare('SELECT * FROM media_items WHERE type = ? AND external_id = ?').get(type, externalId) as any

  // Return cached if available
  if (item?.synopsis) {
    return c.json({ synopsis: item.synopsis, creators: item.creators, author: item.author })
  }

  const fetchers: Record<string, (id: string) => Promise<Details>> = {
    movie:  fetchMovieDetails,
    series: fetchSeriesDetails,
    game:   fetchGameDetails,
    book:   fetchBookDetails,
  }

  const fetcher = fetchers[type]
  if (!fetcher) return c.json({ synopsis: null, creators: null, author: null })

  let details: Details = { synopsis: null, creators: null, author: null }
  try {
    details = await fetcher(externalId)
  } catch {}

  if (item && (details.synopsis || details.creators || details.author)) {
    db.prepare(`
      UPDATE media_items
      SET synopsis = ?, creators = ?, author = ?, updated_at = datetime('now')
      WHERE id = ?
    `).run(details.synopsis, details.creators, details.author, item.id)
  }

  return c.json(details)
})

export default app
