import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { MediaType, SearchResult } from '../types'
import { CategoryTag } from './CategoryTag'
import { TYPE_LABEL } from '../lib/utils'

interface Props {
  open:    boolean
  onClose: () => void
}

const TYPE_FILTERS: { label: string; value: MediaType; tag: string; emoji: string }[] = [
  { label: 'Filmes',  value: 'movie',  tag: '/filmes',  emoji: '🎬' },
  { label: 'Séries',  value: 'series', tag: '/series',  emoji: '📺' },
  { label: 'Jogos',   value: 'game',   tag: '/jogos',   emoji: '🎮' },
  { label: 'Livros',  value: 'book',   tag: '/livros',  emoji: '📚' },
]

const TAG_MAP: Record<string, MediaType> = {
  filmes: 'movie', filme: 'movie', movie: 'movie', movies: 'movie',
  series: 'series', serie: 'series', série: 'series', tv: 'series',
  jogos: 'game', jogo: 'game', game: 'game', games: 'game',
  livros: 'book', livro: 'book', book: 'book', books: 'book',
}

function parseInput(raw: string): { tagType: MediaType | null; q: string } {
  const m = raw.match(/^\/(\w+)\s*(.*)/)
  if (!m) return { tagType: null, q: raw }
  const tagType = TAG_MAP[m[1].toLowerCase()] ?? null
  return { tagType, q: m[2].trim() }
}

