import { Hono, type Context } from 'hono'
import { core, coreDb } from '../core-db.js'
import { runAsUser } from '../db.js'
import { isAdmin, type UserRow } from '../auth/accounts.js'
import { ActionLimiter } from '../auth/rate-limit.js'
import { cfg, setCfg } from '../integrations/config.js'
import { buildProfile } from '../profile.js'
import { ImageUploadError, deleteImage, readImage, saveImage, type SavedImage } from '../uploads.js'
import integrationsRoutes from './integrations.js'
import { listView } from './lists.js'
import {
  authorView, coversOfPost, getPost, getPostRow, isReaction, listComments, listFeed, listNotifications,
  notify, reactionsFor, type Viewer,
} from '../social/feed.js'
import { cleanBody, extractMentions, extractRefs, safeCoverUrl, type Mention } from '../social/text.js'

const POST_MAX = 2000
const COMMENT_MAX = 1000
const MAX_IMAGES = 4

const postLimiter = new ActionLimiter(20, 10 * 60_000)
const commentLimiter = new ActionLimiter(60, 10 * 60_000)
const reactionLimiter = new ActionLimiter(300, 10 * 60_000)

function viewerOf(c: Context): Viewer {
  const user = c.get('user') as UserRow
  return { id: user.id, admin: isAdmin(user) }
}

function tooFast(c: Context) {
  return c.json({ error: 'Calma! Muitas ações em pouco tempo — tente de novo em alguns minutos.' }, 429)
}

const intId = (raw: string | undefined) => {
  const n = Number(raw)
  return Number.isInteger(n) && n > 0 ? n : null
}

/** Capa servida por uma integração de outra pessoa (Plex, Kavita): busca com as credenciais dela. */
async function proxyOwnerCover(ownerId: number, src: string): Promise<Response> {
  if (!src.startsWith('/api/integrations/')) return new Response(null, { status: 404 })
  const res = await runAsUser(ownerId, async () => integrationsRoutes.request(src.slice('/api/integrations'.length)))
  if (!res.ok) return new Response(null, { status: res.status })
  return new Response(res.body, {
    status: 200,
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/jpeg',
      'Cache-Control': 'private, max-age=86400',
    },
  })
}

/** Tudo de rede social que parte do texto: menções e mídias marcadas. */
function textParts(body: string, refs: unknown, selfId: number): { refs: ReturnType<typeof extractRefs>; mentions: Mention[] } {
  return {
    refs: extractRefs(body, refs),
    mentions: extractMentions(body).filter(m => m.id !== selfId),
  }
}

/* ═════════════════════════════════════ Feed ═════════════════════════════════════ */

export const feedRoutes = new Hono()

feedRoutes.get('/', (c) => {
  const viewer = viewerOf(c)
  const username = c.req.query('author')
  let authorId: number | null = null
  if (username) {
    const row = core('SELECT id FROM users WHERE username = ?').get(username.toLowerCase()) as { id: number } | undefined
    if (!row) return c.json({ posts: [], next: null })
    authorId = row.id
  }
  return c.json(listFeed(viewer, { before: c.req.query('before'), authorId, limit: Number(c.req.query('limit')) || 20 }))
})

feedRoutes.post('/posts', async (c) => {
  const viewer = viewerOf(c)
  if (!postLimiter.take(`u:${viewer.id}`)) return tooFast(c)

  const isMultipart = (c.req.header('content-type') ?? '').includes('multipart/form-data')
  const form = isMultipart
    ? await c.req.parseBody({ all: true }).catch(() => null)
    : await c.req.json().catch(() => null) as Record<string, unknown> | null
  if (!form) return c.json({ error: 'Corpo inválido.' }, 400)

  const body = cleanBody(form.body ?? '', POST_MAX)
  if (body == null) return c.json({ error: `O texto tem limite de ${POST_MAX} caracteres.` }, 400)
  let providedRefs: unknown = form.refs
  if (typeof providedRefs === 'string') { try { providedRefs = JSON.parse(providedRefs) } catch { providedRefs = [] } }
  const raw = form.images
  const files = (Array.isArray(raw) ? raw : raw ? [raw] : []).filter((f): f is File => f instanceof File)
  if (files.length > MAX_IMAGES) return c.json({ error: `No máximo ${MAX_IMAGES} imagens por post.` }, 400)
  if (!body && !files.length) return c.json({ error: 'Escreva algo ou anexe uma imagem.' }, 400)

  const saved: SavedImage[] = []
  try {
    for (const file of files) saved.push(await saveImage(file, 'posts'))
  } catch (error) {
    for (const img of saved) await deleteImage('posts', img.file)
    if (error instanceof ImageUploadError) return c.json({ error: error.message }, 400)
    throw error
  }

  const parts = textParts(body, providedRefs, viewer.id)
  const postId = coreDb.transaction(() => {
    const res = core(`
      INSERT INTO feed_posts (author_id, kind, body, refs_json, mentions_json) VALUES (?, 'post', ?, ?, ?)
    `).run(viewer.id, body || null, JSON.stringify(parts.refs), JSON.stringify(parts.mentions))
    const id = Number(res.lastInsertRowid)
    saved.forEach((img, i) => core('INSERT INTO feed_images (post_id, file, width, height, position) VALUES (?, ?, ?, ?, ?)')
      .run(id, img.file, img.width, img.height, i))
    for (const m of parts.mentions) notify({ userId: m.id, actorId: viewer.id, type: 'mention', postId: id })
    return id
  })()
  return c.json(getPost(postId, viewer), 201)
})

