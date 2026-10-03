/**
 * Mensagens diretas entre duas pessoas da instância.
 *
 * Além de texto (com mídias marcadas), uma mensagem pode levar um item da
 * biblioteca de quem manda: o servidor tira um retrato dele no banco pessoal
 * do remetente (título, capa, a nota e o status dele, a última resenha) —
 * quem recebe nunca acessa o banco de quem mandou.
 *
 * Só os dois participantes leem a conversa; ninguém mais, nem admin.
 */
import { Hono, type Context } from 'hono'
import { core, coreDb } from '../core-db.js'
import { db, runAsUser } from '../db.js'
import { avatarUrl, type UserRow } from '../auth/accounts.js'
import { ActionLimiter } from '../auth/rate-limit.js'
import { cleanBody, extractRefs } from '../social/text.js'
import integrationsRoutes from './integrations.js'

const MESSAGE_MAX = 2000
const PAGE = 50
const limiter = new ActionLimiter(90, 10 * 60_000)

const app = new Hono()

interface Person { id: number; username: string; display_name: string; avatar_url: string | null }

function person(row: { id: number; username: string; display_name: string; avatar_file: string | null }): Person {
  return { id: row.id, username: row.username, display_name: row.display_name, avatar_url: avatarUrl(row.avatar_file) }
}

const me = (c: Context) => c.get('user') as UserRow

function activeUser(username: string) {
  return core("SELECT id, username, display_name, avatar_file FROM users WHERE username = ? AND status = 'active'")
    .get(username.toLowerCase()) as { id: number; username: string; display_name: string; avatar_file: string | null } | undefined
}

const pair = (a: number, b: number): [number, number] => (a < b ? [a, b] : [b, a])

function findConversation(a: number, b: number): number | null {
  const [x, y] = pair(a, b)
  const row = core('SELECT id FROM dm_conversations WHERE user_a = ? AND user_b = ?').get(x, y) as { id: number } | undefined
  return row?.id ?? null
}

function ensureConversation(a: number, b: number): number {
  const existing = findConversation(a, b)
  if (existing) return existing
  const [x, y] = pair(a, b)
  return Number(core('INSERT INTO dm_conversations (user_a, user_b) VALUES (?, ?)').run(x, y).lastInsertRowid)
}

/** Capas que só abrem com as credenciais do remetente passam pelo proxy da própria mensagem. */
function viewerCover(messageId: number, url: unknown): string | null {
  if (typeof url !== 'string' || !url) return null
  return url.startsWith('/api/integrations/') ? `/api/messages/items/${messageId}/cover?src=${encodeURIComponent(url)}` : url
}

interface MessageRow {
  id: number; conversation_id: number; sender_id: number; body: string | null
  media_json: string | null; refs_json: string | null; created_at: string; deleted_at: string | null
}

function view(row: MessageRow, viewerId: number) {
  if (row.deleted_at) {
    return { id: row.id, sender_id: row.sender_id, mine: row.sender_id === viewerId, deleted: true, body: null, media: null, refs: [], created_at: row.created_at }
  }
  const media = row.media_json ? JSON.parse(row.media_json) as Record<string, unknown> : null
  if (media) {
    media.cover_url = viewerCover(row.id, media.cover_url)
    if (row.sender_id !== viewerId) delete media.local_id
  }
  const refs = row.refs_json ? (JSON.parse(row.refs_json) as Record<string, unknown>[]).map(r => ({ ...r, cover_url: viewerCover(row.id, r.cover_url) })) : []
  return { id: row.id, sender_id: row.sender_id, mine: row.sender_id === viewerId, deleted: false, body: row.body, media, refs, created_at: row.created_at }
}

function unreadIn(conversationId: number, userId: number): number {
  const read = core('SELECT last_read_message_id AS id FROM dm_reads WHERE conversation_id = ? AND user_id = ?').get(conversationId, userId) as { id: number } | undefined
  return (core(`
    SELECT COUNT(*) AS n FROM dm_messages WHERE conversation_id = ? AND sender_id != ? AND id > ? AND deleted_at IS NULL
  `).get(conversationId, userId, read?.id ?? 0) as { n: number }).n
}

function markRead(conversationId: number, userId: number): void {
  const last = core('SELECT MAX(id) AS id FROM dm_messages WHERE conversation_id = ?').get(conversationId) as { id: number | null }
  core(`
    INSERT INTO dm_reads (conversation_id, user_id, last_read_message_id) VALUES (?, ?, ?)
    ON CONFLICT(conversation_id, user_id) DO UPDATE SET last_read_message_id = MAX(last_read_message_id, excluded.last_read_message_id)
  `).run(conversationId, userId, last.id ?? 0)
}

