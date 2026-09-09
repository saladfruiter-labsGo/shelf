import type { MediaItem } from '../types'
import { CategoryTag } from './CategoryTag'
import { StarRating } from './StarRating'
import { useMediaPreview } from './MediaSummaryModal'

interface Props {
  item: MediaItem
  compact?: boolean
}

export function MediaCard({ item, compact = false }: Props) {
  const { openMedia } = useMediaPreview()
  const originalFilenameTooltip = item.original_filename
    ? `Arquivo original: ${item.original_filename}`
    : undefined

  return (
    <button
      type="button"
      onClick={() => openMedia(item)}
      aria-label={`Abrir resumo de ${item.title}`}
      className={`group block border-0 bg-transparent p-0 text-left ${compact ? 'w-full' : 'w-40 flex-shrink-0'}`}
    >
      {/* Poster */}
      <div
        className="relative overflow-hidden rounded-md bg-card aspect-[2/3] mb-2.5 border border-border group-hover:border-border-strong group-hover:shadow-md transition-all duration-200"
        title={originalFilenameTooltip}
      >
        {item.cover_url ? (
          <img
            src={item.cover_url}
            alt={item.title}
            title={originalFilenameTooltip}
            className="w-full h-full object-cover group-hover:scale-[1.04] transition-transform duration-500"
            loading="lazy"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-card">
            <span className="font-black text-[5rem] leading-none text-primary/10 uppercase select-none">
              {item.title[0]}
            </span>
          </div>
        )}

        {/* Warm accent tint on hover */}
        <div className="absolute inset-0 bg-accent opacity-0 group-hover:opacity-30 mix-blend-overlay transition-opacity duration-300 pointer-events-none" />

        {/* Gradient overlay with category tag */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/75 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-300 flex items-end p-2">
          <CategoryTag type={item.type} size="sm" />
        </div>
      </div>

      {/* Title with wavy underline */}
      <span className="card-title-wrap">
        <p
          title={originalFilenameTooltip}
          className={`font-bold text-primary group-hover:text-accent transition-colors duration-200 leading-tight truncate ${compact ? 'text-sm' : 'text-base'}`}
        >
          {item.title}
        </p>
      </span>

      {item.rating > 0 && (
        <StarRating value={item.rating} readonly size="sm" />
      )}
      {item.year && (
        <p className="text-xs text-muted mt-0.5 font-medium tabular-nums">{item.year}</p>
      )}
    </button>
  )
}
