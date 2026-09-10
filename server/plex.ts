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
