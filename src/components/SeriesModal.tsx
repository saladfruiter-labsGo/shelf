import { useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { StarRating } from './StarRating'
import { SeriesSeasons } from './SeriesSeasons'
import type { MediaStatus } from '../types'
import { STATUS_LABEL } from '../lib/utils'

const FONT = 'Space Grotesk, sans-serif'
const STATUSES: MediaStatus[] = ['wishlist', 'in_progress', 'completed', 'dropped']

export function SeriesModal({ id, onClose }: { id: number; onClose: () => void }) {
  const qc = useQueryClient()

  const { data: item } = useQuery({
    queryKey: ['media', String(id)],
    queryFn: () => api.media.get(id),
  })

  // Sinopse: usa a salva ou busca sob demanda (séries sempre têm sinopse)
  const { data: details } = useQuery({
    queryKey: ['details', 'series', item?.external_id],
    queryFn: () => api.details('series', item!.external_id),
    enabled: !!item && !item.synopsis,
    staleTime: Infinity,
  })
  const synopsis = item?.synopsis ?? details?.synopsis
  const creators = item?.creators ?? details?.creators

  const update = useMutation({
    mutationFn: (data: Parameters<typeof api.media.update>[1]) => api.media.update(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', String(id)] })
      qc.invalidateQueries({ queryKey: ['media'] })
    },
  })

  const remove = useMutation({
    mutationFn: () => api.media.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      onClose()
    },
  })

  // Fecha no Esc e trava o scroll do body
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = prev }
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 100, display: 'flex',
        alignItems: 'flex-start', justifyContent: 'center', padding: '48px 20px',
        background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)', overflowY: 'auto',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 720, background: 'var(--bg)', border: '1px solid var(--border)',
          borderRadius: 20, overflow: 'hidden', boxShadow: '0 24px 80px rgba(0,0,0,.5)',
        }}
      >
        {/* Banner */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '16/9', background: 'var(--card-hover)', overflow: 'hidden' }}>
          {item?.cover_url
            ? <img src={item.cover_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
            : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', fontSize: 64 }}>📺</div>}
          <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, var(--bg) 2%, transparent 55%)' }} />
          <button
            onClick={onClose}
            aria-label="Fechar"
            style={{
              position: 'absolute', top: 14, right: 14, width: 36, height: 36, borderRadius: 999,
              border: 'none', cursor: 'pointer', background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 18,
            }}
          >×</button>
        </div>

        <div style={{ padding: '4px 28px 28px' }}>
          <p style={{ fontFamily: FONT, fontSize: 11, letterSpacing: '3px', textTransform: 'uppercase', color: 'var(--series)', fontWeight: 600, marginBottom: 8 }}>
            Série
          </p>
          <h2 style={{ fontFamily: FONT, fontSize: 'clamp(24px,3.5vw,36px)', fontWeight: 800, letterSpacing: '-1px', color: 'var(--text-primary)', margin: '0 0 6px', lineHeight: 1.05 }}>
            {item?.title ?? '—'}
          </h2>
          <p style={{ fontFamily: FONT, fontSize: 16, color: 'var(--text-muted)', margin: '0 0 16px' }}>
            {[item?.year, item?.genre, creators].filter(Boolean).join(' · ') || 'Série'}
          </p>

          {/* Nota + status */}
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 16, marginBottom: 20 }}>
            {item && <StarRating value={item.rating} size="md" onChange={v => update.mutate({ rating: v })} />}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => update.mutate({ status: s })}
                  style={{
                    fontFamily: FONT, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                    padding: '5px 12px', borderRadius: 999, border: '1px solid var(--border)',
                    background: item?.status === s ? 'var(--series)' : 'transparent',
                    color: item?.status === s ? '#fff' : 'var(--text-muted)',
                  }}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Sinopse */}
          {synopsis && (
            <div style={{ marginBottom: 24 }}>
              <p style={{ fontFamily: FONT, fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 8 }}>Sinopse</p>
              <p style={{ fontFamily: FONT, fontSize: 16, lineHeight: 1.6, color: 'var(--text-secondary)', margin: 0 }}>{synopsis}</p>
            </div>
          )}

          {/* Temporadas e episódios */}
          <p style={{ fontFamily: FONT, fontSize: 11, letterSpacing: '2px', textTransform: 'uppercase', color: 'var(--text-muted)', marginBottom: 4 }}>Temporadas</p>
          <SeriesSeasons mediaId={id} />

          {/* Remover da biblioteca */}
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 24, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <button
              onClick={() => { if (confirm(`Remover "${item?.title ?? 'esta série'}"?`)) remove.mutate() }}
              disabled={remove.isPending}
              style={{
                fontFamily: FONT, fontSize: 12, fontWeight: 600, cursor: 'pointer',
                background: 'none', border: 'none', color: 'var(--text-muted)',
                transition: 'color .15s', opacity: remove.isPending ? 0.6 : 1,
              }}
              onMouseEnter={e => { e.currentTarget.style.color = '#f87171' }}
              onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)' }}
            >
              Remover da biblioteca
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
