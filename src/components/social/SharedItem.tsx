import { useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { imageUrl } from '../../lib/images'
import { CATEGORIES } from '../../lib/categories'
import { GAME_STATUS_LABEL, STATUS_LABEL, formatPlaytime, norm } from '../../lib/utils'
import { StarRating } from '../StarRating'
import { useMediaPreview } from '../MediaSummaryModal'
import { WantButton } from './WantButton'
import type { GameStatus, MediaItem, SharedItem } from '../../types'

const emojiOf = (type: string) => CATEGORIES.find(c => c.key === type)?.emoji ?? '🎞️'

function coverSrc(url: string | null, width: number): string | null {
  if (!url) return null
  return url.startsWith('/') ? url : imageUrl(url, width)
}

function statusText(item: SharedItem): string {
  if (item.type === 'game' && item.game_status && item.game_status in GAME_STATUS_LABEL) {
    return GAME_STATUS_LABEL[item.game_status as GameStatus]
  }
  return STATUS_LABEL[item.status] ?? ''
}

/** Item da biblioteca enviado numa mensagem, com a nota e o status de quem mandou. */
export function SharedItemCard({ item, senderName, mine }: { item: SharedItem; senderName: string; mine: boolean }) {
  const { openMedia } = useMediaPreview()
  const src = coverSrc(item.cover_url, 160)
  const open = () => item.local_id
    ? openMedia(item.local_id)
    : openMedia({ type: item.type, title: item.title, cover_url: item.cover_url, year: item.year, genre: item.genre, rating: item.rating, statusLabel: statusText(item) })
  return (
    <div className="flex gap-3 bg-surface border border-border rounded-xl p-3 text-left" style={{ maxWidth: 420 }}>
      <button type="button" onClick={open} aria-label={`Ver ${item.title}`} className="flex-shrink-0">
        {src
          ? <img src={src} alt="" width={64} height={96} className="rounded-lg object-cover" style={{ width: 64, height: 96 }} />
          : <span className="w-16 h-24 rounded-lg bg-card flex items-center justify-center text-2xl" aria-hidden>{emojiOf(item.type)}</span>}
      </button>
      <div className="min-w-0 flex-1">
        <button type="button" onClick={open} className="block text-left font-display font-bold text-primary leading-tight" style={{ fontSize: 17 }}>
          {item.title}
        </button>
        <p className="text-xs text-muted mt-0.5">{emojiOf(item.type)} {item.year ?? ''}{item.genre ? ` · ${item.genre}` : ''}</p>
        <p className="text-xs text-secondary mt-1.5">
          {mine ? 'Você' : senderName}: {statusText(item)}
          {item.type === 'game' && item.playtime_seconds ? ` · ${formatPlaytime(item.playtime_seconds)}` : ''}
        </p>
        {item.rating != null && <div className="mt-1"><StarRating value={item.rating} readonly size="sm" /></div>}
        {item.review && <p className="social-quote mt-2" style={{ fontSize: 15 }}>{item.review.comment}</p>}
        {!mine && <div className="mt-2"><WantButton media={item} /></div>}
      </div>
    </div>
  )
}

/** Escolher um item da própria biblioteca (busca por título). */
export function LibraryPicker({ onPick, onClose }: { onPick: (item: MediaItem) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['media', 'share-picker'],
    queryFn: () => api.media.listAll(),
    staleTime: 5 * 60_000,
  })
  const shown = useMemo(() => {
    const term = norm(q.trim())
    return (term ? items.filter(i => norm(i.title).includes(term)) : items).slice(0, 30)
  }, [items, q])
  return (
    <div className="social-popover" role="dialog" aria-label="Escolher da biblioteca" style={{ top: 'auto', bottom: 'calc(100% + 6px)' }}>
      <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar na sua biblioteca…"
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-primary outline-none focus:border-accent" style={{ fontSize: 16 }} />
      <div className="mt-2 max-h-72 overflow-y-auto">
        {isLoading && <p className="text-sm text-muted px-1 py-2">Carregando…</p>}
        {!isLoading && !shown.length && <p className="text-sm text-muted px-1 py-2">Nada encontrado.</p>}
        {shown.map(item => (
          <button key={item.id} type="button" className="social-result" onClick={() => onPick(item)}>
            {item.cover_url
              ? <img src={coverSrc(item.cover_url, 80) ?? ''} alt="" className="rounded object-cover flex-shrink-0" style={{ width: 32, height: 48 }} />
              : <span className="w-8 h-12 rounded bg-card flex items-center justify-center flex-shrink-0" aria-hidden>{emojiOf(item.type)}</span>}
            <span className="min-w-0 text-left">
              <span className="block text-primary truncate" style={{ fontSize: 15 }}>{item.title}</span>
              <span className="block text-xs text-muted">{emojiOf(item.type)} {item.year ?? ''}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
