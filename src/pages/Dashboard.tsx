import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { Carousel } from '../components/Carousel'
import type { MediaItem, MediaType } from '../types'

export function Dashboard() {
  const { data, isLoading } = useQuery({
    queryKey: ['recent'],
    queryFn: api.media.recent,
  })

  const types: MediaType[] = ['movie', 'series', 'game', 'book']

  const totalItems = data
    ? types.reduce((s, t) => s + (data[t]?.length ?? 0), 0)
    : 0

  return (
    <div className="px-6 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-primary mb-1">Dashboard</h1>
        <p className="text-muted text-sm">
          {totalItems > 0 ? `${totalItems} itens recentes na sua coleção` : 'Adicione itens com ⌘K'}
        </p>
      </div>

      {isLoading ? (
        <div className="space-y-10">
          {types.map((t) => (
            <CarouselSkeleton key={t} />
          ))}
        </div>
      ) : data ? (
        <div>
          {types.map((t) => (
            <Carousel key={t} type={t} items={(data[t] ?? []) as MediaItem[]} />
          ))}
          {totalItems === 0 && (
            <div className="text-center py-24 text-muted">
              <p className="text-5xl mb-4">📚</p>
              <p className="text-lg font-medium text-secondary mb-2">Sua prateleira está vazia</p>
              <p className="text-sm">Pressione <kbd className="bg-card border border-border px-1.5 py-0.5 rounded text-primary text-xs">⌘K</kbd> para adicionar algo</p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  )
}

function CarouselSkeleton() {
  return (
    <div className="mb-10">
      <div className="h-6 bg-card rounded w-32 mb-4" />
      <div className="flex gap-4">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="flex-shrink-0 w-40">
            <div className="w-full aspect-[2/3] bg-card rounded-md mb-2 animate-pulse" />
            <div className="h-3 bg-card rounded w-3/4 animate-pulse" />
          </div>
        ))}
      </div>
    </div>
  )
}
