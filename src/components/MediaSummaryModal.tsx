import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { HTMLAttributes } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import {
  fmtRating,
  formatDate,
  formatPlaytime,
  formatRuntime,
  gameStatusOf,
  GAME_STATUS_LABEL,
  STATUS_LABEL,
} from '../lib/utils'
import { imageUrl } from '../lib/images'
import type { MediaItem, MediaType } from '../types'
import { CategoryTag } from './CategoryTag'
import { StarRating } from './StarRating'

export interface MediaPreviewSummary {
  type: MediaType
  title: string
  cover_url: string | null
  subtitle?: string | null
  genre?: string | null
  year?: number | null
  rating?: number | null
  synopsis?: string | null
  occurred_at?: string | null
  duration_ms?: number | null
  statusLabel?: string | null
}

type MediaPreviewTarget = MediaItem | MediaPreviewSummary | number
type MediaSelection = { id?: number; initial?: MediaItem; summary?: MediaPreviewSummary }

interface MediaPreviewContextValue {
  openMedia: (media: MediaPreviewTarget) => void
  closeMedia: () => void
}

const MediaPreviewContext = createContext<MediaPreviewContextValue | null>(null)

export function useMediaPreview(): MediaPreviewContextValue {
  const value = useContext(MediaPreviewContext)
  if (!value) throw new Error('useMediaPreview deve ser usado dentro de MediaPreviewProvider')
  return value
}

interface MediaPreviewTriggerProps extends Omit<HTMLAttributes<HTMLDivElement>, 'onClick'> {
  media: MediaPreviewTarget
  label: string
}

/** Superfície clicável reutilizável para cards que podem conter ações próprias. */
export function MediaPreviewTrigger({ media, label, children, className = '', ...props }: MediaPreviewTriggerProps) {
  const { openMedia } = useMediaPreview()
  return (
    <div
      {...props}
      role="button"
      tabIndex={0}
      aria-label={label}
      className={`media-preview-card ${className}`.trim()}
      onClick={() => openMedia(media)}
      onKeyDown={event => {
        props.onKeyDown?.(event)
        if (!event.defaultPrevented && event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
          event.preventDefault()
          openMedia(media)
        }
      }}
    >
      {children}
    </div>
  )
}

export function MediaPreviewProvider({ children }: { children: React.ReactNode }) {
  const [selection, setSelection] = useState<MediaSelection | null>(null)
  const openMedia = useCallback((media: MediaPreviewTarget) => {
    if (typeof media === 'number') setSelection({ id: media })
    else if ('id' in media && typeof media.id === 'number') setSelection({ id: media.id, initial: media })
    else setSelection({ summary: media })
  }, [])
  const closeMedia = useCallback(() => setSelection(null), [])
  const value = useMemo(() => ({ openMedia, closeMedia }), [openMedia, closeMedia])

  return (
    <MediaPreviewContext.Provider value={value}>
      {children}
      <MediaSummaryModal selection={selection} onClose={closeMedia} />
    </MediaPreviewContext.Provider>
  )
}

