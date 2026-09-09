export interface PlexMediaFileMetadata {
  Media?: { Part?: { file?: string }[] }[]
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
