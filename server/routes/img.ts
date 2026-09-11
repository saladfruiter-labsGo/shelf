import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { getCachedImage, normalizeImageWidth, type RemoteImage } from '../image-cache.js'

const app = new Hono()

const MAX_IMAGE_BYTES = 10 * 1024 * 1024
const MAX_REDIRECTS = 3
const FETCH_TIMEOUT_MS = 10_000
const SAFE_IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])

const DEFAULT_HOSTS = new Set([
  'image.tmdb.org',
  'media.rawg.io',
  'books.google.com',
  'books.googleusercontent.com',
  'cdn.cloudflare.steamstatic.com',
  'shared.cloudflare.steamstatic.com',
  'cdn.akamai.steamstatic.com',
  'shared.akamai.steamstatic.com',
  'lastfm.freetls.fastly.net',
])

function allowedHosts(): Set<string> {
  const configured = (process.env.IMG_PROXY_ALLOWED_HOSTS ?? '')
    .split(',')
    .map(host => host.trim().toLowerCase())
    .filter(Boolean)
  return new Set([...DEFAULT_HOSTS, ...configured])
}

/** Somente HTTPS e hosts de provedores de capa conhecidos; sem credenciais ou porta customizada. */
export function allowedImageUrl(raw: string): URL | null {
  try {
    const url = new URL(raw)
    if (url.protocol !== 'https:' || url.username || url.password) return null
    if (url.port && url.port !== '443') return null
    return allowedHosts().has(url.hostname.toLowerCase()) ? url : null
  } catch {
    return null
  }
}

async function bodyWithinLimit(response: Response): Promise<ArrayBuffer> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_IMAGE_BYTES) throw new Error('Imagem grande demais.')
  if (!response.body) return new ArrayBuffer(0)

  const chunks: Uint8Array[] = []
  let size = 0
  const reader = response.body.getReader()
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > MAX_IMAGE_BYTES) {
      await reader.cancel().catch(() => {})
      throw new Error('Imagem grande demais.')
    }
    chunks.push(value)
  }

  const buffer = new ArrayBuffer(size)
  const body = new Uint8Array(buffer)
  let offset = 0
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.byteLength }
  return buffer
}

async function fetchRemoteImage(initialUrl: URL): Promise<RemoteImage> {
  let url: URL = initialUrl
  const ctrl = new AbortController()
  const timeout = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS)
  try {
    for (let redirect = 0; redirect <= MAX_REDIRECTS; redirect++) {
      const response = await fetch(url, {
        headers: { 'User-Agent': 'ShelfImageProxy/2.0', Accept: 'image/*' },
        redirect: 'manual',
        signal: ctrl.signal,
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        await response.body?.cancel().catch(() => {})
        if (!location || redirect === MAX_REDIRECTS) throw new Error('Redirect de imagem inválido.')
        const redirected = allowedImageUrl(new URL(location, url).toString())
        if (!redirected) throw new Error('Redirect de imagem bloqueado.')
        url = redirected
        continue
      }

      if (!response.ok) throw new Error('O provedor não entregou a imagem.')
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
      if (!SAFE_IMAGE_TYPES.has(contentType)) throw new Error('O endereço não retornou uma imagem raster segura.')

      return { body: await bodyWithinLimit(response), contentType }
    }
  } finally {
    clearTimeout(timeout)
  }

  throw new Error('Redirect de imagem inválido.')
}

function imageHeaders(etag: string, state: 'hit' | 'miss' | 'stale'): Record<string, string> {
  return {
    'Content-Type': 'image/webp',
    'Cache-Control': 'public, max-age=604800, stale-while-revalidate=86400',
    ETag: etag,
    'X-Shelf-Image-Cache': state,
  }
}

/**
 * Proxy de imagens remotas (capas). Serve os bytes na mesma origem para que o
 * <canvas> do gerador de Story não seja "tainted" por CORS — muitos provedores
 * de capa (TMDB, Google Books) não enviam Access-Control-Allow-Origin, o que
 * fazia a capa sumir da imagem gerada.
 *
 * Cada redirect volta a passar pela allowlist; uma URL pública não consegue
 * saltar para o Unraid, roteador ou outro serviço da LAN.
 */
app.get('/', async (c) => {
  const url = allowedImageUrl(c.req.query('url') ?? '')
  if (!url) return c.json({ error: 'Host de imagem não permitido.' }, 403)

  try {
    const width = normalizeImageWidth(c.req.query('width'))
    const cached = await getCachedImage(url.toString(), width, () => fetchRemoteImage(url))
    const etag = `"${createHash('sha256').update(cached.body).digest('hex')}"`
    const headers = imageHeaders(etag, cached.state)
    if (c.req.header('if-none-match') === etag) return c.body(null, 304, headers)
    const body = new Uint8Array(cached.body.byteLength)
    body.set(cached.body)
    return c.body(body, 200, headers)
  } catch (error) {
    if (error instanceof Error && error.message === 'Redirect de imagem bloqueado.') {
      return c.json({ error: error.message }, 403)
    }
    if (error instanceof Error && error.message === 'O endereço não retornou uma imagem raster segura.') {
      return c.json({ error: error.message }, 415)
    }
    return c.json({ error: 'Não foi possível buscar a imagem.' }, 502)
  }
})

export default app
