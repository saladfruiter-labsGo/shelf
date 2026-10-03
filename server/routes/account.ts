import { Hono } from 'hono'
import { core } from '../core-db.js'
import { cleanDisplayName, getUser, publicSelf } from '../auth/accounts.js'
import { ImageUploadError, deleteImage, readImage, saveImage } from '../uploads.js'

/** A própria conta: nome, bio e foto. Senha fica em /api/auth/password. */
export const accountRoutes = new Hono()

const BIO_MAX = 280

accountRoutes.get('/', (c) => c.json(publicSelf(getUser(c.get('user').id)!)))

accountRoutes.patch('/', async (c) => {
  const user = c.get('user')
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
  if ('display_name' in b) {
    const name = cleanDisplayName(b.display_name)
    if (!name) return c.json({ error: 'O nome precisa ter de 1 a 60 caracteres.' }, 400)
    core("UPDATE users SET display_name = ?, updated_at = datetime('now') WHERE id = ?").run(name, user.id)
  }
  if ('bio' in b) {
    const bio = typeof b.bio === 'string' ? b.bio.trim() : ''
    if (bio.length > BIO_MAX) return c.json({ error: `A bio tem limite de ${BIO_MAX} caracteres.` }, 400)
    core("UPDATE users SET bio = ?, updated_at = datetime('now') WHERE id = ?").run(bio || null, user.id)
  }
  return c.json(publicSelf(getUser(user.id)!))
})

accountRoutes.post('/avatar', async (c) => {
  const user = c.get('user')
  const form = await c.req.parseBody().catch(() => null)
  const file = form?.file
  if (!(file instanceof File)) return c.json({ error: 'Envie a imagem no campo "file".' }, 400)
  try {
    const saved = await saveImage(file, 'avatars')
    const previous = getUser(user.id)?.avatar_file
    core("UPDATE users SET avatar_file = ?, updated_at = datetime('now') WHERE id = ?").run(saved.file, user.id)
    await deleteImage('avatars', previous)
  } catch (error) {
    if (error instanceof ImageUploadError) return c.json({ error: error.message }, 400)
    throw error
  }
  return c.json(publicSelf(getUser(user.id)!))
})

accountRoutes.delete('/avatar', async (c) => {
  const user = c.get('user')
  const previous = getUser(user.id)?.avatar_file
  core("UPDATE users SET avatar_file = NULL, updated_at = datetime('now') WHERE id = ?").run(user.id)
  await deleteImage('avatars', previous)
  return c.json(publicSelf(getUser(user.id)!))
})

/** Diretório de pessoas da instância (para menções e mensagens). */
export const usersRoutes = new Hono()

usersRoutes.get('/', (c) => {
  const rows = core(`
    SELECT id, username, display_name, avatar_file FROM users WHERE status = 'active' ORDER BY display_name COLLATE NOCASE
  `).all() as { id: number; username: string; display_name: string; avatar_file: string | null }[]
  return c.json(rows.map(r => ({
    id: r.id, username: r.username, display_name: r.display_name,
    avatar_url: r.avatar_file ? `/api/users/avatar/${r.avatar_file}` : null,
  })))
})

usersRoutes.get('/avatar/:file', async (c) => {
  const body = await readImage('avatars', c.req.param('file'))
  if (!body) return c.json({ error: 'Not found' }, 404)
  const bytes = new Uint8Array(body.byteLength)
  bytes.set(body)
  // Nome aleatório e imutável; `private` mantém fora de caches compartilhados.
  return c.body(bytes, 200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable' })
})
