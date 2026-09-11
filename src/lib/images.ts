const DEFAULT_WIDTH = 640

/**
 * Mantém endpoints locais (Plex/Kavita e assets do Shelf) intactos e envia
 * somente imagens externas pelo proxy persistente do servidor.
 */
export function imageUrl(url: string | null | undefined, width = DEFAULT_WIDTH): string | null {
  if (!url) return null
  if (!/^https:\/\//i.test(url)) return url
  return `/api/img?url=${encodeURIComponent(url)}&width=${Math.max(1, Math.round(width))}`
}
