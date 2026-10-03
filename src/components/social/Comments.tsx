import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api } from '../../lib/api'
import { timeAgo } from '../../lib/utils'
import { Avatar } from '../Avatar'
import { Composer } from './Composer'
import { RichText } from './RichText'
import { Reactions } from './Reactions'
import type { FeedComment } from '../../types'

function CommentItem({ comment, onReply, onChange }: {
  comment: FeedComment
  onReply: (comment: FeedComment) => void
  onChange: (list: FeedComment[]) => void
}) {
  const [editing, setEditing] = useState(false)
  if (comment.deleted) {
    return <p id={`c${comment.id}`} className="text-sm text-muted italic py-2">Comentário removido.</p>
  }
  return (
    <div id={`c${comment.id}`} className="flex gap-3 py-2 scroll-mt-24">
      <Link to={`/u/${comment.author.username}`} aria-label={`Perfil de ${comment.author.display_name}`}>
        <Avatar name={comment.author.display_name} url={comment.author.avatar_url} id={comment.author.id} size={32} />
      </Link>
      <div className="min-w-0 flex-1">
        {editing ? (
          <Composer
            compact autoFocus placeholder="Editar comentário" submitLabel="Salvar"
            initial={{ body: comment.body ?? '', refs: comment.refs }}
            onCancel={() => setEditing(false)}
            onSubmit={async ({ body, refs }) => { onChange(await api.feed.editComment(comment.id, { body, refs })); setEditing(false) }}
          />
        ) : (
          <>
            <div className="bg-card rounded-xl px-3 py-2">
              <p className="text-sm">
                <Link to={`/u/${comment.author.username}`} className="font-semibold text-primary hover:underline">{comment.author.display_name}</Link>
                <span className="text-muted"> · {timeAgo(comment.created_at)}{comment.edited ? ' · editado' : ''}</span>
              </p>
              <RichText body={comment.body ?? ''} mentions={comment.mentions} refs={comment.refs} className="text-primary" />
            </div>
            <div className="flex items-center gap-1 mt-1 flex-wrap">
              <Reactions targetType="comment" targetId={comment.id} initial={comment.reactions} compact />
              <button type="button" className="social-action text-sm" onClick={() => onReply(comment)}>Responder</button>
              {comment.can_edit && <button type="button" className="social-action text-sm" onClick={() => setEditing(true)}>Editar</button>}
              {comment.can_delete && (
                <button type="button" className="social-action text-sm" onClick={async () => onChange(await api.feed.removeComment(comment.id))}>
                  Apagar
                </button>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Comentários de um post: um nível de respostas, com o compositor no fim de cada fio. */
export function Comments({ postId, comments, onChange }: {
  postId: number
  comments: FeedComment[] | undefined
  onChange: (list: FeedComment[]) => void
}) {
  const [replyTo, setReplyTo] = useState<FeedComment | null>(null)
  if (!comments) return <p className="text-sm text-muted mt-3">Carregando comentários…</p>

  const roots = comments.filter(c => c.parent_id == null)
  const threadOf = (rootId: number) => comments.filter(c => c.parent_id === rootId)
  const rootOfReply = replyTo ? (replyTo.parent_id ?? replyTo.id) : null

  return (
    <section className="mt-3" aria-label="Comentários">
      {roots.map(root => (
        <div key={root.id}>
          <CommentItem comment={root} onReply={setReplyTo} onChange={onChange} />
          <div className="pl-10">
            {threadOf(root.id).map(reply => (
              <CommentItem key={reply.id} comment={reply} onReply={setReplyTo} onChange={onChange} />
            ))}
            {rootOfReply === root.id && replyTo && (
              <div className="py-2">
                <Composer
                  key={replyTo.id}
                  compact autoFocus submitLabel="Responder"
                  placeholder={`Responder ${replyTo.author.display_name}`}
                  initial={{ body: `@${replyTo.author.username} ` }}
                  onCancel={() => setReplyTo(null)}
                  onSubmit={async ({ body, refs }) => {
                    onChange(await api.feed.comment(postId, { body, refs, parent_id: replyTo.id }))
                    setReplyTo(null)
                  }}
                />
              </div>
            )}
          </div>
        </div>
      ))}
      <div className="pt-2">
        <Composer
          compact placeholder="Escreva um comentário… (@ para marcar alguém)" submitLabel="Comentar"
          onSubmit={async ({ body, refs }) => onChange(await api.feed.comment(postId, { body, refs }))}
        />
      </div>
    </section>
  )
}
