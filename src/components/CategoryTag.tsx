import type { MediaType } from '../types'
import { TYPE_LABEL } from '../lib/utils'

const colors: Record<MediaType, string> = {
  movie:  'text-movies bg-movies-bg',
  series: 'text-series bg-series-bg',
  game:   'text-games  bg-games-bg',
  book:   'text-books  bg-books-bg',
}

interface Props {
  type: MediaType
  size?: 'sm' | 'md'
}

export function CategoryTag({ type, size = 'md' }: Props) {
  const sz = size === 'sm' ? 'text-[10px] px-1.5 py-0.5' : 'text-xs px-2 py-1'
  return (
    <span className={`${sz} ${colors[type]} rounded font-medium font-body uppercase tracking-wide`}>
      {TYPE_LABEL[type]}
    </span>
  )
}
