import { Hono } from 'hono'
import { readUploadedCover } from '../custom-cover.js'

const app = new Hono()

/**
 * Artes de capa enviadas pelo usuário. O nome é o hash do conteúdo, então o
 * arquivo nunca muda sob a mesma URL e pode ficar em cache indefinidamente.
 */
app.get('/:file', async (c) => {
  const body = await readUploadedCover(c.req.param('file'))
  if (!body) return c.json({ error: 'Not found' }, 404)
  const bytes = new Uint8Array(body.byteLength)
  bytes.set(body)
  return c.body(bytes, 200, {
    'Content-Type': 'image/webp',
    'Cache-Control': 'public, max-age=31536000, immutable',
  })
})

export default app
