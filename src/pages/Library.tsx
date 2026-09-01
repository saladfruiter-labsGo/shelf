import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { MediaCard } from '../components/MediaCard'
import { CategoryTag } from '../components/CategoryTag'
import type { MediaStatus, MediaType } from '../types'
import { STATUS_LABEL } from '../lib/utils'

const TYPES: { label: string; value: MediaType | '' }[] = [
  { label: 'Todos', value: '' },
  { label: 'Filmes', value: 'movie' },
  { label: 'Séries', value: 'series' },
  { label: 'Jogos', value: 'game' },
  { label: 'Livros', value: 'book' },
]

const STATUSES: { label: string; value: MediaStatus | '' }[] = [
  { label: 'Todos', value: '' },
  { label: STATUS_LABEL.wishlist, value: 'wishlist' },
  { label: STATUS_LABEL.in_progress, value: 'in_progress' },
  { label: STATUS_LABEL.completed, value: 'completed' },
  { label: STATUS_LABEL.dropped, value: 'dropped' },
]

export function Library() {
  const [searchParams, setSearchParams] = useSearchParams()
  const typeParam   = (searchParams.get('type') ?? '') as MediaType | ''
  const statusParam = (searchParams.get('status') ?? '') as MediaStatus | ''

  const setType = (v: MediaType | '') => {
    const p = new URLSearchParams(searchParams)
    v ? p.set('type', v) : p.delete('type')
    setSearchParams(p)
  }

  const setStatus = (v: MediaStatus | '') => {
    const p = new URLSearchParams(searchParams)
    v ? p.set('status', v) : p.delete('status')
    setSearchParams(p)
  }

  const { data = [], isLoading } = useQuery({
    queryKey: ['media', typeParam, statusParam],
    queryFn: () => api.media.list({
      type: typeParam || undefined,
      status: statusParam || undefined,
      limit: 200,
    }),
  })

  return (
    <div className="px-6 py-8 max-w-7xl">
      <h1 className="font-display text-3xl font-bold text-primary mb-6">Biblioteca</h1>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-6">
        <div className="flex gap-1">
          {TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                typeParam === t.value
                  ? 'bg-accent text-bg'
                  : 'bg-card text-muted hover:text-primary'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="w-px bg-border" />
        <div className="flex gap-1 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
                statusParam === s.value
                  ? 'bg-surface border border-border-strong text-primary'
                  : 'bg-card text-muted hover:text-primary'
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i}>
              <div className="w-full aspect-[2/3] bg-card rounded-md animate-pulse mb-2" />
              <div className="h-3 bg-card rounded animate-pulse" />
            </div>
          ))}
        </div>
      ) : data.length > 0 ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-8 gap-4">
          {data.map((item) => (
            <MediaCard key={item.id} item={item} compact />
          ))}
        </div>
      ) : (
        <div className="text-center py-24 text-muted">
          <p className="text-lg font-medium text-secondary mb-2">Nenhum item encontrado</p>
          <p className="text-sm">Tente outros filtros ou adicione itens com ⌘K</p>
        </div>
      )}

      <p className="text-xs text-muted mt-6">{data.length} item{data.length !== 1 ? 's' : ''}</p>
    </div>
  )
}