/** Retrato de um item da biblioteca de quem manda (roda no banco pessoal dele). */
function libraryItemSnapshot(mediaItemId: number): Record<string, unknown> | null {
  const item = db.prepare(`
    SELECT id, type, external_id, title, cover_url, year, genre, rating, status, game_status, playtime_seconds
      FROM media_items WHERE id = ?
  `).get(mediaItemId) as Record<string, unknown> | undefined
  if (!item) return null
  const review = db.prepare(`
    SELECT comment, rating, watched_at FROM diary_entries
     WHERE media_item_id = ? AND comment IS NOT NULL AND TRIM(comment) <> ''
     ORDER BY watched_at DESC, id DESC LIMIT 1
  `).get(mediaItemId) as { comment: string; rating: number | null; watched_at: string } | undefined
  return {
    local_id: item.id,
    type: item.type,
    external_id: item.external_id,
    title: item.title,
    cover_url: item.cover_url ?? null,
    year: item.year ?? null,
    genre: item.genre ?? null,
    rating: Number(item.rating) > 0 ? item.rating : null,
    status: item.status,
    game_status: item.game_status ?? null,
    playtime_seconds: item.playtime_seconds ?? null,
    review: review ? { comment: review.comment, rating: review.rating, watched_at: review.watched_at } : null,
  }
}

/* ─────────────────────────────────── Rotas ─────────────────────────────────── */

/** Conversas de quem está logado, com a última mensagem e quantas não lidas. */
app.get('/', (c) => {
  const user = me(c)
  const rows = core(`
    SELECT c.id, c.last_message_at,
           o.id AS other_id, o.username, o.display_name, o.avatar_file,
           m.id AS message_id, m.sender_id, m.body, m.media_json, m.deleted_at
      FROM dm_conversations c
      JOIN users o ON o.id = CASE WHEN c.user_a = ? THEN c.user_b ELSE c.user_a END
      LEFT JOIN dm_messages m ON m.id = (SELECT MAX(id) FROM dm_messages WHERE conversation_id = c.id)
     WHERE (c.user_a = ? OR c.user_b = ?) AND o.status = 'active' AND c.last_message_at IS NOT NULL
     ORDER BY c.last_message_at DESC
  `).all(user.id, user.id, user.id) as {
    id: number; last_message_at: string; other_id: number; username: string; display_name: string; avatar_file: string | null
    message_id: number | null; sender_id: number | null; body: string | null; media_json: string | null; deleted_at: string | null
  }[]
  return c.json(rows.map(r => ({
    id: r.id,
    other: person({ id: r.other_id, username: r.username, display_name: r.display_name, avatar_file: r.avatar_file }),
    last_message_at: r.last_message_at,
    last: r.message_id == null ? null : {
      mine: r.sender_id === user.id,
      text: r.deleted_at ? 'Mensagem apagada'
        : r.body ? r.body.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1').slice(0, 100)
          : r.media_json ? `Compartilhou ${(JSON.parse(r.media_json) as { title?: string }).title ?? 'um item'}` : '',
    },
    unread: unreadIn(r.id, user.id),
  })))
})

app.get('/unread', (c) => {
  const user = me(c)
  const ids = core('SELECT id FROM dm_conversations WHERE user_a = ? OR user_b = ?').all(user.id, user.id) as { id: number }[]
  return c.json({ unread: ids.reduce((sum, { id }) => sum + unreadIn(id, user.id), 0) })
})

/** A conversa com alguém (mais recentes primeiro na busca; devolvidas em ordem cronológica). */
app.get('/with/:username', (c) => {
  const user = me(c)
  const other = activeUser(c.req.param('username'))
  if (!other) return c.json({ error: 'Pessoa não encontrada.' }, 404)
  if (other.id === user.id) return c.json({ error: 'Não dá para mandar mensagem para si mesmo.' }, 400)
  const conversationId = findConversation(user.id, other.id)
  if (!conversationId) return c.json({ conversation_id: null, other: person(other), messages: [], has_more: false })
  const before = Number(c.req.query('before'))
  const rows = core(`
    SELECT * FROM dm_messages WHERE conversation_id = ? ${Number.isInteger(before) && before > 0 ? 'AND id < ?' : ''}
     ORDER BY id DESC LIMIT ?
  `).all(...(Number.isInteger(before) && before > 0 ? [conversationId, before, PAGE + 1] : [conversationId, PAGE + 1])) as MessageRow[]
  // Abrir a conversa (sem paginar para trás) marca tudo como lido.
  if (!before) markRead(conversationId, user.id)
  return c.json({
    conversation_id: conversationId,
    other: person(other),
    messages: rows.slice(0, PAGE).reverse().map(r => view(r, user.id)),
    has_more: rows.length > PAGE,
  })
})

