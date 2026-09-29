export interface PlexMediaFileMetadata {
  Media?: { Part?: { file?: string }[] }[]
}

export interface PlexMeta extends PlexMediaFileMetadata {
  type?: string
  title?: string
  grandparentTitle?: string
  grandparentGuid?: string
  grandparentRatingKey?: string
  parentTitle?: string
  parentIndex?: number
  index?: number
  year?: number
  guid?: string
  ratingKey?: string
  thumb?: string
  grandparentThumb?: string
  duration?: number
  userRating?: number
  lastViewedAt?: number
  updatedAt?: number
}

export function plexEventOccurredAt(meta: PlexMeta, fallback = new Date()): string {
  const seconds = meta.lastViewedAt ?? meta.updatedAt
  if (typeof seconds === 'number' && Number.isFinite(seconds) && seconds > 0) {
    const occurredAt = new Date(seconds * 1000)
    if (!Number.isNaN(occurredAt.getTime())) return occurredAt.toISOString()
  }
  return fallback.toISOString()
}

/** Extrai um id numérico do TMDB de um guid do Plex, se presente. */
export function tmdbIdFromGuid(guid?: string | null): string | null {
  if (!guid) return null
  const match = guid.match(/(?:themoviedb|tmdb)[:/]+(\d+)/i)
  return match ? match[1] : null
}

export function mapPlexMetadata(meta: PlexMeta) {
  const kind = meta.type
  const media_type: 'movie' | 'series' | 'music' =
    kind === 'movie' ? 'movie' : kind === 'track' ? 'music' : 'series'

  let title = meta.title ?? 'Desconhecido'
  let subtitle: string | null = null
  if (kind === 'episode') {
    title = meta.grandparentTitle ?? title
    const season = meta.parentIndex != null ? `T${meta.parentIndex}` : ''
    const episode = meta.index != null ? `E${meta.index}` : ''
    subtitle = [[season, episode].filter(Boolean).join(''), meta.title]
      .filter(Boolean).join(' · ') || null
  } else if (kind === 'track') {
    subtitle = meta.grandparentTitle ?? null
  }

  const thumb = meta.grandparentThumb ?? meta.thumb ?? null
  return {
    media_type,
    title,
    subtitle,
    cover_url: thumb ? `/api/integrations/plex/image?path=${encodeURIComponent(thumb)}` : null,
    external_ref: meta.guid ?? (meta.ratingKey ? `plex:${meta.ratingKey}` : null),
    kind,
  }
}

/** Extrai apenas o nome do arquivo do caminho que o Plex informa na mídia. */
export function originalFilenameFromPlex(meta: Pick<PlexMediaFileMetadata, 'Media'>): string | null {
  const file = meta.Media
    ?.flatMap(media => media.Part ?? [])
    .map(part => part.file)
    .find((value): value is string => typeof value === 'string' && value.trim().length > 0)

  if (!file) return null
  const normalized = file.replace(/[\\/]+$/, '')
  return normalized.split(/[\\/]/).pop() || normalized
}

/**
 * Caminhos de imagem que o proxy aceita: só as capas que o próprio Shelf grava
 * (`thumb`/`grandparentThumb` do Plex) e a arte de fundo do mesmo item. O proxy
 * envia o token de admin ao Plex, então qualquer outro caminho seria uma porta
 * aberta para a API inteira (histórico, contas, sessões).
 */
const PLEX_IMAGE_PATH = /^\/library\/metadata\/\d+\/(?:thumb|art)(?:\/\d+)?$/

export function isPlexImagePath(path: unknown): path is string {
  return typeof path === 'string' && PLEX_IMAGE_PATH.test(path)
}

export type PlexImageResult =
  | { ok: true; body: ArrayBuffer; contentType: string }
  | { ok: false; status: 400 | 404 | 502 }

/** Busca uma capa no Plex, recusando caminho fora do formato e resposta que não é imagem. */
export async function fetchPlexImage(
  path: unknown,
  { url, token, fetcher = fetch }: { url: string; token: string; fetcher?: typeof fetch },
): Promise<PlexImageResult> {
  if (!url || !token) return { ok: false, status: 404 }
  if (!isPlexImagePath(path)) return { ok: false, status: 400 }
  try {
    const response = await fetcher(`${url.replace(/\/$/, '')}${path}`, {
      headers: { 'X-Plex-Token': token },
      redirect: 'error',
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !/^image\//i.test(contentType)) return { ok: false, status: 502 }
    return { ok: true, body: await response.arrayBuffer(), contentType }
  } catch {
    return { ok: false, status: 502 }
  }
}
