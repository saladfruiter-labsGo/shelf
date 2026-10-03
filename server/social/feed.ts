/**
 * Leitura e escrita do feed social (banco núcleo).
 *
 * Visibilidade: todo membro ativo vê o feed de todos os membros ativos — a
 * instância é um grupo fechado de amigos, criado pelo administrador. Posts de
 * contas desativadas somem do feed (e voltam se a conta for reativada).
 *
 * Nada pessoal sai daqui além do que a própria pessoa compartilhou: o id
 * local da mídia (útil só para o autor abrir a página dele) é omitido para
 * os outros, e capas servidas pelas integrações do autor (Plex, Kavita)
 * passam por um proxy que valida a origem.
 */
import { core } from '../core-db.js'
import { avatarUrl } from '../auth/accounts.js'
import type { MediaRef, Mention } from './text.js'

export const REACTIONS = ['❤️', '🔥', '😂', '😮', '😢', '👏'] as const
export type Reaction = typeof REACTIONS[number]
export function isReaction(value: unknown): value is Reaction {
  return typeof value === 'string' && (REACTIONS as readonly string[]).includes(value)
}

export interface Viewer { id: number; admin: boolean }

export interface AuthorView { id: number; username: string; display_name: string; avatar_url: string | null }

export interface ReactionSummary { emoji: string; count: number; mine: boolean; names: string[] }

interface PostRow {
  id: number; author_id: number; kind: string; body: string | null
  media_json: string | null; data_json: string | null; refs_json: string | null; mentions_json: string | null
  created_at: string; updated_at: string
  username: string; display_name: string; avatar_file: string | null
}

const parse = <T>(raw: string | null): T | null => {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

/** Capas que só abrem com as credenciais do autor viram um proxy do próprio post. */
export function viewerCover(postId: number, url: string | null | undefined): string | null {
  if (!url) return null
  if (url.startsWith('/api/integrations/')) return `/api/feed/posts/${postId}/cover?src=${encodeURIComponent(url)}`
  return url
}

/** Todas as URLs de capa que um post carrega — o proxy só aceita estas. */
export function coversOfPost(row: Pick<PostRow, 'media_json' | 'data_json' | 'refs_json'>): Set<string> {
  const found = new Set<string>()
  const walk = (value: unknown) => {
    if (!value || typeof value !== 'object') return
    if (Array.isArray(value)) { value.forEach(walk); return }
    for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
      if ((key === 'cover_url' || key === 'icon') && typeof inner === 'string') found.add(inner)
      else walk(inner)
    }
  }
  walk(parse(row.media_json))
  walk(parse(row.data_json))
  walk(parse(row.refs_json))
  return found
}

function rewriteCovers(postId: number, value: unknown): unknown {
  if (!value || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(v => rewriteCovers(postId, v))
  const out: Record<string, unknown> = {}
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    out[key] = key === 'cover_url' && typeof inner === 'string' ? viewerCover(postId, inner) : rewriteCovers(postId, inner)
  }
  return out
}

export function authorView(row: { author_id?: number; id?: number; username: string; display_name: string; avatar_file: string | null }, id: number): AuthorView {
  return { id, username: row.username, display_name: row.display_name, avatar_url: avatarUrl(row.avatar_file) }
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(', ')
}

/** Contagem de reações por alvo, com os nomes de quem reagiu (para o tooltip). */
export function reactionsFor(type: 'post' | 'comment', ids: number[], viewerId: number): Map<number, ReactionSummary[]> {
  const result = new Map<number, ReactionSummary[]>()
  if (!ids.length) return result
  const rows = core(`
    SELECT r.target_id, r.emoji, r.user_id, u.display_name
      FROM feed_reactions r JOIN users u ON u.id = r.user_id
     WHERE r.target_type = ? AND r.target_id IN (${placeholders(ids.length)}) AND u.status = 'active'
     ORDER BY r.created_at
  `).all(type, ...ids) as { target_id: number; emoji: string; user_id: number; display_name: string }[]
  for (const row of rows) {
    const list = result.get(row.target_id) ?? []
    let entry = list.find(e => e.emoji === row.emoji)
    if (!entry) {
      entry = { emoji: row.emoji, count: 0, mine: false, names: [] }
      list.push(entry)
    }
    entry.count++
    if (row.user_id === viewerId) entry.mine = true
    if (entry.names.length < 12) entry.names.push(row.display_name)
    result.set(row.target_id, list)
  }
  for (const list of result.values()) list.sort((a, b) => REACTIONS.indexOf(a.emoji as Reaction) - REACTIONS.indexOf(b.emoji as Reaction))
  return result
}

export interface PostView {
  id: number
  kind: string
  created_at: string
  updated_at: string
  author: AuthorView
  body: string | null
  media: Record<string, unknown> | null
  data: unknown
  refs: MediaRef[]
  mentions: Mention[]
  images: { url: string; width: number; height: number }[]
  reactions: ReactionSummary[]
  comment_count: number
  can_delete: boolean
}