feedRoutes.get('/posts/:id', (c) => {
  const viewer = viewerOf(c)
  const id = intId(c.req.param('id'))
  const post = id ? getPost(id, viewer) : null
  if (!post) return c.json({ error: 'Post não encontrado.' }, 404)
  return c.json({ post, comments: listComments(post.id, viewer) })
})

feedRoutes.delete('/posts/:id', async (c) => {
  const viewer = viewerOf(c)
  const id = intId(c.req.param('id'))
  const row = id ? getPostRow(id) : undefined
  if (!row) return c.json({ error: 'Post não encontrado.' }, 404)
  if (row.author_id !== viewer.id && !viewer.admin) return c.json({ error: 'Só quem postou (ou um admin) pode apagar.' }, 403)
  const files = core('SELECT file FROM feed_images WHERE post_id = ?').all(row.id) as { file: string }[]
  coreDb.transaction(() => {
    core("DELETE FROM feed_reactions WHERE target_type = 'comment' AND target_id IN (SELECT id FROM feed_comments WHERE post_id = ?)").run(row.id)
    core("DELETE FROM feed_reactions WHERE target_type = 'post' AND target_id = ?").run(row.id)
    core('DELETE FROM feed_posts WHERE id = ?').run(row.id)
  })()
  for (const f of files) await deleteImage('posts', f.file)
  return c.json({ ok: true })
})

/** Capa de mídia que vem da integração do autor — só as URLs que o próprio post carrega. */
feedRoutes.get('/posts/:id/cover', async (c) => {
  const id = intId(c.req.param('id'))
  const src = c.req.query('src') ?? ''
  const row = id ? getPostRow(id) : undefined
  if (!row || row.status !== 'active' || !coversOfPost(row).has(src)) return c.body(null, 404)
  return proxyOwnerCover(row.author_id, src)
})

