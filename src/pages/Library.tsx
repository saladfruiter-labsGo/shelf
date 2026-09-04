import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { MediaCard } from '../components/MediaCard'
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

function typeFilterClass(current: MediaType | '', target: MediaType | ''): string {
  if (current !== target)
    return 'border-transparent text-muted hover:text-primary hover:border-border'
  if (target === '') return 'bg-primary border-primary text-bg'
  const map: Record<MediaType, string> = {
    movie:  'bg-movies  border-movies  text-white',
    series: 'bg-series  border-series  text-white',
    game:   'bg-games   border-games   text-white',
    book:   'bg-books   border-books   text-white',
  }
  return map[target]
}

function statusFilterClass(current: MediaStatus | '', target: MediaStatus | ''): string {
  if (current !== target)
    return 'border-transparent text-muted hover:text-primary hover:border-border'
  return 'bg-primary border-primary text-bg'
}

export function Library() {
  const [searchParams, setSearchParams] = useSearchParams()
  const typeParam   = (searchParams.get('type') ?? '') as MediaType | ''
  const statusParam = (searchParams.get('status') ?? '') as MediaStatus | ''
  const gridRef = useRef<HTMLDivElement>(null)

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

  useEffect(() => {
    if (!data.length || !gridRef.current) return
    const items = gridRef.current.querySelectorAll<HTMLElement>('.reveal-item')
    const obs = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (!entry.isIntersecting) return
        ;(entry.target as HTMLElement).classList.add('visible')
        obs.unobserve(entry.target)
      })
    }, { threshold: 0.06, rootMargin: '0px 0px -24px 0px' })
    items.forEach((el, idx) => {
      el.style.transitionDelay = `${(idx % 7) * 55}ms`
      obs.observe(el)
    })
    return () => obs.disconnect()
  }, [data])

  return (
    <div className="px-8 py-10 max-w-7xl">
      {/* Page header */}
      <div className="mb-8 pb-8 border-b border-border flex items-end justify-between gap-6">
        <div>
          <p className="text-[0.59rem] font-bold tracking-[0.22em] uppercase text-muted mb-2">
            Coleção pessoal
          </p>
          <h1 className="font-display font-black uppercase text-[clamp(3rem,8vw,6.5rem)] leading-none text-primary">
            A sua<br /><span className="text-accent">prateleira</span>
          </h1>
        </div>
        <div className="flex-shrink-0 text-right">
          <p className="font-black text-[3rem] leading-none text-border-strong tabular-nums">{data.length || '—'}</p>
          <p className="text-[0.59rem] font-bold tracking-[0.2em] uppercase text-muted">itens</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap gap-3 mb-8 items-center">
        <div className="flex gap-1">
          {TYPES.map((t) => (
            <button
              key={t.value}
              onClick={() => setType(t.value)}
              className={`px-3.5 py-1 rounded-full text-xs font-semibold border-[1.5px] tracking-[0.015em] transition-all duration-150 ${typeFilterClass(typeParam, t.value)}`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="w-px h-5 bg-border" />
        <div className="flex gap-1 flex-wrap">
          {STATUSES.map((s) => (
            <button
              key={s.value}
              onClick={() => setStatus(s.value)}
              className={`px-3.5 py-1 rounded-full text-xs font-semibold border-[1.5px] tracking-[0.015em] transition-all duration-150 ${statusFilterClass(statusParam, s.value)}`}
            >
              {s.label}
            </button>
          ))}
        </div>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-x-4 gap-y-8">
          {Array.from({ length: 14 }).map((_, i) => (
            <div key={i}>
              <div className="w-full aspect-[2/3] bg-card rounded-md animate-pulse mb-2.5" />
              <div className="h-3 bg-card rounded animate-pulse w-4/5" />
            </div>
          ))}
        </div>
      ) : data.length > 0 ? (
        <div
          ref={gridRef}
          className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-x-4 gap-y-8"
        >
          {data.map((item) => (
            <div key={item.id} className="reveal-item">
              <MediaCard item={item} compact />
            </div>
          ))}
        </div>
      ) : (
        <div className="text-center py-24">
          <p className="font-black uppercase text-[3.5rem] leading-none text-border mb-3">Vazio</p>
          <p className="text-base font-medium text-secondary mb-1">Nenhum item encontrado</p>
          <p className="text-sm text-muted">Tente outros filtros ou adicione itens com ⌘K</p>
        </div>
      )}

      <p className="text-xs font-semibold text-muted mt-8 tracking-[0.1em] uppercase">
        {data.length} item{data.length !== 1 ? 's' : ''}
      </p>
    </div>
  )
}
