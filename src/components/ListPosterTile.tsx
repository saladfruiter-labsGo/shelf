import type { PointerEvent as ReactPointerEvent } from 'react'
import type { MediaItem, MediaType } from '../types'

const TYPE_EMOJI: Record<MediaType, string> = {
  movie: '🎬', series: '📺', game: '🎮', book: '📚', music: '🎵',
}

interface Props {
  item: MediaItem
  /** Posição no ranking (1 = melhor). `null` esconde o selo. */
  rank?:      number | null
  /** Esmaecido pelo interruptor "já consumi". */
  dimmed?:    boolean
  draggable?: boolean
  /** Capa sendo arrastada neste momento. */
  ghost?:     boolean
  /** Marcador de onde a capa arrastada vai cair. */
  caret?:     'before' | 'after' | null
  showTitle?: boolean
  onOpen:     () => void
  onRemove?:  () => void
  onDragStart?: (e: ReactPointerEvent) => void
}

export function ListPosterTile({
  item, rank = null, dimmed = false, draggable = false, ghost = false,
  caret = null, showTitle = true, onOpen, onRemove, onDragStart,
}: Props) {
  const classes = [
    'list-tile',
    dimmed    && 'is-dim',
    draggable && 'is-draggable',
    ghost     && 'is-ghost',
    caret === 'before' && 'is-before',
    caret === 'after'  && 'is-after',
  ].filter(Boolean).join(' ')

  return (
    <div className={classes} data-drag-id={item.id}>
      <button
        type="button"
        className="list-tile-open"
        onClick={onOpen}
        onPointerDown={draggable ? onDragStart : undefined}
        aria-label={`Abrir resumo de ${item.title}`}
        title={draggable ? `${item.title} — arraste para reordenar` : item.title}
      >
        <div className="list-tile-poster">
          {item.cover_url
            ? <img src={item.cover_url} alt={item.title} loading="lazy" draggable={false} />
            : <div className="list-tile-fallback">{TYPE_EMOJI[item.type]}</div>}
          {rank !== null && (
            <span className={`list-tile-rank${rank <= 3 ? ' is-top' : ''}`}>{rank}</span>
          )}
        </div>
        {showTitle && (
          <>
            <p className="list-tile-title">{item.title}</p>
            <p className="list-tile-sub">
              {item.year ?? '—'}{item.rating > 0 ? ` · ★ ${item.rating}` : ''}
            </p>
          </>
        )}
      </button>

      {onRemove && (
        <button
          type="button"
          className="list-tile-remove"
          onClick={onRemove}
          title="Remover da lista"
          aria-label={`Remover ${item.title} da lista`}
        >
          ×
        </button>
      )}
    </div>
  )
}
