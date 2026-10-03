import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { imageUrl } from '../../lib/images'
import { CATEGORIES } from '../../lib/categories'
import { tierVar } from '../../lib/lists'
import { formatPlaytime, timeAgoLong } from '../../lib/utils'
import { Avatar } from '../Avatar'
import { StarRating } from '../StarRating'
import { ConfirmDialog } from '../ConfirmDialog'
import { useMediaPreview } from '../MediaSummaryModal'
import { RichText } from './RichText'
import { Reactions } from './Reactions'
import { Comments } from './Comments'
import { WantButton } from './WantButton'
import type {
  FeedAchievementsData, FeedDiaryData, FeedListData, FeedListPreviewItem, FeedMedia, FeedPost, MediaRef,
} from '../../types'

const emojiOf = (type: string) => CATEGORIES.find(c => c.key === type)?.emoji ?? '🎞️'

function diaryAction(media: FeedMedia, d: FeedDiaryData): { verb: string; detail: string | null } {
  switch (media.type) {
    case 'series':
      if (d.episode_number != null) {
        return { verb: 'assistiu', detail: `T${d.season_number}E${d.episode_number}${d.episode_title ? ` · ${d.episode_title}` : ''}` }
      }
      if (d.season_number != null) return { verb: `terminou a temporada ${d.season_number} de`, detail: null }
      return { verb: 'assistiu', detail: null }
    case 'game':
      if (d.progress && d.progress.unit === 'seconds') return { verb: 'jogou', detail: `${formatPlaytime(d.progress.value)} acumulados` }
      return { verb: d.game_status === 'platinado' ? 'platinou' : 'zerou', detail: null }
    case 'book':
      if (d.progress && d.progress.unit === 'pages') {
        return { verb: 'está lendo', detail: `até a pág. ${d.progress.value}${d.progress.total ? ` de ${d.progress.total}` : ''}` }
      }
      return { verb: 'terminou de ler', detail: null }
    case 'music':
      return { verb: 'ouviu', detail: null }
    default:
      return { verb: 'assistiu', detail: null }
  }
}

function headline(post: FeedPost): string {
  if (post.kind === 'diary' && post.media && post.data) return diaryAction(post.media, post.data as FeedDiaryData).verb
  if (post.kind === 'achievements') {
    const n = (post.data as FeedAchievementsData).items.length
    return `desbloqueou ${n} ${n === 1 ? 'conquista' : 'conquistas'} em`
  }
  if (post.kind === 'list') return (post.data as FeedListData).mode === 'tier' ? 'compartilhou uma tier list' : 'compartilhou uma lista'
  return ''
}

function Cover({ url, title, type, w = 72, h = 108 }: { url: string | null; title: string; type: string; w?: number; h?: number }) {
  const src = url ? (url.startsWith('/') ? url : imageUrl(url, w * 2)) : null
  return src
    ? <img src={src} alt="" width={w} height={h} loading="lazy" className="rounded-lg object-cover bg-card flex-shrink-0" style={{ width: w, height: h }} title={title} />
    : <span className="rounded-lg bg-card flex items-center justify-center flex-shrink-0 text-2xl" style={{ width: w, height: h }} aria-hidden>{emojiOf(type)}</span>
}

function MediaBlock({ post }: { post: FeedPost }) {
  const { openMedia } = useMediaPreview()
  const media = post.media!
  const d = post.kind === 'diary' ? post.data as FeedDiaryData : null
  const detail = d ? diaryAction(media, d).detail : null
  const open = () => {
    if (media.local_id) openMedia(media.local_id)
    else openMedia({ type: media.type, title: media.title, cover_url: media.cover_url, year: media.year, rating: d?.rating ?? null, statusLabel: post.author.display_name })
  }
  return (
    <div className="flex gap-4 mt-3">
      <button type="button" onClick={open} aria-label={`Ver ${media.title}`} className="flex-shrink-0">
        <Cover url={media.cover_url} title={media.title} type={media.type} />
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={open} className="text-left">
          <span className="block font-display font-bold text-primary leading-tight" style={{ fontSize: 18 }}>{media.title}</span>
        </button>
        <p className="text-sm text-muted mt-0.5">{emojiOf(media.type)} {media.year ?? ''}{detail ? ` · ${detail}` : ''}</p>
        {d?.rating ? <div className="mt-2"><StarRating value={d.rating} readonly size="sm" /></div> : null}
        {d?.comment && <blockquote className="social-quote mt-2">{d.comment}</blockquote>}
      </div>
    </div>
  )
}

