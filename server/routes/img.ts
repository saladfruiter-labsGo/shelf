import { Hono } from 'hono'

const app = new Hono()

/**
 * Proxy de imagens remotas (capas). Serve os bytes na mesma origem para que o
 * <canvas> do gerador de Story não seja "tainted" por CORS — muitos provedores
 * de capa (TMDB, Google Books) não enviam Access-Control-Allow-Origin, o que
 * fazia a capa sumir da imagem gerada.
 */
app.get('/', async (c) => {
  const url = c.req.query('url')
  if (!url || !/^https?:\/\//i.test(url)) return c.body(null, 400)
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'ShelfImageProxy/1.0' } })
    if (!r.ok) return c.body(null, 502)
    const buf = await r.arrayBuffer()
    return c.body(buf, 200, {
      'Content-Type': r.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'public, max-age=86400',
      'Access-Control-Allow-Origin': '*',
    })
  } catch {
    return c.body(null, 502)
  }
})

export default app
