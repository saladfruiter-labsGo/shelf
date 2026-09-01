import { useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { api } from '../lib/api'
import { Carousel } from '../components/Carousel'
import { MediaCard } from '../components/MediaCard'
import type { MediaItem, MediaType } from '../types'
import { daysUntil, formatDate } from '../lib/utils'

// ─── Generic mixed-type horizontal carousel ──────────────────────────
function UpcomingCarousel({
  title, icon, items, emptyMsg,
}: {
  title: string
  icon: string
  items: MediaItem[]
  emptyMsg?: string
}) {
  const ref = useRef<HTMLDivElement>(null)
  const scroll = (dir: 'left' | 'right') =>
    ref.current?.scrollBy({ left: dir === 'left' ? -320 : 320, behavior: 'smooth' })

  if (items.length === 0) {
    if (!emptyMsg) return null
    return (
      <section className="mb-10">
        <h2 className="font-display text-xl font-semibold text-primary flex items-center gap-2 mb-4">
          <span>{icon}</span>{title}
        </h2>
        <p className="text-sm text-muted">{emptyMsg}</p>
      </section>
    )
  }

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className="font-display text-xl font-semibold text-primary flex items-center gap-2">
          <span>{icon}</span>{title}
        </h2>
        <div className="flex gap-2">
          <button onClick={() => scroll('left')}
            className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center text-muted hover:text-primary hover:border-border-strong transition-colors">‹</button>
          <button onClick={() => scroll('right')}
            className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center text-muted hover:text-primary hover:border-border-strong transition-colors">›</button>
        </div>
      </div>
      <div ref={ref} className="flex gap-4 overflow-x-auto pb-2" style={{ scrollbarWidth: 'none' }}>
        {items.map(item => {
          const days = item.release_date ? daysUntil(item.release_date) : null
          return (
            <div key={item.id} className="flex-shrink-0 relative" style={{ width: 160 }}>
              <MediaCard item={item} />
              {/* Release badge */}
              {(item.hype === 1 || days !== null) && (
                <div className="mt-1">
                  {item.hype === 1 && <span className="text-[10px] text-accent">🔥 Hype</span>}
                  {days !== null && (
                    <p className="text-[10px] text-muted">
                      {days <= 0 ? '🎉 Lançou!' : days === 1 ? '🕐 Amanhã' : `📅 ${days}d`}
                    </p>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </div>
    </section>
  )
}

// ─── Page ────────────────────────────────────────────────────────────
export function Dashboard() {
  const { data: recent, isLoading } = useQuery({ queryKey: ['recent'],   queryFn: api.media.recent })
  const { data: upcoming }          = useQuery({ queryKey: ['upcoming'], queryFn: api.media.upcoming })

  const types: MediaType[] = ['movie', 'series', 'game', 'book']
  const totalItems = recent ? types.reduce((s, t) => s + (recent[t]?.length ?? 0), 0) : 0

  return (
    <div className="px-6 py-8 max-w-7xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-primary mb-1">Dashboard</h1>
        <p className="text-muted text-sm">
          {totalItems > 0 ? `${totalItems} itens recentes` : 'Adicione itens com ⌘K'}
        </p>
      </div>

      {/* Upcoming — Hype (release date próxima) */}
      <UpcomingCarousel
        icon="🔥"
        title="Hype & Lançamentos"
        items={upcoming?.hype ?? []}
        emptyMsg={undefined}
      />

      {/* Upcoming — Wishlist */}
      <UpcomingCarousel
        icon="📌"
        title="Wishlist"
        items={upcoming?.wishlist ?? []}
        emptyMsg={undefined}
      />

      {/* Recent carousels by type */}
      {isLoading ? (
        <div className="space-y-10">
          {types.map(t => <CarouselSkeleton key={t} />)}
        </div>
      ) : recent ? (
        <div>
          {types.map(t => (
            <Carousel key={t} type={t} items={(recent[t] ?? []) as MediaItem[]} />
          ))}
          {totalItems === 0 && !upcoming?.hype?.length && !upcoming?.wishlist?.length && (
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
      <div className="h-6 bg-card rounded w-32 mb-4 animate-pulse" />
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