app.post('/with/:username', async (c) => {
  const user = me(c)
  if (!limiter.take(`u:${user.id}`)) return c.json({ error: 'Muitas mensagens em pouco tempo — espere um pouco.' }, 429)
  const other = activeUser(c.req.param('username'))
  if (!other) return c.json({ error: 'Pessoa não encontrada.' }, 404)
  if (other.id === user.id) return c.json({ error: 'Não dá para mandar mensagem para si mesmo.' }, 400)

  const b = await c.req.json().catch(() => ({})) as Record<string, unknown>
  const body = cleanBody(b.body ?? '', MESSAGE_MAX)
  if (body == null) return c.json({ error: `A mensagem tem limite de ${MESSAGE_MAX} caracteres.` }, 400)
  let media: Record<string, unknown> | null = null
  if (b.media_item_id != null) {
    const id = Number(b.media_item_id)
    // Lido no banco de quem manda: só dá para compartilhar o que é seu.
    media = Number.isInteger(id) && id > 0 ? libraryItemSnapshot(id) : null
    if (!media) return c.json({ error: 'Item não encontrado na sua biblioteca.' }, 404)
  }
  const refs = extractRefs(body, b.refs)
  if (!body && !media && !refs.length) return c.json({ error: 'Escreva uma mensagem.' }, 400)

  const message = coreDb.transaction(() => {
    const conversationId = ensureConversation(user.id, other.id)
    const now = new Date().toISOString()
    const res = core(`
      INSERT INTO dm_messages (conversation_id, sender_id, body, media_json, refs_json, created_at) VALUES (?, ?, ?, ?, ?, ?)
    `).run(conversationId, user.id, body || null, media ? JSON.stringify(media) : null, refs.length ? JSON.stringify(refs) : null, now)
    core('UPDATE dm_conversations SET last_message_at = ? WHERE id = ?').run(now, conversationId)
    markRead(conversationId, user.id)
    return core('SELECT * FROM dm_messages WHERE id = ?').get(Number(res.lastInsertRowid)) as MessageRow
  })()
  return c.json(view(message, user.id), 201)
})

app.post('/with/:username/read', (c) => {
  const user = me(c)
  const other = activeUser(c.req.param('username'))
  const conversationId = other ? findConversation(user.id, other.id) : null
  if (conversationId) markRead(conversationId, user.id)
  return c.json({ ok: true })
})

/** Apagar a própria mensagem (fica o aviso "mensagem apagada"). */
app.delete('/items/:id', (c) => {
  const user = me(c)
  const row = core('SELECT * FROM dm_messages WHERE id = ?').get(Number(c.req.param('id'))) as MessageRow | undefined
  if (!row || row.deleted_at) return c.json({ error: 'Mensagem não encontrada.' }, 404)
  if (row.sender_id !== user.id) return c.json({ error: 'Só quem mandou pode apagar.' }, 403)
  core("UPDATE dm_messages SET deleted_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), body = NULL, media_json = NULL, refs_json = NULL WHERE id = ?").run(row.id)
  return c.json(view({ ...row, deleted_at: 'now' }, user.id))
})

/** Capa vinda do Plex/Kavita de quem mandou — só para os dois participantes e só as URLs da mensagem. */
app.get('/items/:id/cover', async (c) => {
  const user = me(c)
  const src = c.req.query('src') ?? ''
  const row = core(`
    SELECT m.*, conv.user_a, conv.user_b FROM dm_messages m JOIN dm_conversations conv ON conv.id = m.conversation_id WHERE m.id = ?
  `).get(Number(c.req.param('id'))) as (MessageRow & { user_a: number; user_b: number }) | undefined
  if (!row || row.deleted_at || (row.user_a !== user.id && row.user_b !== user.id) || !src.startsWith('/api/integrations/')) return c.body(null, 404)
  const covers = new Set<string>()
  if (row.media_json) covers.add(String((JSON.parse(row.media_json) as { cover_url?: string }).cover_url))
  for (const ref of row.refs_json ? JSON.parse(row.refs_json) as { cover_url?: string }[] : []) covers.add(String(ref.cover_url))
  if (!covers.has(src)) return c.body(null, 404)
  const res = await runAsUser(row.sender_id, async () => integrationsRoutes.request(src.slice('/api/integrations'.length)))
  if (!res.ok) return c.body(null, res.status as 404)
  return new Response(res.body, { headers: { 'Content-Type': res.headers.get('content-type') ?? 'image/jpeg', 'Cache-Control': 'private, max-age=86400' } })
})

export default app
