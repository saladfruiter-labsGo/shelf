const LASTFM_PLACEHOLDER_IMAGE = '2a96cbd8b46e442fc41c2b86b821562f'

interface LastfmImage {
  size?: string
  '#text'?: string
}

export function pickLastfmImage(images: unknown): string | null {
  if (!Array.isArray(images)) return null
  const candidates = images as LastfmImage[]
  const selected = candidates.find(image => image.size === 'extralarge') ?? candidates.at(-1)
  const url = selected?.['#text']
  return url && !url.includes(LASTFM_PLACEHOLDER_IMAGE) ? url : null
}
