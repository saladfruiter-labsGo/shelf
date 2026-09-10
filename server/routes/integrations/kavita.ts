import { Hono } from 'hono'
import { db } from '../../db.js'
import { cfg, setCfg } from '../../integrations/config.js'
import {
  kavitaRating,
  kavitaReadingStatus,
  type KavitaSeries,
  type KavitaState,
} from '../../integrations/kavita-domain.js'
import { notifyLibraryActivity } from '../../notify.js'

const app = new Hono()

const upsertBookProgress = db.prepare(`
  INSERT INTO media_items (external_id, type, title, cover_url, author, status, rating, pages_total, pages_read)
  VALUES (@external_id, 'book', @title, @cover_url, @author, @status, @rating, @pages_total, @pages_read)
  ON CONFLICT(external_id, type) DO UPDATE SET
    title       = COALESCE(media_items.title, excluded.title),
    cover_url   = COALESCE(media_items.cover_url, excluded.cover_url),
    author      = COALESCE(excluded.author, media_items.author),
    status      = CASE WHEN media_items.status = 'completed' AND excluded.status = 'in_progress'
                       THEN media_items.status ELSE excluded.status END,
    rating      = CASE WHEN excluded.rating > 0 THEN excluded.rating ELSE media_items.rating END,
    pages_total = excluded.pages_total,
    pages_read  = excluded.pages_read,
    updated_at  = datetime('now')
`)
const completeBook = db.prepare(`
  UPDATE media_items SET status = 'completed',
    completed_at = COALESCE(completed_at, @completed_at),
    updated_at = datetime('now')
  WHERE external_id = @external_id AND type = 'book'
`)
const getBook = db.prepare("SELECT id, author, rating FROM media_items WHERE external_id = ? AND type = 'book'")
const setBookRating = db.prepare(`
  UPDATE media_items SET rating = ?, updated_at = datetime('now')
  WHERE external_id = ? AND type = 'book'
`)
const insertDiary = db.prepare(`
  INSERT INTO diary_entries (media_item_id, watched_at, rating, comment, source)
  VALUES (?, ?, ?, NULL, 'kavita')
`)
const insertActivity = db.prepare(`
  INSERT OR IGNORE INTO activity_events
    (source, event_type, media_type, external_ref, title, subtitle, cover_url, rating, duration_ms, genre, occurred_at, raw)
  VALUES ('kavita', @event_type, 'book', @external_ref, @title, @subtitle, @cover_url, @rating, NULL, NULL, @occurred_at, NULL)
`)

let token: string | null = null

export function resetKavitaAuth(): void {
  token = null
}

function readState(): KavitaState {
  try { return JSON.parse(cfg('KAVITA_STATE') || '{}') as KavitaState } catch { return {} }
}

function writeState(state: KavitaState): void {
  setCfg('KAVITA_STATE', JSON.stringify(state))
}

function baseUrl(): string {
  return cfg('KAVITA_URL').replace(/\/$/, '')
}

async function authenticate(): Promise<boolean> {
  const base = baseUrl()
  const apiKey = cfg('KAVITA_API_KEY')
  if (!base || !apiKey) { token = null; return false }
  try {
    const response = await fetch(
      `${base}/api/Plugin/authenticate?apiKey=${encodeURIComponent(apiKey)}&pluginName=Shelf`,
      { method: 'POST', headers: { Accept: 'application/json' } },
    )
    if (!response.ok) { token = null; return false }
    token = ((await response.json()) as { token?: string }).token ?? null
    return Boolean(token)
  } catch {
    token = null
    return false
  }
}

async function kavitaFetch(path: string, init: RequestInit = {}, retry = true): Promise<Response | null> {
  if (!token && !(await authenticate())) return null
  const headers = {
    ...(init.headers ?? {}),
    Authorization: `Bearer ${token}`,
    Accept: (init.headers as Record<string, string> | undefined)?.Accept ?? 'application/json',
  }
  let response: Response
  try { response = await fetch(`${baseUrl()}${path}`, { ...init, headers }) } catch { return null }
  if (response.status === 401 && retry) {
    token = null
    if (await authenticate()) return kavitaFetch(path, init, false)
    return null
  }
  return response
}

