import { Hono } from 'hono'
import { db } from '../../db.js'
import { cfg, setCfg } from '../../integrations/config.js'
import { pickLastfmImage } from '../../integrations/lastfm-domain.js'
import type { NowPlaying } from '../../integrations/now-playing.js'

interface LastfmTrack {
  name?: string
  artist?: { '#text'?: string; name?: string }
  album?: { '#text'?: string }
  image?: unknown
  date?: { uts?: string }
  '@attr'?: { nowplaying?: string }
}

const app = new Hono()

const getTrack = db.prepare('SELECT * FROM music_tracks WHERE artist = ? AND track = ?')
const upsertTrack = db.prepare(`
  INSERT INTO music_tracks (artist, track, album, cover_url, play_count, first_played, last_played)
  VALUES (@artist, @track, @album, @cover_url, 1, @played, @played)
  ON CONFLICT(artist, track) DO UPDATE SET
    play_count  = music_tracks.play_count + 1,
    last_played = @played,
    album       = COALESCE(music_tracks.album, excluded.album),
    cover_url   = COALESCE(music_tracks.cover_url, excluded.cover_url)
`)
const enrichTrack = db.prepare(`
  UPDATE music_tracks SET duration_ms = ?, genre = ?, mbid = ?, enriched = 1 WHERE artist = ? AND track = ?
`)
const insertActivity = db.prepare(`
  INSERT OR IGNORE INTO activity_events
    (source, event_type, media_type, external_ref, title, subtitle, cover_url, rating, duration_ms, genre, occurred_at, raw)
  VALUES ('lastfm', 'listen', 'music', @external_ref, @title, @subtitle, @cover_url, NULL, @duration_ms, @genre, @occurred_at, NULL)
`)
const upsertMediaItem = db.prepare(`
  INSERT INTO media_items (external_id, type, title, cover_url, year, author, status, rating, completed_at, original_filename)
  VALUES (@external_id, 'music', @title, @cover_url, NULL, @author, 'completed', 0, @completed_at, NULL)
  ON CONFLICT(external_id, type) DO UPDATE SET
    status       = 'completed',
    completed_at = COALESCE(media_items.completed_at, excluded.completed_at),
    author       = COALESCE(media_items.author, excluded.author),
    cover_url    = COALESCE(media_items.cover_url, excluded.cover_url),
    updated_at   = datetime('now')
`)

let nowPlaying: NowPlaying | null = null

export function getLastfmNowPlaying(): NowPlaying | null {
  return nowPlaying
}

async function lastfmCall(method: string, params: Record<string, string>): Promise<any> {
  const query = new URLSearchParams({
    method,
    api_key: cfg('LASTFM_API_KEY'),
    format: 'json',
    ...params,
  })
  const response = await fetch(`https://ws.audioscrobbler.com/2.0/?${query}`)
  if (!response.ok) throw new Error(`lastfm ${method} ${response.status}`)
  return response.json()
}

async function ensureEnriched(artist: string, track: string): Promise<{
  duration_ms: number | null
  genre: string | null
}> {
  const row = getTrack.get(artist, track) as {
    enriched?: number
    duration_ms?: number | null
    genre?: string | null
  } | undefined
  if (row?.enriched) return { duration_ms: row.duration_ms ?? null, genre: row.genre ?? null }

  let durationMs: number | null = null
  let genre: string | null = null
  let mbid: string | null = null
  try {
    const info = await lastfmCall('track.getInfo', { artist, track })
    const duration = parseInt(info?.track?.duration ?? '0')
    durationMs = duration > 0 ? duration : null
    mbid = info?.track?.mbid || null
  } catch { /* segue sem duração */ }
  try {
    const tags = await lastfmCall('artist.getTopTags', { artist })
    genre = tags?.toptags?.tag?.[0]?.name ?? null
  } catch { /* segue sem gênero */ }

  enrichTrack.run(durationMs, genre, mbid, artist, track)
  return { duration_ms: durationMs, genre }
}

export async function pollLastfm(): Promise<void> {
  const key = cfg('LASTFM_API_KEY')
  const user = cfg('LASTFM_USER')
  if (cfg('LASTFM_ENABLED') !== '1' || !key || !user) {
    nowPlaying = null
    return
  }

  try {
    const data = await lastfmCall('user.getRecentTracks', { user, limit: '50' })
    const tracks = (data?.recenttracks?.track ?? []) as LastfmTrack[]
    if (!tracks.length) return

    const current = tracks.find(track => track['@attr']?.nowplaying === 'true')
    nowPlaying = current ? {
      media_type: 'music',
      title: current.name ?? '',
      subtitle: current.artist?.['#text'] ?? current.artist?.name ?? null,
      cover_url: pickLastfmImage(current.image),
      state: 'playing',
      position_ms: null,
      duration_ms: null,
      updated_at: Date.now(),
    } : null

    const lastUts = parseInt(cfg('LASTFM_LAST_UTS') || '0')
    const scrobbled = tracks
      .filter(track => track.date?.uts && parseInt(track.date.uts) > lastUts)
      .sort((a, b) => parseInt(a.date!.uts!) - parseInt(b.date!.uts!))

    let maxUts = lastUts
    for (const track of scrobbled) {
      const uts = parseInt(track.date!.uts!)
      if (uts > maxUts) maxUts = uts

      const name = track.name
      if (!name) continue

      try {
        const artist = track.artist?.['#text'] ?? track.artist?.name ?? 'Desconhecido'
        const album = track.album?.['#text'] || null
        const cover = pickLastfmImage(track.image)
        const occurredAt = new Date(uts * 1000).toISOString()

        upsertTrack.run({ artist, track: name, album, cover_url: cover, played: occurredAt })
        const { duration_ms, genre } = await ensureEnriched(artist, name)
        const externalRef = `${artist}|${name}`

        insertActivity.run({
          external_ref: externalRef,
          title: name,
          subtitle: artist,
          cover_url: cover,
          duration_ms,
          genre,
          occurred_at: occurredAt,
        })
        upsertMediaItem.run({
          external_id: externalRef,
          title: name,
          cover_url: cover,
          author: artist,
          completed_at: occurredAt,
        })
      } catch (error) {
        console.error(`[lastfm] falha ao registrar scrobble "${name}":`, error)
      }
    }
    if (maxUts > lastUts) setCfg('LASTFM_LAST_UTS', String(maxUts))
  } catch (error) {
    console.error('[lastfm] poll falhou:', error)
  }
}

app.post('/lastfm/sync', async (context) => {
  await pollLastfm()
  return context.json({ ok: true })
})

export default app
