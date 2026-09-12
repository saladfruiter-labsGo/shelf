import { Hono } from 'hono'
import { db } from '../../db.js'
import { cfg, ensureSecret } from '../../integrations/config.js'
import {
  mapPlexMetadata,
  originalFilenameFromPlex,
  plexEventOccurredAt,
  tmdbIdFromGuid,
  type PlexMeta,
} from '../../plex.js'
import { applyQuickRating, isQuickRating } from '../../quick-rating.js'
import {
  ensureSeriesStructure,
  resolveTmdbMovieId,
  resolveTmdbSeriesId,
  setEpisodeWatched,
} from '../../series.js'

interface PlexPayload {
  event?: string
  Account?: { title?: string }
  Metadata?: PlexMeta
}

const app = new Hono()

const insertActivity = db.prepare(`
  INSERT OR IGNORE INTO activity_events
    (source, event_type, media_type, external_ref, title, subtitle, cover_url, rating, duration_ms, genre, occurred_at, raw)
  VALUES ('plex', @event_type, @media_type, @external_ref, @title, @subtitle, @cover_url, @rating, @duration_ms, NULL, @occurred_at, @raw)
`)
const upsertMediaItem = db.prepare(`
  INSERT INTO media_items (external_id, type, title, cover_url, year, author, status, rating, completed_at, original_filename)
  VALUES (@external_id, @type, @title, @cover_url, @year, @author, 'completed', @rating, @completed_at, @original_filename)
  ON CONFLICT(external_id, type) DO UPDATE SET
    status       = 'completed',
    completed_at = COALESCE(media_items.completed_at, excluded.completed_at),
    author       = COALESCE(media_items.author, excluded.author),
    cover_url    = COALESCE(media_items.cover_url, excluded.cover_url),
    original_filename = COALESCE(media_items.original_filename, excluded.original_filename),
    rating       = CASE WHEN excluded.rating > 0 THEN excluded.rating ELSE media_items.rating END,
    updated_at   = datetime('now')
`)
const setMediaRating = db.prepare(`
  UPDATE media_items SET rating = ?, updated_at = datetime('now')
  WHERE external_id = ? AND type = ?
`)
const upsertSeriesShow = db.prepare(`
  INSERT INTO media_items (external_id, type, title, cover_url, year, tmdb_id, status)
  VALUES (@external_id, 'series', @title, @cover_url, @year, @tmdb_id, 'in_progress')
  ON CONFLICT(external_id, type) DO UPDATE SET
    title      = COALESCE(media_items.title, excluded.title),
    cover_url  = COALESCE(media_items.cover_url, excluded.cover_url),
    year       = COALESCE(media_items.year, excluded.year),
    tmdb_id    = COALESCE(media_items.tmdb_id, excluded.tmdb_id),
    updated_at = datetime('now')
`)
const getMediaId = db.prepare('SELECT id FROM media_items WHERE external_id = ? AND type = ?')
const findSeriesByTmdb = db.prepare(
  "SELECT id FROM media_items WHERE type = 'series' AND (tmdb_id = @tmdb OR external_id = @tmdb) LIMIT 1",
)
const backfillSeriesMeta = db.prepare(`
  UPDATE media_items SET
    tmdb_id = COALESCE(tmdb_id, @tmdb), cover_url = COALESCE(cover_url, @cover_url),
    year = COALESCE(year, @year), updated_at = datetime('now')
  WHERE id = @id
`)
const findMovieByTmdb = db.prepare(
  "SELECT id FROM media_items WHERE type = 'movie' AND (tmdb_id = @tmdb OR external_id = @tmdb) LIMIT 1",
)
const backfillMovieMeta = db.prepare(`
  UPDATE media_items SET
    tmdb_id = COALESCE(tmdb_id, @tmdb), cover_url = COALESCE(cover_url, @cover_url),
    year = COALESCE(year, @year),
    original_filename = COALESCE(original_filename, @original_filename),
    updated_at = datetime('now')
  WHERE id = @id
`)
const completeMovieById = db.prepare(`
  UPDATE media_items SET status = 'completed',
    completed_at = COALESCE(completed_at, @completed_at), updated_at = datetime('now')
  WHERE id = @id
`)
const setMediaRatingById = db.prepare(
  "UPDATE media_items SET rating = @rating, updated_at = datetime('now') WHERE id = @id",
)
// Um registro de episódio é um registro DE EPISÓDIO: temporada e episódio vão
// para suas colunas, nunca para o comentário (que pertence ao usuário).
const insertDiaryEntry = db.prepare(`
  INSERT INTO diary_entries
    (media_item_id, watched_at, rating, comment, source, season_number, episode_number)
  SELECT @media_item_id, @watched_at, @rating, NULL, 'plex', @season_number, @episode_number
  WHERE NOT EXISTS (
    SELECT 1 FROM diary_entries
    WHERE media_item_id = @media_item_id AND watched_at = @watched_at
      AND source = 'plex'
      AND season_number IS @season_number
      AND episode_number IS @episode_number
  )
`)
// O Plex conclui antes de o usuário dar a nota: o `media.rate` que chega depois
// completa o registro de episódio mais recente que ficou sem avaliação.
const rateEpisodeDiary = db.prepare(`
  UPDATE diary_entries SET rating = @rating
  WHERE id = (
    SELECT id FROM diary_entries
    WHERE media_item_id = @media_item_id
      AND season_number = @season_number AND episode_number = @episode_number
      AND (rating IS NULL OR rating <= 0)
    ORDER BY watched_at DESC, id DESC
    LIMIT 1
  )
`)