export function SearchModal({ open, onClose }: Props) {
  const [rawInput,   setRawInput]   = useState('')
  const [manualType, setManualType] = useState<MediaType | null>(null)
  const [debouncedQ, setDebouncedQ] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const { tagType, q: cleanQ } = parseInput(rawInput)

  // Active type: tag overrides manual
  const activeType: MediaType | null = tagType ?? manualType

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(cleanQ), 350)
    return () => clearTimeout(t)
  }, [cleanQ])

  useEffect(() => {
    if (open) {
      setRawInput('')
      setDebouncedQ('')
      setManualType(null)
      setTimeout(() => inputRef.current?.focus(), 60)
    }
  }, [open])

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') onClose()
  }, [onClose])
  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  // Search only fires when a type is active
  const searchEnabled = !!activeType && debouncedQ.length >= 2

  const { data, isFetching } = useQuery({
    queryKey: ['search', debouncedQ, activeType],
    queryFn:  () => api.search(debouncedQ, activeType!),
    enabled:  searchEnabled,
    staleTime: 30_000,
  })

  const addMutation = useMutation({
    mutationFn: (result: SearchResult) =>
      api.media.add({
        external_id:  result.external_id,
        type:         result.type,
        title:        result.title,
        cover_url:    result.cover_url,
        year:         result.year,
        genre:        result.genre,
        runtime:      null,
        status:       'wishlist',
        notes:        null,
        synopsis:     null,
        creators:     null,
        author:       result.author,
        release_date: result.release_date,
      }),
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
      onClose()
      navigate(`/media/${item.id}`)
    },
  })

  const clearTag = () => {
    setRawInput(cleanQ)
    setManualType(null)
    inputRef.current?.focus()
  }

  const selectManual = (type: MediaType) => {
    if (tagType) {
      // Clear typed tag, keep query
      setRawInput(cleanQ)
    }
    setManualType(prev => prev === type ? null : type)
    inputRef.current?.focus()
  }

  if (!open) return null

  const showTag = tagType !== null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-surface border border-border rounded-xl shadow-2xl animate-scale-in overflow-hidden">

        {/* Input row */}
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <svg className="w-5 h-5 text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>

          {showTag && (
            <span className="flex items-center gap-1 flex-shrink-0 bg-accent-bg text-accent text-xs px-2 py-1 rounded-full font-medium">
              {TYPE_FILTERS.find(f => f.value === tagType)?.emoji} {TYPE_LABEL[tagType!]}
              <button onClick={clearTag} className="ml-1 leading-none hover:text-primary">×</button>
            </span>
          )}

          <input
            ref={inputRef}
            value={rawInput}
            onChange={e => setRawInput(e.target.value)}
            placeholder={
              activeType
                ? `Buscar ${TYPE_LABEL[activeType].toLowerCase()}s...`
                : 'Selecione um tipo abaixo ou use /filmes, /series...'
            }
            className="flex-1 bg-transparent text-primary placeholder:text-muted outline-none text-base min-w-0"
          />

          {isFetching && <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />}
          <kbd className="hidden sm:block text-xs text-muted bg-card px-1.5 py-0.5 rounded border border-border flex-shrink-0">Esc</kbd>
        </div>

        {/* Type selector */}
        <div className="flex gap-1 px-3 py-2 border-b border-border">
          {TYPE_FILTERS.map(f => {
            const active = activeType === f.value
            return (
              <button
                key={f.value}
                onClick={() => selectManual(f.value)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                  active ? 'bg-accent text-bg' : 'bg-card text-muted hover:text-primary'
                }`}
              >
                {f.emoji} {f.label}
              </button>
            )
          })}
        </div>

        {/* Results / hints */}
        <div className="max-h-80 overflow-y-auto">
          {!activeType ? (
            // No type selected — show tag hints
            <div className="px-4 py-6">
              <p className="text-xs text-muted uppercase tracking-wide mb-3">Buscar por categoria</p>
              <div className="grid grid-cols-2 gap-2">
                {TYPE_FILTERS.map(f => (
                  <button
                    key={f.value}
                    onClick={() => setManualType(f.value)}
                    className="flex items-center gap-2 px-3 py-2.5 bg-card rounded-lg text-sm text-secondary hover:text-primary hover:bg-card-hover transition-colors text-left"
                  >
                    <span className="text-lg">{f.emoji}</span>
                    <div>
                      <p className="font-medium">{f.label}</p>
                      <p className="text-xs text-muted font-mono">{f.tag}</p>
                    </div>
                  </button>
                ))}
              </div>
            </div>
          ) : debouncedQ.length < 2 ? (
            <p className="text-center text-muted text-sm py-8">
              Digite para buscar {TYPE_LABEL[activeType].toLowerCase()}s...
            </p>
          ) : data?.results && data.results.length > 0 ? (
            <ul>
              {data.results.map(result => (
                <li key={`${result.type}-${result.external_id}`}>
                  <button
                    className="w-full flex items-center gap-3 px-4 py-3 hover:bg-card transition-colors text-left"
                    onClick={() => addMutation.mutate(result)}
                    disabled={addMutation.isPending}
                  >
                    <div className="w-10 h-14 flex-shrink-0 rounded overflow-hidden bg-card border border-border">
                      {result.cover_url
                        ? <img src={result.cover_url} alt="" className="w-full h-full object-cover" />
                        : <div className="w-full h-full flex items-center justify-center text-muted text-lg">
                            {TYPE_FILTERS.find(f => f.value === result.type)?.emoji}
                          </div>
                      }
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-primary truncate">{result.title}</p>
                      <div className="flex items-center gap-2 mt-1 flex-wrap">
                        <CategoryTag type={result.type} size="sm" />
                        {result.year && <span className="text-xs text-muted">{result.year}</span>}
                        {result.type === 'book' && result.author
                          ? <span className="text-xs text-muted truncate">{result.author}</span>
                          : result.genre
                          ? <span className="text-xs text-muted truncate">{result.genre}</span>
                          : null
                        }
                      </div>
                    </div>
                    <span className="text-xs text-muted flex-shrink-0">+ Adicionar</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : !isFetching ? (
            <p className="text-center text-muted text-sm py-8">Nenhum resultado para "{debouncedQ}"</p>
          ) : null}
        </div>
      </div>
    </div>
  )
}
