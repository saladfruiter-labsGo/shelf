import type { MediaType } from '../types'

export const TYPE_LABEL: Record<MediaType, string> = {
  movie:  'Filme',
  series: 'Série',
  game:   'Jogo',
  book:   'Livro',
}

export const TYPE_COLOR: Record<MediaType, string> = {
  movie:  'movies',
  series: 'series',
  game:   'games',
  book:   'books',
}

export const STATUS_LABEL = {
  wishlist:    'Quero ver',
  in_progress: 'Em andamento',
  completed:   'Concluído',
  dropped:     'Abandonado',
} as const

export function formatRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes}min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}
