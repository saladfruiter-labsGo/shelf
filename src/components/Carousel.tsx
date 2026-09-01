import { useRef } from 'react'
import type { MediaItem, MediaType } from '../types'
import { TYPE_LABEL } from '../lib/utils'
import { MediaCard } from './MediaCard'
import { Link } from 'react-router-dom'

interface Props {
  type: MediaType
  items: MediaItem[]
}

const typeIcon: Record<MediaType, string> = {
  movie:  '🎬',
  series: '📺',
  game:   '🎮',
  book:   '📚',
}

const typeColor: Record<MediaType, string> = {
  movie:  'text-movies',
  series: 'text-series',
  game:   'text-games',
  book:   'text-books',
}

export function Carousel({ type, items }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)

  const scroll = (dir: 'left' | 'right') => {
    scrollRef.current?.scrollBy({ left: dir === 'left' ? -320 : 320, behavior: 'smooth' })
  }

  if (items.length === 0) return null

  return (
    <section className="mb-10">
      <div className="flex items-center justify-between mb-4">
        <h2 className={`font-display text-xl font-semibold flex items-center gap-2 ${typeColor[type]}`}>
          <span>{typeIcon[type]}</span>
          {TYPE_LABEL[type]}s
        </h2>
        <div className="flex items-center gap-3">
          <button
            onClick={() => scroll('left')}
            className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center text-muted hover:text-primary hover:border-border-strong transition-colors"
          >
            ‹
          </button>
          <button
            onClick={() => scroll('right')}
            className="w-8 h-8 rounded-full bg-surface border border-border flex items-center justify-center text-muted hover:text-primary hover:border-border-strong transition-colors"
          >
            ›
          </button>
          <Link
            to={`/library?type=${type}`}
            className="text-sm text-muted hover:text-accent transition-colors"
          >
            Ver todos
          </Link>
        </div>
      </div>
      <div
        ref={scrollRef}
        className="flex gap-4 overflow-x-auto pb-2 scrollbar-hide"
        style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
      >
        {items.map((item) => (
          <MediaCard key={item.id} item={item} />
        ))}
      </div>
    </section>
  )
}