feedRoutes.get('/images/:file', async (c) => {
  const file = c.req.param('file')
  if (!core('SELECT 1 FROM feed_images WHERE file = ?').get(file)) return c.json({ error: 'Not found' }, 404)
  const body = await readImage('posts', file)
  if (!body) return c.json({ error: 'Not found' }, 404)
  const bytes = new Uint8Array(body.byteLength)
  bytes.set(body)
  return c.body(bytes, 200, { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable' })
})

/* ───────────────────────────────── Comentários ───────────────────────────────── */

feedRoutes.get('/posts/:id/comments', (c) => {
  const viewer = viewerOf(c)
  const id = intId(c.req.param('id'))
  if (!id || !getPost(id, viewer)) return c.json({ error: 'Post não encontrado.' }, 404)
  return c.json(listComments(id, viewer))
})

feedRoutes.post('/posts/:id/comments', async (c) => {
  const viewer = viewerOf(c)
  if (!commentLimiter.take(`u:${viewer.id}`)) return tooFast(c)
  const id = intId(c.req.param('id'))
  const post = id ? getPostRow(id) : undefined
  if (!post || post.status !== 'active') return c.json({ error: 'Post não encontrado.' }, 404)

  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const body = cleanBody(b.body, COMMENT_MAX)
  if (!body) return c.json({ error: body === null ? `O comentário tem limite de ${COMMENT_MAX} caracteres.` : 'Escreva o comentário.' }, 400)

  // Respostas ficam num nível só: responder a uma resposta entra no mesmo fio.
  let parentId: number | null = null
  let repliedTo: number | null = null
  if (b.parent_id != null) {
    const parent = core('SELECT id, parent_id, author_id, deleted_at FROM feed_comments WHERE id = ? AND post_id = ?')
      .get(Number(b.parent_id), post.id) as { id: number; parent_id: number | null; author_id: number; deleted_at: string | null } | undefined
    if (!parent || parent.deleted_at) return c.json({ error: 'O comentário respondido não existe mais.' }, 400)
    parentId = parent.parent_id ?? parent.id
    repliedTo = parent.author_id
  }

  const parts = textParts(body, b.refs, viewer.id)
  coreDb.transaction(() => {
    const res = core(`
      INSERT INTO feed_comments (post_id, author_id, parent_id, body, refs_json, mentions_json) VALUES (?, ?, ?, ?, ?, ?)
    `).run(post.id, viewer.id, parentId, body, JSON.stringify(parts.refs), JSON.stringify(parts.mentions))
    const commentId = Number(res.lastInsertRowid)
    const told = new Set<number>([viewer.id])
    if (repliedTo != null && !told.has(repliedTo)) {
      notify({ userId: repliedTo, actorId: viewer.id, type: 'reply', postId: post.id, commentId })
      told.add(repliedTo)
    }
    if (!told.has(post.author_id)) {
      notify({ userId: post.author_id, actorId: viewer.id, type: 'comment', postId: post.id, commentId })
      told.add(post.author_id)
    }
    for (const m of parts.mentions) {
      if (told.has(m.id)) continue
      notify({ userId: m.id, actorId: viewer.id, type: 'mention', postId: post.id, commentId })
      told.add(m.id)
    }
  })()
  return c.json(listComments(post.id, viewer), 201)
})

feedRoutes.patch('/comments/:id', async (c) => {
  const viewer = viewerOf(c)
  const id = intId(c.req.param('id'))
  const row = id ? core('SELECT id, post_id, author_id, deleted_at FROM feed_comments WHERE id = ?').get(id) as
    { id: number; post_id: number; author_id: number; deleted_at: string | null } | undefined : undefined
  if (!row || row.deleted_at) return c.json({ error: 'Comentário não encontrado.' }, 404)
  if (row.author_id !== viewer.id) return c.json({ error: 'Só quem escreveu pode editar.' }, 403)
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const body = cleanBody(b.body, COMMENT_MAX)
  if (!body) return c.json({ error: 'Escreva o comentário.' }, 400)
  const parts = textParts(body, b.refs, viewer.id)
  core(`
    UPDATE feed_comments SET body = ?, refs_json = ?, mentions_json = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?
  `).run(body, JSON.stringify(parts.refs), JSON.stringify(parts.mentions), row.id)
  return c.json(listComments(row.post_id, viewer))
})

feedRoutes.delete('/comments/:id', (c) => {
  const viewer = viewerOf(c)
  const id = intId(c.req.param('id'))
  const row = id ? core('SELECT id, post_id, author_id FROM feed_comments WHERE id = ? AND deleted_at IS NULL').get(id) as
    { id: number; post_id: number; author_id: number } | undefined : undefined
  if (!row) return c.json({ error: 'Comentário não encontrado.' }, 404)
  if (row.author_id !== viewer.id && !viewer.admin) return c.json({ error: 'Só quem escreveu (ou um admin) pode apagar.' }, 403)
  core("UPDATE feed_comments SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?").run(row.id)
  core("DELETE FROM feed_reactions WHERE target_type = 'comment' AND target_id = ?").run(row.id)
  core('DELETE FROM notifications WHERE comment_id = ?').run(row.id)
  return c.json(listComments(row.post_id, viewer))
})

/* ─────────────────────────────────── Reações ─────────────────────────────────── */

feedRoutes.put('/reactions', async (c) => {
  const viewer = viewerOf(c)
  if (!reactionLimiter.take(`u:${viewer.id}`)) return tooFast(c)
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const type = b.target_type
  const targetId = Number(b.target_id)
  if ((type !== 'post' && type !== 'comment') || !Number.isInteger(targetId) || !isReaction(b.emoji)) {
    return c.json({ error: 'Reação inválida.' }, 400)
  }

  let authorId: number
  let postId: number
  if (type === 'post') {
    const post = getPostRow(targetId)
    if (!post || post.status !== 'active') return c.json({ error: 'Post não encontrado.' }, 404)
    authorId = post.author_id
    postId = post.id
  } else {
    const comment = core(`
      SELECT c.author_id, c.post_id FROM feed_comments c JOIN feed_posts p ON p.id = c.post_id JOIN users u ON u.id = p.author_id
       WHERE c.id = ? AND c.deleted_at IS NULL AND u.status = 'active'
    `).get(targetId) as { author_id: number; post_id: number } | undefined
    if (!comment) return c.json({ error: 'Comentário não encontrado.' }, 404)
    authorId = comment.author_id
    postId = comment.post_id
  }

  const exists = core('SELECT 1 FROM feed_reactions WHERE target_type = ? AND target_id = ? AND user_id = ? AND emoji = ?')
    .get(type, targetId, viewer.id, b.emoji)
  if (exists) {
    core('DELETE FROM feed_reactions WHERE target_type = ? AND target_id = ? AND user_id = ? AND emoji = ?').run(type, targetId, viewer.id, b.emoji)
  } else {
    core('INSERT OR IGNORE INTO feed_reactions (target_type, target_id, user_id, emoji) VALUES (?, ?, ?, ?)').run(type, targetId, viewer.id, b.emoji)
    notify({ userId: authorId, actorId: viewer.id, type: 'reaction', postId, commentId: type === 'comment' ? targetId : null, detail: b.emoji })
  }
  return c.json({ reactions: reactionsFor(type, [targetId], viewer.id).get(targetId) ?? [] })
})

/* ───────────────────────────── Compartilhar uma lista ───────────────────────────── */

const PREVIEW_PER_TIER = 10
const PREVIEW_ITEMS = 12

feedRoutes.post('/share-list', async (c) => {
  const viewer = viewerOf(c)
  if (!postLimiter.take(`u:${viewer.id}`)) return tooFast(c)
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const listId = Number(b.list_id)
  const body = cleanBody(b.body ?? '', POST_MAX)
  if (body == null) return c.json({ error: `O texto tem limite de ${POST_MAX} caracteres.` }, 400)
  const view = Number.isInteger(listId) ? listView(listId) : null
  if (!view) return c.json({ error: 'Lista não encontrada.' }, 404)

  type Item = { title: string; cover_url: string | null; type: string; tier_id: number | null; rating: number | null }
  const items: Item[] = view.items.map(item => ({
    title: String(item.title), cover_url: (item.cover_url as string | null) ?? null, type: String(item.type),
    tier_id: (item.tier_id as number | null) ?? null, rating: Number(item.rating) > 0 ? Number(item.rating) : null,
  }))
  const tiers = view.tiers as { id: number; name: string; color: string }[]
  const data = {
    list_id: listId,
    name: String(view.name),
    description: (view.description as string | null) ?? null,
    mode: String(view.mode ?? 'list'),
    item_count: items.length,
    tiers: view.mode === 'tier'
      ? tiers.map(t => {
          const inTier = items.filter(i => i.tier_id === t.id)
          return { name: t.name, color: t.color, count: inTier.length, items: inTier.slice(0, PREVIEW_PER_TIER).map(({ title, cover_url, type }) => ({ title, cover_url, type })) }
        })
      : [],
    items: view.mode === 'tier' ? [] : items.slice(0, PREVIEW_ITEMS).map(({ title, cover_url, type, rating }) => ({ title, cover_url, type, rating })),
  }
  const parts = textParts(body, b.refs, viewer.id)
  const postId = coreDb.transaction(() => {
    const res = core(`
      INSERT INTO feed_posts (author_id, kind, body, data_json, refs_json, mentions_json) VALUES (?, 'list', ?, ?, ?, ?)
    `).run(viewer.id, body || null, JSON.stringify(data), JSON.stringify(parts.refs), JSON.stringify(parts.mentions))
    const id = Number(res.lastInsertRowid)
    for (const m of parts.mentions) notify({ userId: m.id, actorId: viewer.id, type: 'mention', postId: id })
    return id
  })()
  return c.json(getPost(postId, viewer), 201)
})

/* ──────────────────────────────── Preferências ──────────────────────────────── */

feedRoutes.get('/preferences', (c) => c.json({
  share_diary: cfg('FEED_SHARE_DIARY') !== '0',
  share_achievements: cfg('FEED_SHARE_ACHIEVEMENTS') !== '0',
}))

feedRoutes.patch('/preferences', async (c) => {
  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
  if (typeof b.share_diary === 'boolean') setCfg('FEED_SHARE_DIARY', b.share_diary ? '1' : '0')
  if (typeof b.share_achievements === 'boolean') setCfg('FEED_SHARE_ACHIEVEMENTS', b.share_achievements ? '1' : '0')
  return c.json({
    share_diary: cfg('FEED_SHARE_DIARY') !== '0',
    share_achievements: cfg('FEED_SHARE_ACHIEVEMENTS') !== '0',
  })
})

/* ═══════════════════════════════ Perfis e listas ═══════════════════════════════ */

export const socialRoutes = new Hono()

function activeUserByName(username: string) {
  return core("SELECT * FROM users WHERE username = ? AND status = 'active'").get(username.toLowerCase()) as UserRow | undefined
}

/** Troca capas que só abrem com as credenciais da outra pessoa por `null`. */
function stripPrivateCovers<T>(value: T): T {
  if (typeof value === 'string') return (value.startsWith('/api/integrations/') ? null : value) as T
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(stripPrivateCovers) as T
  return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, stripPrivateCovers(v)])) as T
}