function AchievementsBlock({ post }: { post: FeedPost }) {
  const data = post.data as FeedAchievementsData
  const [all, setAll] = useState(false)
  const shown = all ? data.items : data.items.slice(-6)
  return (
    <div className="mt-3">
      <MediaBlock post={post} />
      <ul className="grid gap-2 mt-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))' }}>
        {shown.map(item => (
          <li key={item.api_name} className="flex items-center gap-3 bg-card rounded-lg p-2">
            {item.icon
              ? <img src={item.icon} alt="" width={40} height={40} loading="lazy" className="rounded" style={{ width: 40, height: 40 }} />
              : <span className="w-10 h-10 rounded bg-surface flex items-center justify-center" aria-hidden>🏆</span>}
            <span className="min-w-0">
              <span className="block text-primary truncate" style={{ fontSize: 15 }}>{item.name}</span>
              {item.percent != null && <span className="block text-xs text-muted">{item.percent < 10 ? '💎 ' : ''}{item.percent.toFixed(1)}% dos jogadores</span>}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-3 mt-2 text-sm text-muted">
        {data.items.length > 6 && (
          <button type="button" onClick={() => setAll(a => !a)} className="text-accent hover:underline">
            {all ? 'Mostrar menos' : `Ver todas as ${data.items.length}`}
          </button>
        )}
        {data.total ? <span>{data.unlocked ?? 0} de {data.total} no jogo ({Math.round(((data.unlocked ?? 0) / data.total) * 100)}%)</span> : null}
      </div>
    </div>
  )
}

function PreviewCover({ item, n }: { item: FeedListPreviewItem; n?: number }) {
  return (
    <span className="relative flex-shrink-0" title={item.title}>
      <Cover url={item.cover_url} title={item.title} type={item.type} w={56} h={84} />
      {n != null && <span className="social-rank">{n}</span>}
    </span>
  )
}

function ListBlock({ post }: { post: FeedPost }) {
  const data = post.data as FeedListData
  const href = `/u/${post.author.username}/lists/${data.list_id}`
  return (
    <div className="mt-3 bg-card rounded-xl p-4">
      <div className="flex items-baseline justify-between gap-3 flex-wrap mb-3">
        <Link to={href} className="font-display font-bold text-primary hover:underline" style={{ fontSize: 18 }}>{data.name}</Link>
        <span className="text-xs text-muted">
          {data.mode === 'tier' ? 'Tier list' : data.mode === 'ranking' ? 'Ranking' : 'Lista'} · {data.item_count} {data.item_count === 1 ? 'item' : 'itens'}
        </span>
      </div>
      {data.description && <p className="text-sm text-secondary mb-3">{data.description}</p>}
      {data.mode === 'tier' ? (
        <div className="space-y-1.5">
          {data.tiers.filter(t => t.count > 0).map(t => (
            <div key={t.name} className="flex items-stretch gap-2">
              <span className="social-tier" style={{ background: tierVar(t.color) }}>{t.name}</span>
              <div className="flex gap-1.5 overflow-x-auto py-0.5">
                {t.items.map((item, i) => <PreviewCover key={i} item={item} />)}
                {t.count > t.items.length && <span className="self-center text-xs text-muted px-2">+{t.count - t.items.length}</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="flex gap-2 overflow-x-auto pb-1">
          {data.items.map((item, i) => <PreviewCover key={i} item={item} n={data.mode === 'ranking' ? i + 1 : undefined} />)}
          {data.item_count > data.items.length && <span className="self-center text-xs text-muted px-2">+{data.item_count - data.items.length}</span>}
        </div>
      )}
      <Link to={href} className="inline-block mt-3 text-sm text-accent hover:underline">Ver lista completa →</Link>
    </div>
  )
}

function RefCards({ refs, own }: { refs: MediaRef[]; own: boolean }) {
  const { openMedia } = useMediaPreview()
  if (!refs.length) return null
  return (
    <div className="flex gap-3 mt-3 overflow-x-auto pb-1">
      {refs.map(ref => (
        <div key={`${ref.type}:${ref.external_id}`} className="flex gap-3 bg-card rounded-xl p-2 pr-3 flex-shrink-0 items-center" style={{ maxWidth: 300 }}>
          <button type="button" onClick={() => openMedia({ type: ref.type, title: ref.title, cover_url: ref.cover_url, year: ref.year })} aria-label={`Ver ${ref.title}`}>
            <Cover url={ref.cover_url} title={ref.title} type={ref.type} w={40} h={60} />
          </button>
          <div className="min-w-0">
            <p className="text-primary truncate" style={{ fontSize: 15 }}>{ref.title}</p>
            <p className="text-xs text-muted mb-1">{emojiOf(ref.type)} {ref.year ?? ''}</p>
            {!own && <WantButton media={ref} />}
          </div>
        </div>
      ))}
    </div>
  )
}

function Images({ images }: { images: FeedPost['images'] }) {
  const [open, setOpen] = useState<string | null>(null)
  if (!images.length) return null
  const cols = images.length === 1 ? 1 : 2
  return (
    <>
      <div className="grid gap-1.5 mt-3 rounded-xl overflow-hidden" style={{ gridTemplateColumns: `repeat(${cols}, 1fr)` }}>
        {images.map(img => (
          <button key={img.url} type="button" onClick={() => setOpen(img.url)} aria-label="Ampliar imagem" className="block bg-card">
            <img src={img.url} alt="" loading="lazy" width={img.width} height={img.height}
              className="w-full object-cover" style={{ maxHeight: images.length === 1 ? 520 : 260, aspectRatio: images.length === 1 ? undefined : '16 / 10' }} />
          </button>
        ))}
      </div>
      {open && (
        <div role="dialog" aria-modal="true" aria-label="Imagem" className="fixed inset-0 z-[300] bg-black/85 flex items-center justify-center p-4" onClick={() => setOpen(null)}>
          <img src={open} alt="" className="max-w-full max-h-full rounded-lg" />
          <button type="button" className="absolute top-4 right-4 text-white text-3xl" aria-label="Fechar" onClick={() => setOpen(null)}>×</button>
        </div>
      )}
    </>
  )
}

export function PostCard({ post, me, defaultOpenComments = false, onDeleted }: {
  post: FeedPost
  me: number
  defaultOpenComments?: boolean
  onDeleted?: () => void
}) {
  const qc = useQueryClient()
  const [showComments, setShowComments] = useState(defaultOpenComments)
  const [commentCount, setCommentCount] = useState(post.comment_count)
  const [confirm, setConfirm] = useState(false)
  const own = post.author.id === me
  const { data: comments } = useQuery({
    queryKey: ['feed-comments', post.id],
    queryFn: () => api.feed.comments(post.id),
    enabled: showComments,
  })

  const remove = async () => {
    await api.feed.remove(post.id)
    setConfirm(false)
    qc.invalidateQueries({ queryKey: ['feed'] })
    onDeleted?.()
  }

  const verb = headline(post)
  const wantable = !own && post.media && (post.kind === 'diary' || post.kind === 'achievements')

  return (
    <article className="social-card" aria-labelledby={`post-${post.id}-head`}>
      <header className="flex items-start gap-3">
        <Link to={`/u/${post.author.username}`} aria-label={`Perfil de ${post.author.display_name}`}>
          <Avatar name={post.author.display_name} url={post.author.avatar_url} id={post.author.id} size={42} />
        </Link>
        <div className="min-w-0 flex-1">
          <p id={`post-${post.id}-head`} className="text-secondary" style={{ fontSize: 15, lineHeight: 1.4 }}>
            <Link to={`/u/${post.author.username}`} className="font-semibold text-primary hover:underline">{post.author.display_name}</Link>
            {verb && <> {verb}</>}
            {post.media && post.kind !== 'post' && <> <span className="text-primary font-medium">{post.media.title}</span></>}
          </p>
          <Link to={`/feed/${post.id}`} className="text-xs text-muted hover:underline">{timeAgoLong(post.created_at)}</Link>
        </div>
        {post.can_delete && (
          <button type="button" onClick={() => setConfirm(true)} className="text-sm text-muted hover:text-movies px-2" aria-label="Apagar post">
            Apagar
          </button>
        )}
      </header>

      {post.body && <RichText body={post.body} mentions={post.mentions} refs={post.refs} className="text-primary mt-3" />}
      {post.kind === 'diary' && post.media && <MediaBlock post={post} />}
      {post.kind === 'achievements' && post.media && <AchievementsBlock post={post} />}
      {post.kind === 'list' && <ListBlock post={post} />}
      <RefCards refs={post.refs} own={own} />
      <Images images={post.images} />

      <footer className="flex items-center gap-2 flex-wrap mt-4 pt-3 border-t border-border">
        <Reactions targetType="post" targetId={post.id} initial={post.reactions} />
        <button type="button" onClick={() => setShowComments(s => !s)} aria-expanded={showComments} className="social-action">
          <span aria-hidden>💬</span><span>{commentCount > 0 ? `${commentCount} ${commentCount === 1 ? 'comentário' : 'comentários'}` : 'Comentar'}</span>
        </button>
        {wantable && post.media && <WantButton media={post.media} />}
      </footer>

      {showComments && (
        <Comments
          postId={post.id}
          comments={comments}
          onChange={list => {
            qc.setQueryData(['feed-comments', post.id], list)
            setCommentCount(list.filter(c => !c.deleted).length)
          }}
        />
      )}

      <ConfirmDialog
        open={confirm}
        title="Apagar este post?"
        message={own ? 'Os comentários e reações vão junto. Isso não mexe na sua biblioteca nem no seu diário.' : 'Você está apagando o post de outra pessoa como administrador.'}
        confirmLabel="Apagar"
        danger
        onConfirm={remove}
        onCancel={() => setConfirm(false)}
      />
    </article>
  )
}