export function ensurePlexWebhookSecret(): string {
  return ensureSecret('PLEX_WEBHOOK_SECRET')
}

function slugify(value: string): string {
  return value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

async function tmdbIdFromPlexRatingKey(ratingKey?: string): Promise<string | null> {
  const url = cfg('PLEX_URL')
  const token = cfg('PLEX_TOKEN')
  if (!ratingKey || !url || !token) return null
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/library/metadata/${ratingKey}`, {
      headers: { 'X-Plex-Token': token, Accept: 'application/json' },
    })
    if (!response.ok) return null
    const data = await response.json() as {
      MediaContainer?: { Metadata?: { Guid?: { id?: string }[] }[] }
    }
    for (const guid of data.MediaContainer?.Metadata?.[0]?.Guid ?? []) {
      const id = tmdbIdFromGuid(guid.id)
      if (id) return id
    }
  } catch { /* tenta os fallbacks do chamador */ }
  return null
}

async function findPlexSeriesId(meta: PlexMeta): Promise<number | null> {
  let tmdbId = tmdbIdFromGuid(meta.grandparentGuid)
  if (!tmdbId) tmdbId = await tmdbIdFromPlexRatingKey(meta.grandparentRatingKey)
  if (tmdbId) {
    const series = findSeriesByTmdb.get({ tmdb: tmdbId }) as { id: number } | undefined
    if (series) return series.id
  }
  const externalId = meta.grandparentGuid
    ?? (meta.grandparentRatingKey ? `plex:${meta.grandparentRatingKey}` : null)
  if (!externalId) return null
  return (getMediaId.get(externalId, 'series') as { id: number } | undefined)?.id ?? null
}

async function handlePlexEpisode(meta: PlexMeta, occurredAt: string, rating: number | null): Promise<void> {
  const showTitle = meta.grandparentTitle
  if (!showTitle || meta.parentIndex == null || meta.index == null) return
  const thumb = meta.grandparentThumb ?? null
  const coverUrl = thumb ? `/api/integrations/plex/image?path=${encodeURIComponent(thumb)}` : null

  let tmdbId = tmdbIdFromGuid(meta.grandparentGuid)
  if (!tmdbId) tmdbId = await tmdbIdFromPlexRatingKey(meta.grandparentRatingKey)
  if (!tmdbId) tmdbId = await resolveTmdbSeriesId(showTitle, meta.year ?? null)

  let mediaId: number | undefined
  if (tmdbId) {
    const existing = findSeriesByTmdb.get({ tmdb: tmdbId }) as { id: number } | undefined
    if (existing) {
      mediaId = existing.id
      backfillSeriesMeta.run({ id: mediaId, tmdb: tmdbId, cover_url: coverUrl, year: meta.year ?? null })
    }
  }
  if (mediaId == null) {
    const externalId = meta.grandparentGuid
      ?? (meta.grandparentRatingKey ? `plex:${meta.grandparentRatingKey}` : `plex-show:${slugify(showTitle)}`)
    upsertSeriesShow.run({
      external_id: externalId, title: showTitle, cover_url: coverUrl,
      year: meta.year ?? null, tmdb_id: tmdbId,
    })
    mediaId = (getMediaId.get(externalId, 'series') as { id: number } | undefined)?.id
  }
  if (mediaId == null) return

  await ensureSeriesStructure(mediaId, { guid: meta.grandparentGuid })
  setEpisodeWatched(mediaId, meta.parentIndex, meta.index, true, meta.title ?? null, occurredAt)
  insertDiaryEntry.run({
    media_item_id: mediaId, watched_at: occurredAt, rating,
    season_number: meta.parentIndex, episode_number: meta.index,
  })
}

async function tmdbIdForPlexMovie(meta: PlexMeta): Promise<string | null> {
  return tmdbIdFromGuid(meta.guid)
    ?? await tmdbIdFromPlexRatingKey(meta.ratingKey)
    ?? await resolveTmdbMovieId(meta.title ?? '', meta.year ?? null)
}

async function findOrCreatePlexMovie(meta: PlexMeta, occurredAt: string): Promise<number | null> {
  const title = meta.title ?? 'Desconhecido'
  const thumb = meta.thumb ?? null
  const coverUrl = thumb ? `/api/integrations/plex/image?path=${encodeURIComponent(thumb)}` : null
  const originalFilename = originalFilenameFromPlex(meta)
  const tmdbId = await tmdbIdForPlexMovie(meta)

  if (tmdbId) {
    const existing = findMovieByTmdb.get({ tmdb: tmdbId }) as { id: number } | undefined
    if (existing) {
      backfillMovieMeta.run({
        id: existing.id, tmdb: tmdbId, cover_url: coverUrl,
        year: meta.year ?? null, original_filename: originalFilename,
      })
      return existing.id
    }
  }

  const externalId = meta.guid
    ?? (meta.ratingKey ? `plex:${meta.ratingKey}` : `plex-movie:${slugify(title)}`)
  upsertMediaItem.run({
    external_id: externalId, type: 'movie', title, cover_url: coverUrl,
    year: meta.year ?? null, author: null, rating: 0, completed_at: occurredAt,
    original_filename: originalFilename,
  })
  const mediaId = (getMediaId.get(externalId, 'movie') as { id: number } | undefined)?.id
  if (mediaId == null) return null
  if (tmdbId) {
    backfillMovieMeta.run({
      id: mediaId, tmdb: tmdbId, cover_url: coverUrl,
      year: meta.year ?? null, original_filename: originalFilename,
    })
  }
  return mediaId
}

async function handlePlexMovie(meta: PlexMeta, occurredAt: string, rating: number | null): Promise<void> {
  const mediaId = await findOrCreatePlexMovie(meta, occurredAt)
  if (mediaId == null) return
  completeMovieById.run({ id: mediaId, completed_at: occurredAt })
  // Se a nota já existia no Plex quando o scrobble chegou, ela entra junto.
  if (rating != null) setMediaRatingById.run({ id: mediaId, rating })
  insertDiaryEntry.run({
    media_item_id: mediaId, watched_at: occurredAt, rating,
    season_number: null, episode_number: null,
  })
}

/** Converte a nota 0–10 do Plex em estrelas; 0 ou ausente significa sem nota. */
function plexStars(userRating?: number): number | null {
  if (userRating == null || !Number.isFinite(userRating)) return null
  const stars = Math.round(userRating) / 2
  return isQuickRating(stars) ? stars : null
}

app.post('/plex/webhook', async (context) => {
  const token = context.req.query('token')
  const secret = cfg('PLEX_WEBHOOK_SECRET')
  if (secret && token !== secret) return context.json({ error: 'unauthorized' }, 401)

  let payload: PlexPayload
  let rawPayload: string
  try {
    const body = await context.req.parseBody()
    const raw = body.payload
    if (typeof raw !== 'string') return context.json({ ok: true })
    rawPayload = raw
    payload = JSON.parse(raw) as PlexPayload
  } catch {
    return context.json({ error: 'bad payload' }, 400)
  }

  const meta = payload.Metadata
  if (!meta) return context.json({ ok: true })
  const userFilter = cfg('PLEX_USER')
  if (
    userFilter && payload.Account?.title &&
    payload.Account.title.toLowerCase() !== userFilter.toLowerCase()
  ) {
    return context.json({ ok: true })
  }

  const event = payload.event ?? ''
  const mapped = mapPlexMetadata(meta)
  const occurredAt = plexEventOccurredAt(meta)
  const rating = meta.userRating != null ? Math.round((meta.userRating / 2) * 10) / 10 : null
  const author = mapped.media_type === 'music' ? mapped.subtitle : null

  if (event === 'media.scrobble') {
    insertActivity.run({
      event_type: 'scrobble', media_type: mapped.media_type,
      external_ref: mapped.external_ref, title: mapped.title, subtitle: mapped.subtitle,
      cover_url: mapped.cover_url, rating: null, duration_ms: meta.duration ?? null,
      occurred_at: occurredAt, raw: rawPayload.slice(0, 4000),
    })
    const stars = plexStars(meta.userRating)
    if (mapped.kind === 'episode') await handlePlexEpisode(meta, occurredAt, stars)
    else if (mapped.kind === 'movie') await handlePlexMovie(meta, occurredAt, stars)
    else if (mapped.external_ref) {
      upsertMediaItem.run({
        external_id: mapped.external_ref, type: mapped.media_type, title: mapped.title,
        cover_url: mapped.cover_url, year: meta.year ?? null, author, rating: 0,
        completed_at: occurredAt, original_filename: null,
      })
    }
  } else if (event === 'media.rate' && rating != null) {
    insertActivity.run({
      event_type: 'rate', media_type: mapped.media_type,
      external_ref: mapped.external_ref, title: mapped.title, subtitle: mapped.subtitle,
      cover_url: mapped.cover_url, rating, duration_ms: null,
      occurred_at: occurredAt, raw: rawPayload.slice(0, 4000),
    })
    const stars = plexStars(meta.userRating)
    if (mapped.kind === 'episode') {
      const seriesId = await findPlexSeriesId(meta)
      if (seriesId != null) {
        setMediaRatingById.run({ id: seriesId, rating })
        if (stars != null && meta.parentIndex != null && meta.index != null) {
          rateEpisodeDiary.run({
            media_item_id: seriesId, rating: stars,
            season_number: meta.parentIndex, episode_number: meta.index,
          })
        }
      }
    } else if (mapped.kind === 'movie') {
      const mediaId = await findOrCreatePlexMovie(meta, occurredAt)
      if (mediaId != null) {
        // Mesma regra da avaliação rápida: nota na mídia e na conclusão sem nota.
        if (stars != null) applyQuickRating(mediaId, stars)
        else setMediaRatingById.run({ id: mediaId, rating })
      }
    } else if (mapped.external_ref) {
      upsertMediaItem.run({
        external_id: mapped.external_ref, type: mapped.media_type, title: mapped.title,
        cover_url: mapped.cover_url, year: meta.year ?? null, author, rating,
        completed_at: occurredAt, original_filename: null,
      })
      setMediaRating.run(rating, mapped.external_ref, mapped.media_type)
    }
  }
  return context.json({ ok: true })
})

export default app
