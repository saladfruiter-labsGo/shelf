import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
import path from 'node:path'
import sharp from 'sharp'

export const IMAGE_WIDTHS = [160, 320, 640, 1024] as const
export type ImageWidth = (typeof IMAGE_WIDTHS)[number]

const DEFAULT_WIDTH: ImageWidth = 640
const DEFAULT_TTL_DAYS = 30
const MAX_INPUT_PIXELS = 40_000_000

export type RemoteImage = {
  body: ArrayBuffer
  contentType: string
}

export type CachedImage = {
  body: Buffer
  state: 'hit' | 'miss' | 'stale'
}

function cacheDirectory(): string {
  return path.resolve(process.env.IMG_CACHE_DIR ?? path.join(process.env.DATA_DIR ?? './data', 'images'))
}

function cacheTtlMs(): number {
  const configured = Number(process.env.IMG_CACHE_TTL_DAYS ?? DEFAULT_TTL_DAYS)
  const days = Number.isFinite(configured) ? Math.min(365, Math.max(1, configured)) : DEFAULT_TTL_DAYS
  return days * 24 * 60 * 60 * 1000
}

/** Escolhe a variante imediatamente maior para evitar upscaling no navegador. */
export function normalizeImageWidth(raw: string | undefined): ImageWidth {
  const requested = Number.parseInt(raw ?? String(DEFAULT_WIDTH), 10)
  if (!Number.isFinite(requested) || requested <= 0) return DEFAULT_WIDTH
  return IMAGE_WIDTHS.find(width => width >= requested) ?? IMAGE_WIDTHS.at(-1)!
}

export function imageCacheKey(sourceUrl: string, width: ImageWidth): string {
  return createHash('sha256').update(`${sourceUrl}\0${width}`).digest('hex')
}

function imageCachePath(sourceUrl: string, width: ImageWidth): string {
  return path.join(cacheDirectory(), `${imageCacheKey(sourceUrl, width)}.webp`)
}

async function readExisting(filePath: string): Promise<{ body: Buffer; fresh: boolean } | null> {
  try {
    const metadata = await stat(filePath)
    if (!metadata.isFile() || metadata.size === 0) return null
    const body = await readFile(filePath)
    return { body, fresh: Date.now() - metadata.mtimeMs < cacheTtlMs() }
  } catch {
    return null
  }
}

const inFlight = new Map<string, Promise<CachedImage>>()

/**
 * Busca e normaliza uma imagem uma única vez por URL/variante.
 * O arquivo fica no volume persistente do Shelf, fora do SQLite.
 */
export async function getCachedImage(
  sourceUrl: string,
  width: ImageWidth,
  download: () => Promise<RemoteImage>,
): Promise<CachedImage> {
  const filePath = imageCachePath(sourceUrl, width)
  const existing = await readExisting(filePath)
  if (existing?.fresh) return { body: existing.body, state: 'hit' }

  const key = `${sourceUrl}\0${width}`
  const pending = inFlight.get(key)
  if (pending) return pending

  const task = (async (): Promise<CachedImage> => {
    try {
      const remote = await download()
      const body = await sharp(Buffer.from(remote.body), { limitInputPixels: MAX_INPUT_PIXELS })
        .rotate()
        .resize({ width, withoutEnlargement: true })
        .webp({ quality: 82, effort: 4 })
        .toBuffer()

      await mkdir(cacheDirectory(), { recursive: true })
      const temporaryPath = `${filePath}.${randomUUID()}.tmp`
      try {
        await writeFile(temporaryPath, body)
        await rename(temporaryPath, filePath)
      } finally {
        await rm(temporaryPath, { force: true }).catch(() => {})
      }

      return { body, state: 'miss' }
    } catch (error) {
      // A stale cover is preferable to making an existing library card vanish
      // when a provider has a temporary outage or rate limit.
      if (existing) return { body: existing.body, state: 'stale' }
      throw error
    }
  })()

  inFlight.set(key, task)
  try {
    return await task
  } finally {
    if (inFlight.get(key) === task) inFlight.delete(key)
  }
}