socialRoutes.get('/users/:username', async (c) => {
  const viewer = viewerOf(c)
  const user = activeUserByName(c.req.param('username'))
  if (!user) return c.json({ error: 'Pessoa não encontrada.' }, 404)
  const isMe = user.id === viewer.id
  const { profile, shareDiary } = await runAsUser(user.id, async () => ({
    profile: await buildProfile(),
    shareDiary: cfg('FEED_SHARE_DIARY') !== '0',
  }))
  if (!isMe && !shareDiary) {
    profile.recent_ratings = []
    profile.activity = []
  }
  const lists = core(`
    SELECT id AS post_id, json_extract(data_json, '$.list_id') AS list_id, json_extract(data_json, '$.name') AS name,
           json_extract(data_json, '$.mode') AS mode, json_extract(data_json, '$.item_count') AS item_count, created_at
      FROM feed_posts WHERE author_id = ? AND kind = 'list' ORDER BY created_at DESC
  `).all(user.id) as { post_id: number; list_id: number; name: string; mode: string; item_count: number; created_at: string }[]
  const seen = new Set<number>()
  return c.json({
    is_me: isMe,
    profile: isMe ? profile : stripPrivateCovers(profile),
    shared_lists: lists.filter(l => (seen.has(l.list_id) ? false : (seen.add(l.list_id), true))),
  })
})

