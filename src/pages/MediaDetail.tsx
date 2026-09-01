import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { api } from '../lib/api'
import { CategoryTag } from '../components/CategoryTag'
import { StarRating } from '../components/StarRating'
import type { MediaStatus } from '../types'
import { STATUS_LABEL, formatRuntime } from '../lib/utils'

const STATUSES: MediaStatus[] = ['wishlist', 'in_progress', 'completed', 'dropped']

export function MediaDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: item, isLoading } = useQuery({
    queryKey: ['media', id],
    queryFn: () => api.media.get(parseInt(id!)),
    enabled: !!id,
  })

  const [notes, setNotes] = useState('')
  const [editingNotes, setEditingNotes] = useState(false)

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.media.update>[1]) =>
      api.media.update(parseInt(id!), data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', id] })
      qc.invalidateQueries({ queryKey: ['recent'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.media.remove(parseInt(id!)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      navigate(-1)
    },
  })

  if (isLoading) return (
    <div className="px-6 py-8">
      <div className="h-8 bg-card rounded w-48 animate-pulse mb-4" />
      <div className="flex gap-8">
        <div className="w-48 aspect-[2/3] bg-card rounded-lg animate-pulse" />
        <div className="flex-1 space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-4 bg-card rounded animate-pulse" style={{ width: `${60 + i * 8}%` }} />
          ))}
        </div>
      </div>
    </div>
  )

  if (!item) return (
    <div className="px-6 py-8 text-muted">Item não encontrado.</div>
  )

  return (
    <div className="px-6 py-8 max-w-3xl">
      <button
        onClick={() => navigate(-1)}
        className="text-muted hover:text-primary text-sm mb-6 flex items-center gap-1 transition-colors"
      >
        ← Voltar
      </button>

      <div className="flex gap-6 md:gap-10">
        {/* Cover */}
        <div className="flex-shrink-0 w-40 md:w-52">
          <div className="w-full aspect-[2/3] rounded-lg overflow-hidden bg-card border border-border">
            {item.cover_url ? (
              <img src={item.cover_url} alt={item.title} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full flex items-center justify-center text-muted text-4xl">
                {item.type === 'movie' ? '🎬' : item.type === 'series' ? '📺' : item.type === 'game' ? '🎮' : '📚'}
              </div>
            )}
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <CategoryTag type={item.type} />
          <h1 className="font-display text-2xl md:text-3xl font-bold text-primary mt-2 mb-1 leading-tight">
            {item.title}
          </h1>
          {item.year && <p className="text-muted text-sm mb-4">{item.year}</p>}

          {/* Rating */}
          <div className="mb-4">
            <p className="text-xs text-muted uppercase tracking-wide mb-1">Avaliação</p>
            <StarRating
              value={item.rating}
              size="lg"
              onChange={(v) => updateMutation.mutate({ rating: v })}
            />
          </div>

          {/* Status */}
          <div className="mb-4">
            <p className="text-xs text-muted uppercase tracking-wide mb-2">Status</p>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map((s) => (
                <button
                  key={s}
                  onClick={() => updateMutation.mutate({ status: s })}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    item.status === s
                      ? 'bg-accent text-bg'
                      : 'bg-card text-muted hover:text-primary border border-border'
                  }`}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Runtime */}
          {item.runtime && (
            <p className="text-sm text-muted mb-4">⏱ {formatRuntime(item.runtime)}</p>
          )}

          {/* Genre */}
          {item.genre && (
            <p className="text-sm text-muted mb-4">🏷 {item.genre}</p>
          )}

          {/* Notes */}
          <div className="mb-6">
            <p className="text-xs text-muted uppercase tracking-wide mb-2">Notas</p>
            {editingNotes ? (
              <div>
                <textarea
                  className="w-full bg-card border border-border rounded-md p-3 text-sm text-primary placeholder:text-muted outline-none focus:border-accent resize-none"
                  rows={4}
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Suas anotações..."
                />
                <div className="flex gap-2 mt-2">
                  <button
                    onClick={() => {
                      updateMutation.mutate({ notes })
                      setEditingNotes(false)
                    }}
                    className="px-3 py-1.5 bg-accent text-bg rounded text-xs font-medium"
                  >
                    Salvar
                  </button>
                  <button
                    onClick={() => setEditingNotes(false)}
                    className="px-3 py-1.5 bg-card text-muted rounded text-xs"
                  >
                    Cancelar
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => { setNotes(item.notes ?? ''); setEditingNotes(true) }}
                className="text-sm text-muted hover:text-primary transition-colors text-left w-full"
              >
                {item.notes || <span className="italic">Clique para adicionar notas...</span>}
              </button>
            )}
          </div>

          {/* Delete */}
          <button
            onClick={() => {
              if (confirm(`Remover "${item.title}" da biblioteca?`)) {
                deleteMutation.mutate()
              }
            }}
            className="text-xs text-muted hover:text-red-400 transition-colors"
            disabled={deleteMutation.isPending}
          >
            Remover da biblioteca
          </button>
        </div>
      </div>
    </div>
  )
}
