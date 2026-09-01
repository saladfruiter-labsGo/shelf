import { Link } from 'react-router-dom'
import type { MediaItem } from '../types'
import { CategoryTag } from './CategoryTag'
import { StarRating } from './StarRating'

interface Props {
  item: MediaItem
  compact?: boolean
}

export function MediaCard({ item, compact = false }: Props) {
  return (
    <Link
      to={`/media/${item.id}`}
      className="group flex-shrink-0 block"
      style={{ width: compact ? 120 : 160 }}
    >
      <div className="relative overflow-hidden rounded-md bg-card aspect-[2/3] mb-2 border border-border group-hover:border-border-strong transition-colors">
        {item.cover_url ? (
          <img
            src={item.cover_url}
            alt={item.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-muted text-3xl">
            {item.type === 'movie' ? '🎬' : item.type === 'series' ? '📺' : item.type === 'game' ? '🎮' : '📚'}
          </div>
        )}
        <div className="absolute bottom-0 inset-x-0 bg-gradient-to-t from-black/80 to-transparent p-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <CategoryTag type={item.type} size="sm" />
        </div>
      </div>
      <p className={`font-medium text-primary leading-tight truncate ${compact ? 'text-xs' : 'text-sm'}`}>
        {item.title}
      </p>
      {item.rating > 0 && (
        <StarRating value={item.rating} readonly size="sm" />
      )}
      {item.year && (
        <p className="text-xs text-muted mt-0.5">{item.year}</p>
      )}
    </Link>
  )
}