function MediaSummaryModal({ selection, onClose }: { selection: MediaSelection | null; onClose: () => void }) {
  const navigate = useNavigate()
  const closeRef = useRef<HTMLButtonElement>(null)

  const { data: item, isLoading, isError } = useQuery({
    queryKey: ['media', String(selection?.id ?? 'preview-only')],
    queryFn: () => api.media.get(selection!.id!),
    enabled: selection?.id != null,
    initialData: selection?.initial,
    initialDataUpdatedAt: 0,
  })

  const { data: details, isLoading: isLoadingDetails } = useQuery({
    queryKey: ['details', item?.type, item?.external_id],
    queryFn: () => api.details(item!.type, item!.external_id),
    enabled: !!item && !item.synopsis && item.type !== 'music',
    staleTime: Infinity,
  })

  useEffect(() => {
    if (!selection) return
    const previouslyFocused = document.activeElement instanceof HTMLElement ? document.activeElement : null
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    closeRef.current?.focus()

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('keydown', onKeyDown)
      document.body.style.overflow = previousOverflow
      previouslyFocused?.focus()
    }
  }, [selection, onClose])

  if (!selection) return null

  const media = item ?? selection.summary
  const synopsis = item?.synopsis ?? details?.synopsis ?? selection.summary?.synopsis
  const creators = item?.creators ?? details?.creators
  const author = item?.author ?? details?.author
  const status = item
    ? item.type === 'game'
      ? GAME_STATUS_LABEL[gameStatusOf(item)]
      : STATUS_LABEL[item.status]
    : selection.summary?.statusLabel ?? null

  const goToDetails = () => {
    const id = selection.id!
    onClose()
    navigate(`/media/${id}`)
  }

  return (
    <div className="media-summary-layer" role="presentation" onMouseDown={event => {
      if (event.target === event.currentTarget) onClose()
    }}>
      <section
        className="media-summary-modal animate-scale-in"
        role="dialog"
        aria-modal="true"
        aria-labelledby="media-summary-title"
      >
        <button ref={closeRef} onClick={onClose} className="media-summary-close" aria-label="Fechar resumo">
          ×
        </button>

        {selection.id != null && isLoading && !media ? (
          <div className="media-summary-loading" aria-label="Carregando resumo">
            <div className="media-summary-loading-cover animate-pulse" />
            <div className="media-summary-loading-lines">
              <span className="animate-pulse" />
              <span className="animate-pulse" />
              <span className="animate-pulse" />
            </div>
          </div>
        ) : (isError && !media) || !media ? (
          <div className="media-summary-error">
            <p>Não foi possível carregar esta mídia.</p>
            <button onClick={onClose}>Fechar</button>
          </div>
        ) : (
          <>
            <div className="media-summary-cover">
              {media.cover_url
                ? <img src={imageUrl(media.cover_url, 640)!} alt={`Capa de ${media.title}`} />
                : <span aria-hidden>{media.type === 'movie' ? '🎬' : media.type === 'series' ? '📺' : media.type === 'game' ? '🎮' : media.type === 'music' ? '🎵' : '📚'}</span>
              }
            </div>

            <div className="media-summary-content">
              <CategoryTag type={media.type} />
              <h2 id="media-summary-title">{media.title}</h2>
              <p className="media-summary-lead">
                {[media.year, media.genre, selection.summary?.subtitle, status].filter(Boolean).join(' · ')}
              </p>

              {(media.rating ?? 0) > 0 && (
                <div className="media-summary-rating" aria-label={`Avaliação ${fmtRating(media.rating!)} de 5`}>
                  <StarRating value={media.rating!} readonly size="sm" />
                  <strong>{fmtRating(media.rating!)}</strong>
                </div>
              )}

              <div className="media-summary-facts">
                {item?.release_date && <span><small>Lançamento</small>{formatDate(item.release_date)}</span>}
                {item?.runtime != null && item.runtime > 0 && <span><small>Duração</small>{formatRuntime(item.runtime)}</span>}
                {item?.type === 'game' && (item.playtime_seconds ?? 0) > 0 && (
                  <span><small>Tempo de jogo</small>{formatPlaytime(item.playtime_seconds!)}</span>
                )}
                {item?.type === 'book' && item.progress != null && (
                  <span><small>Progresso</small>{Math.round(item.progress * 100)}% lido</span>
                )}
                {item?.added_at && <span><small>Adicionado</small>{formatDate(item.added_at)}</span>}
                {selection.summary?.occurred_at && <span><small>Execução</small>{formatDate(selection.summary.occurred_at)}</span>}
                {(selection.summary?.duration_ms ?? 0) > 0 && (
                  <span><small>Duração</small>{formatRuntime(Math.round(selection.summary!.duration_ms! / 60_000))}</span>
                )}
              </div>

              {(author || creators) && (
                <div className="media-summary-block">
                  <small>{author ? 'Autoria' : media.type === 'movie' ? 'Direção' : media.type === 'series' ? 'Criação' : media.type === 'game' ? 'Desenvolvimento' : 'Créditos'}</small>
                  <p>{author ?? creators}</p>
                </div>
              )}

              {item?.type === 'game' && (item.publisher || item.library) && (
                <div className="media-summary-block">
                  <small>Jogo</small>
                  <p>{[item.publisher, item.library].filter(Boolean).join(' · ')}</p>
                </div>
              )}

              {synopsis ? (
                <div className="media-summary-block media-summary-synopsis">
                  <small>Sinopse</small>
                  <p>{synopsis}</p>
                </div>
              ) : isLoadingDetails ? (
                <p className="media-summary-fetching">Carregando sinopse…</p>
              ) : null}

              <div className="media-summary-actions">
                {selection.id != null && <button onClick={onClose} className="media-summary-secondary">Fechar</button>}
                <button onClick={selection.id != null ? goToDetails : onClose} className="media-summary-primary">
                  {selection.id != null ? 'Ver página de detalhes →' : 'Fechar'}
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </div>
  )
}
