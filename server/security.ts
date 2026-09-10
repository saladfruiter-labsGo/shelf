import type { MiddlewareHandler } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import { secureHeaders } from 'hono/secure-headers'

export const API_BODY_LIMIT = 65 * 1024 * 1024

/**
 * Navegadores só podem chamar a API a partir do próprio Shelf. Clientes sem
 * `Origin` (Plex, Playnite, curl) continuam aceitos; os webhooks mantêm seus
 * tokens próprios.
 */
export const sameOriginApi: MiddlewareHandler = async (c, next) => {
  const origin = c.req.header('origin')
  const fetchSite = c.req.header('sec-fetch-site')

  if (fetchSite === 'cross-site') {
    return c.json({ error: 'Origem não permitida.' }, 403)
  }

  if (origin) {
    try {
      // Host inclui a porta. Comparar o host, sem o protocolo, também funciona
      // atrás de um proxy TLS que preserve o Host original.
      if (new URL(origin).host !== new URL(c.req.url).host) {
        return c.json({ error: 'Origem não permitida.' }, 403)
      }
    } catch {
      return c.json({ error: 'Origem não permitida.' }, 403)
    }
  }

  await next()
}

/** Limite global; o maior upload legítimo hoje é o export do Letterboxd (64 MB). */
export const limitedApiBody = bodyLimit({
  maxSize: API_BODY_LIMIT,
  onError: c => c.json({ error: 'Corpo da requisição grande demais.' }, 413),
})

/** Respostas dinâmicas nunca devem parar no cache HTTP ou no service worker. */
export const noStoreDynamicApi: MiddlewareHandler = async (c, next) => {
  await next()
  if (!c.res.headers.has('Cache-Control')) c.header('Cache-Control', 'no-store')
}

export const shelfSecurityHeaders = secureHeaders({
  xFrameOptions: 'DENY',
  permissionsPolicy: {
    camera: false,
    geolocation: false,
    microphone: false,
  },
})