async function allSeries(): Promise<KavitaSeries[]> {
  const result: KavitaSeries[] = []
  const pageSize = 200
  for (let page = 1; page <= 25; page++) {
    const response = await kavitaFetch(`/api/Series/all-v2?PageNumber=${page}&PageSize=${pageSize}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
    })
    if (!response?.ok) break
    let entries: KavitaSeries[]
    try { entries = (await response.json()) as KavitaSeries[] } catch { break }
    if (!Array.isArray(entries) || entries.length === 0) break
    result.push(...entries)
    if (entries.length < pageSize) break
  }
  return result
}

async function authorFor(seriesId: number): Promise<string | null> {
  const response = await kavitaFetch(`/api/Series/metadata?seriesId=${seriesId}`)
  if (!response?.ok) return null
  try {
    return ((await response.json()) as { writers?: { name: string }[] }).writers?.[0]?.name ?? null
  } catch {
    return null
  }
}

export async function pollKavita(): Promise<void> {
  if (cfg('KAVITA_ENABLED') !== '1' || !cfg('KAVITA_URL') || !cfg('KAVITA_API_KEY')) return
  const libraryFilter = cfg('KAVITA_LIBRARY_ID').trim()
  const series = await allSeries()
  if (!series.length) return

  const state = readState()
  for (const entry of series) {
    if (libraryFilter && String(entry.libraryId) !== libraryFilter) continue
    const pages = entry.pages ?? 0
    const pagesRead = entry.pagesRead ?? 0
    if (pagesRead <= 0) continue

    const status = kavitaReadingStatus(pages, pagesRead)
    const rating = kavitaRating(entry)
    const externalId = `kavita:${entry.id}`
    const now = new Date().toISOString()
    const occurredAt = entry.latestReadDate
      ? new Date(entry.latestReadDate + (entry.latestReadDate.includes('Z') ? '' : 'Z')).toISOString()
      : now
    const coverUrl = `/api/integrations/kavita/image?seriesId=${entry.id}`

    const existing = getBook.get(externalId) as { id: number; author: string | null; rating: number } | undefined
    let author = existing?.author ?? null
    if (!author) author = await authorFor(entry.id)
    upsertBookProgress.run({
      external_id: externalId,
      title: entry.name,
      cover_url: coverUrl,
      author,
      status,
      rating,
      pages_total: pages || null,
      pages_read: pagesRead,
    })
    const book = getBook.get(externalId) as { id: number; author: string | null; rating: number } | undefined
    if (!book) continue

    const previous = state[String(entry.id)]
    if (status === 'completed') {
      completeBook.run({ external_id: externalId, completed_at: occurredAt })
      if (previous?.status !== 'completed') {
        insertActivity.run({
          event_type: 'read', external_ref: externalId, title: entry.name, subtitle: author,
          cover_url: coverUrl, rating: rating || null, occurred_at: occurredAt,
        })
        insertDiary.run(book.id, occurredAt, rating || null)
        notifyLibraryActivity({ event: 'completed', type: 'book', title: entry.name, rating: book.rating || null, mediaItemId: book.id })
      }
    } else if (!previous) {
      insertActivity.run({
        event_type: 'reading', external_ref: externalId, title: entry.name, subtitle: author,
        cover_url: coverUrl, rating: null, occurred_at: occurredAt,
      })
      notifyLibraryActivity({ event: 'in_progress', type: 'book', title: entry.name })
    }

    if (rating > 0 && previous && previous.rating !== rating) {
      setBookRating.run(rating, externalId)
      insertActivity.run({
        event_type: 'rate', external_ref: externalId, title: entry.name, subtitle: author,
        cover_url: coverUrl, rating, occurred_at: now,
      })
      notifyLibraryActivity({ event: 'rated', type: 'book', title: entry.name, rating })
    }

    state[String(entry.id)] = { status, pagesRead, rating }
  }
  writeState(state)
}

app.get('/kavita/image', async (c) => {
  const seriesId = c.req.query('seriesId')
  if (!seriesId || !/^\d+$/.test(seriesId)) return c.body(null, 404)
  const response = await kavitaFetch(`/api/Image/series-cover?seriesId=${seriesId}`, {
    headers: { Accept: 'image/*' },
  })
  if (!response?.ok) return c.body(null, 502)
  return c.body(await response.arrayBuffer(), 200, {
    'Content-Type': response.headers.get('content-type') ?? 'image/jpeg',
    'Cache-Control': 'public, max-age=86400',
  })
})

app.post('/kavita/sync', async (c) => {
  await pollKavita()
  return c.json({ ok: true })
})

app.post('/kavita/test', async (c) => {
  if (!cfg('KAVITA_URL') || !cfg('KAVITA_API_KEY')) {
    return c.json({ ok: false, error: 'Configure a URL e a API key primeiro (salve antes de testar).' }, 400)
  }
  resetKavitaAuth()
  if (!(await authenticate())) {
    return c.json({ ok: false, error: 'Falha na autenticação. Verifique a URL e a API key.' }, 400)
  }
  const response = await kavitaFetch('/api/Series/all-v2?PageNumber=1&PageSize=1', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  })
  if (!response?.ok) {
    return c.json({ ok: false, error: 'Autenticou, mas não consegui listar séries (all-v2 falhou).' }, 400)
  }
  return c.json({ ok: true })
})

export default app