function serialize(rows: PostRow[], viewer: Viewer): PostView[] {
  if (!rows.length) return []
  const ids = rows.map(r => r.id)
  const images = core(`
    SELECT post_id, file, width, height FROM feed_images WHERE post_id IN (${placeholders(ids.length)}) ORDER BY position, id
  `).all(...ids) as { post_id: number; file: string; width: number; height: number }[]
  const comments = new Map((core(`
    SELECT c.post_id, COUNT(*) AS n
      FROM feed_comments c JOIN users u ON u.id = c.author_id
     WHERE c.post_id IN (${placeholders(ids.length)}) AND c.deleted_at IS NULL AND u.status = 'active'
     GROUP BY c.post_id
  `).all(...ids) as { post_id: number; n: number }[]).map(r => [r.post_id, r.n]))
  const reactions = reactionsFor('post', ids, viewer.id)

  return rows.map(row => {
    const media = parse<Record<string, unknown>>(row.media_json)
    if (media) {
      // O id local só faz sentido para o autor (abre a página da mídia dele).
      if (row.author_id !== viewer.id) delete media.local_id
      media.cover_url = viewerCover(row.id, media.cover_url as string | null)
    }
    return {
      id: row.id,
      kind: row.kind,
      created_at: row.created_at,
      updated_at: row.updated_at,
      author: authorView(row, row.author_id),
      body: row.body,
      media,
      data: rewriteCovers(row.id, parse(row.data_json)),
      refs: (rewriteCovers(row.id, parse<MediaRef[]>(row.refs_json) ?? []) as MediaRef[]),
      mentions: parse<Mention[]>(row.mentions_json) ?? [],
      images: images.filter(i => i.post_id === row.id).map(i => ({ url: `/api/feed/images/${i.file}`, width: i.width, height: i.height })),
      reactions: reactions.get(row.id) ?? [],
      comment_count: comments.get(row.id) ?? 0,
      can_delete: row.author_id === viewer.id || viewer.admin,
    }
  })
}

const POST_SELECT = `
  SELECT p.id, p.author_id, p.kind, p.body, p.media_json, p.data_json, p.refs_json, p.mentions_json,
         p.created_at, p.updated_at, u.username, u.display_name, u.avatar_file
    FROM feed_posts p JOIN users u ON u.id = p.author_id
`

export interface FeedPage { posts: PostView[]; next: string | null }

/** Página do feed por cursor (`created_at|id`), nunca por OFFSET. */
export function listFeed(viewer: Viewer, opts: { before?: string | null; authorId?: number | null; limit?: number }): FeedPage {
  const limit = Math.min(Math.max(opts.limit ?? 20, 1), 50)
  const where: string[] = ["u.status = 'active'"]
  const params: unknown[] = []
  if (opts.authorId != null) { where.push('p.author_id = ?'); params.push(opts.authorId) }
  if (opts.before) {
    const [at, id] = opts.before.split('|')
    if (at && Number.isInteger(Number(id))) {
      where.push('(p.created_at < ? OR (p.created_at = ? AND p.id < ?))')
      params.push(at, at, Number(id))
    }
  }
  const rows = core(`${POST_SELECT} WHERE ${where.join(' AND ')} ORDER BY p.created_at DESC, p.id DESC LIMIT ?`)
    .all(...params, limit + 1) as PostRow[]
  const page = rows.slice(0, limit)
  const last = page[page.length - 1]
  return {
    posts: serialize(page, viewer),
    next: rows.length > limit && last ? `${last.created_at}|${last.id}` : null,
  }
}

export function getPostRow(id: number): (PostRow & { status: string }) | undefined {
  return core(`
    SELECT p.id, p.author_id, p.kind, p.body, p.media_json, p.data_json, p.refs_json, p.mentions_json,
           p.created_at, p.updated_at, u.username, u.display_name, u.avatar_file, u.status
      FROM feed_posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?
  `).get(id) as (PostRow & { status: string }) | undefined
}

/** Um post visível para o leitor (autor ativo), ou nada. */
export function getPost(id: number, viewer: Viewer): PostView | null {
  const row = getPostRow(id)
  if (!row || row.status !== 'active') return null
  return serialize([row], viewer)[0] ?? null
}

/* ─────────────────────────────── Comentários ─────────────────────────────── */

export interface CommentView {
  id: number
  post_id: number
  parent_id: number | null
  author: AuthorView
  body: string | null
  deleted: boolean
  refs: MediaRef[]
  mentions: Mention[]
  created_at: string
  edited: boolean
  reactions: ReactionSummary[]
  can_edit: boolean
  can_delete: boolean
}

