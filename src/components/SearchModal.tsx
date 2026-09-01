import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { MediaType, SearchResult } from '../types'
import { CategoryTag } from './CategoryTag'
import { TYPE_LABEL } from '../lib/utils'

interface Props {
  open: boolean
  onClose: () => void
}

const TYPE_FILTERS: { label: string; value: MediaType | '' }[] = [
  { label: 'Tudo', value: '' },
  { label: 'Filmes', value: 'movie' },
  { label: 'Séries', value: 'series' },
  { label: 'Jogos', value: 'game' },
  { label: 'Livros', value: 'book' },
]

export function SearchModal({ open, onClose }: Props) {
  const [q, setQ] = useState('')
  const [typeFilter, setTypeFilter] = useState<MediaType | ''>('')
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const qc = useQueryClient()

  const [debouncedQ, setDebouncedQ] = useState('')
  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q), 350)
    return () => clearTimeout(t)
  }, [q])

  useEffect(() => {
    if (open) {
      setQ('')
      setDebouncedQ('')
      setTimeout(() => inputRef.current?.focus(), 60)
    }
  }, [open])

  const { data, isFetching } = useQuery({
    queryKey: ['search', debouncedQ, typeFilter],
    queryFn: () => api.search(debouncedQ, typeFilter || undefined),
    enabled: debouncedQ.length >= 2,
    staleTime: 30_000,
  })

  const addMutation = useMutation({
    mutationFn: (result: SearchResult) =>
      api.media.add({
        external_id: result.external_id,
        type: result.type,
        title: result.title,
        cover_url: result.cover_url,
        year: result.year,
        genre: result.genre,
        runtime: null,
        status: 'wishlist',
        notes: null,
      }),
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      onClose()
      navigate(`/media/${item.id}`)
    },
  })

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])

  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4"
      onClick={(e) => e.target === e.currentTarget && onClose()}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-surface border border-border rounded-xl shadow-2xl animate-scale-in overflow-hidden">
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border">
          <svg className="w-5 h-5 text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar filmes, séries, jogos, livros..."
            className="flex-1 bg-transparent text-primary placeholder:text-muted outline-none text-base"
          />
          {isFetching && (
            <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin" />
          )}
          <kbd className="hidden sm:block text-xs text-muted bg-card px-1.5 py-0.5 rounded border border-border">Esc</kbd>
        </div>

        {/* Type filters */}
        <div className="flex gap-1 px-3 py-2 border-b border-border overflow-x-auto">
          {TYPE_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setTypeFilter(f.value)}
              className={`px-3 py-1 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                typeFilter === f.value
                  ? 'bg-accent text-bg'
                  : 'bg-card text-muted hover:text-primary'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Results */}
        <div className="max-h-80 overflow-y-auto">
          {data?.results && data.results.length > 0 ? (
            <ul>
              {data.results.map((result) => (
                <li key={`${result.type}-${result.external_id}`}>
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-card transition-colors text-left"
                    onClick={() => addMutation.mutate(result)}
                    disabled={addMutation.isPending}
                  >
                    <div className="w-10 h-14 flex-shrink-0 rounded overflow-hidden bg-card border border-border">
                      {result.cover_url ? (
                        <img src={result.cover_url} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center text-muted text-lg">
                          {result.type === 'movie' ? '🎬' : result.type === 'series' ? '📺' : result.type === 'game' ? '🎮' : '📚'}
                        </div>
                      )}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary truncate">{result.title}</p>
                      <div className="flex items-center gap-2 mt-1">
                        <CategoryTag type={result.type} size="sm" />
                        {result.year && <span className="text-xs text-muted">{result.year}</span>}
                        {result.genre && <span className="text-xs text-muted truncate">{result.genre}</span>}
                      </div>
                    </div>
                    <span className="text-xs text-muted">Adicionar</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : debouncedQ.length >= 2 && !isFetching ? (
            <p className="text-center text-muted text-sm py-8">
              Nenhum resultado para "{debouncedQ}"
            </p>
          ) : debouncedQ.length < 2 ? (
            <p className="text-center text-muted text-sm py-8">
              Digite pelo menos 2 caracteres para buscar
            </p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
