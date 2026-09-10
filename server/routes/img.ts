import { Hono } from 'hono'

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
  let url = allowedImageUrl(c.req.query('url') ?? '')
  if (!url) return c.json({ error: 'Host de imagem não permitido.' }, 403)

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
        if (!location || redirect === MAX_REDIRECTS) return c.json({ error: 'Redirect de imagem inválido.' }, 502)
        url = allowedImageUrl(new URL(location, url).toString())
        if (!url) return c.json({ error: 'Redirect de imagem bloqueado.' }, 403)
        continue
      }

      if (!response.ok) return c.json({ error: 'O provedor não entregou a imagem.' }, 502)
      const contentType = response.headers.get('content-type')?.split(';')[0].trim().toLowerCase() ?? ''
      if (!SAFE_IMAGE_TYPES.has(contentType)) return c.json({ error: 'O endereço não retornou uma imagem raster segura.' }, 415)

      const bytes = await bodyWithinLimit(response)
      return c.body(bytes, 200, {
        'Content-Type': contentType,
        'Cache-Control': 'public, max-age=86400',
      })
    }
  } catch {
    return c.json({ error: 'Não foi possível buscar a imagem.' }, 502)
  } finally {
    clearTimeout(timeout)
  }

  return c.body(null, 502)
})

export default app
