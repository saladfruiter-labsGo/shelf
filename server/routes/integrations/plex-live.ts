import { Hono } from 'hono'
import { cfg } from '../../integrations/config.js'
import type { NowPlaying } from '../../integrations/now-playing.js'
import { mapPlexMetadata, type PlexMeta } from '../../plex.js'

interface PlexSession extends PlexMeta {
  Player?: { state?: string }
  User?: { title?: string }
  viewOffset?: number
}

const app = new Hono()
let nowPlaying: NowPlaying | null = null

export function getPlexNowPlaying(): NowPlaying | null {
  return nowPlaying
}

app.get('/plex/image', async (context) => {
  const path = context.req.query('path')
  const url = cfg('PLEX_URL')
  const token = cfg('PLEX_TOKEN')
  if (!path || !url || !token) return context.body(null, 404)
  try {
    const response = await fetch(`${url.replace(/\/$/, '')}${path}`, {
      headers: { 'X-Plex-Token': token },
    })
    if (!response.ok) return context.body(null, 502)
    return context.body(await response.arrayBuffer(), 200, {
      'Content-Type': response.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
    })
  } catch {
    return context.body(null, 502)
  }
})

export async function pollPlexSessions(): Promise<void> {
  const url = cfg('PLEX_URL')
  const token = cfg('PLEX_TOKEN')
  if (cfg('PLEX_ENABLED') !== '1' || !url || !token) {
    nowPlaying = null
    return
  }

  try {
    const response = await fetch(`${url.replace(/\/$/, '')}/status/sessions`, {
      headers: { 'X-Plex-Token': token, Accept: 'application/json' },
    })
    if (!response.ok) return
    const data = await response.json() as { MediaContainer?: { Metadata?: PlexSession[] } }
    const userFilter = cfg('PLEX_USER').toLowerCase()
    const relevant = (data.MediaContainer?.Metadata ?? []).filter(session => {
      if (session.type !== 'movie' && session.type !== 'episode' && session.type !== 'track') return false
      if (userFilter && (session.User?.title ?? '').toLowerCase() !== userFilter) return false
      return true
    })
    relevant.sort((a, b) =>
      (a.Player?.state === 'playing' ? -1 : 1) - (b.Player?.state === 'playing' ? -1 : 1),
    )
    const session = relevant[0]
    if (!session) {
      nowPlaying = null
      return
    }

    const mapped = mapPlexMetadata(session)
    nowPlaying = {
      media_type: mapped.media_type,
      title: mapped.title,
      subtitle: mapped.subtitle,
      cover_url: mapped.cover_url,
      state: session.Player?.state === 'paused' ? 'paused' : 'playing',
      position_ms: typeof session.viewOffset === 'number' ? session.viewOffset : null,
      duration_ms: typeof session.duration === 'number' ? session.duration : null,
      updated_at: Date.now(),
    }
  } catch {
    /* servidor Plex indisponível: o agregador expira o último estado após 60 s */
  }
}

export default app