/** Lista de outra pessoa — só as que ela já compartilhou no feed. */
socialRoutes.get('/users/:username/lists/:listId', (c) => {
  const owner = activeUserByName(c.req.param('username'))
  const listId = intId(c.req.param('listId'))
  if (!owner || !listId) return c.json({ error: 'Lista não encontrada.' }, 404)
  const shared = core("SELECT 1 FROM feed_posts WHERE author_id = ? AND kind = 'list' AND json_extract(data_json, '$.list_id') = ?")
    .get(owner.id, listId)
  if (!shared) return c.json({ error: 'Essa lista não foi compartilhada.' }, 404)
  const view = runAsUser(owner.id, () => listView(listId))
  if (!view) return c.json({ error: 'A lista não existe mais.' }, 404)
  return c.json({
    id: listId,
    name: view.name,
    description: view.description ?? null,
    mode: view.mode ?? 'list',
    owner: authorView(owner, owner.id),
    tiers: view.tiers,
    // Só o que descreve a obra e a posição na lista — nada de notas pessoais, arquivos etc.
    items: view.items.map((item, index) => ({
      id: index + 1,
      type: item.type,
      external_id: item.external_id,
      title: item.title,
      cover_url: safeCoverUrl(item.cover_url) ?? (typeof item.cover_url === 'string' && item.cover_url.startsWith('/api/covers/') ? item.cover_url : null),
      year: item.year ?? null,
      rating: Number(item.rating) > 0 ? item.rating : null,
      tier_id: item.tier_id ?? null,
      list_position: item.list_position,
    })),
  })
})

/* ════════════════════════════════ Notificações ════════════════════════════════ */

export const notificationRoutes = new Hono()

notificationRoutes.get('/', (c) => c.json(listNotifications(viewerOf(c).id)))

notificationRoutes.get('/count', (c) => {
  const row = core('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(viewerOf(c).id) as { n: number }
  return c.json({ unread: row.n })
})

notificationRoutes.post('/read', async (c) => {
  const viewer = viewerOf(c)
  const b = await c.req.json().catch(() => ({})) as { ids?: unknown }
  const now = new Date().toISOString()
  if (Array.isArray(b.ids)) {
    const ids = b.ids.map(Number).filter(Number.isInteger).slice(0, 200)
    for (const id of ids) core('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL').run(now, id, viewer.id)
  } else {
    core('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now, viewer.id)
  }
  return c.json(listNotifications(viewer.id))
})