export function listComments(postId: number, viewer: Viewer): CommentView[] {
  const rows = core(`
    SELECT c.*, u.username, u.display_name, u.avatar_file
      FROM feed_comments c JOIN users u ON u.id = c.author_id
     WHERE c.post_id = ? AND u.status = 'active'
     ORDER BY c.created_at, c.id
  `).all(postId) as {
    id: number; post_id: number; author_id: number; parent_id: number | null; body: string
    refs_json: string | null; mentions_json: string | null; created_at: string; updated_at: string; deleted_at: string | null
    username: string; display_name: string; avatar_file: string | null
  }[]
  const reactions = reactionsFor('comment', rows.map(r => r.id), viewer.id)
  return rows
    // Removido sem respostas some; com respostas, fica o marcador para o fio fazer sentido.
    .filter(r => !r.deleted_at || rows.some(other => other.parent_id === r.id && !other.deleted_at))
    .map(r => ({
      id: r.id,
      post_id: r.post_id,
      parent_id: r.parent_id,
      author: authorView(r, r.author_id),
      body: r.deleted_at ? null : r.body,
      deleted: Boolean(r.deleted_at),
      refs: r.deleted_at ? [] : (rewriteCovers(r.post_id, parse<MediaRef[]>(r.refs_json) ?? []) as MediaRef[]),
      mentions: r.deleted_at ? [] : parse<Mention[]>(r.mentions_json) ?? [],
      created_at: r.created_at,
      edited: r.updated_at !== r.created_at,
      reactions: r.deleted_at ? [] : reactions.get(r.id) ?? [],
      can_edit: !r.deleted_at && r.author_id === viewer.id,
      can_delete: !r.deleted_at && (r.author_id === viewer.id || viewer.admin),
    }))
}

/* ─────────────────────────────── Notificações ─────────────────────────────── */

export type NotificationType = 'comment' | 'reply' | 'reaction' | 'mention' | 'dm'

export function notify(input: {
  userId: number
  actorId: number
  type: NotificationType
  postId?: number | null
  commentId?: number | null
  detail?: string | null
}): void {
  if (input.userId === input.actorId) return
  const recipient = core("SELECT 1 FROM users WHERE id = ? AND status = 'active'").get(input.userId)
  if (!recipient) return
  // Reagir, tirar e reagir de novo não empilha avisos iguais ainda não lidos.
  if (input.type === 'reaction') {
    const dup = core(`
      SELECT 1 FROM notifications
       WHERE user_id = ? AND actor_id = ? AND type = 'reaction' AND read_at IS NULL
         AND COALESCE(post_id, 0) = ? AND COALESCE(comment_id, 0) = ?
    `).get(input.userId, input.actorId, input.postId ?? 0, input.commentId ?? 0)
    if (dup) return
  }
  core(`
    INSERT INTO notifications (user_id, actor_id, type, post_id, comment_id, detail) VALUES (?, ?, ?, ?, ?, ?)
  `).run(input.userId, input.actorId, input.type, input.postId ?? null, input.commentId ?? null, input.detail ?? null)
}

export interface NotificationView {
  id: number
  type: NotificationType
  actor: AuthorView | null
  post_id: number | null
  comment_id: number | null
  detail: string | null
  snippet: string | null
  created_at: string
  read: boolean
}

function snippetOf(row: { kind: string | null; body: string | null; media_json: string | null; data_json: string | null }): string | null {
  if (!row.kind) return null
  if (row.body) return row.body.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1').slice(0, 90)
  const media = parse<{ title?: string }>(row.media_json)
  if (media?.title) return media.title
  const data = parse<{ name?: string }>(row.data_json)
  return data?.name ?? null
}

export function listNotifications(userId: number, limit = 40): { unread: number; items: NotificationView[] } {
  const rows = core(`
    SELECT n.*, a.username, a.display_name, a.avatar_file,
           p.kind, p.body, p.media_json, p.data_json, c.body AS comment_body
      FROM notifications n
      LEFT JOIN users a ON a.id = n.actor_id
      LEFT JOIN feed_posts p ON p.id = n.post_id
      LEFT JOIN feed_comments c ON c.id = n.comment_id
     WHERE n.user_id = ?
     ORDER BY n.id DESC LIMIT ?
  `).all(userId, limit) as (Record<string, unknown> & {
    id: number; type: NotificationType; actor_id: number | null; post_id: number | null; comment_id: number | null
    detail: string | null; created_at: string; read_at: string | null
    username: string | null; display_name: string | null; avatar_file: string | null
    kind: string | null; body: string | null; media_json: string | null; data_json: string | null; comment_body: string | null
  })[]
  const unread = (core('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(userId) as { n: number }).n
  return {
    unread,
    items: rows.map(r => ({
      id: r.id,
      type: r.type,
      actor: r.actor_id && r.username ? authorView({ username: r.username, display_name: r.display_name ?? r.username, avatar_file: r.avatar_file }, r.actor_id) : null,
      post_id: r.post_id,
      comment_id: r.comment_id,
      detail: r.detail,
      snippet: r.comment_body
        ? r.comment_body.replace(/\[\[[^|\]]+\|([^\]]+)\]\]/g, '$1').slice(0, 90)
        : snippetOf(r),
      created_at: r.created_at,
      read: Boolean(r.read_at),
    })),
  }
}
