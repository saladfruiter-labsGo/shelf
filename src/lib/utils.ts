import type { MediaType } from '../types'

export const TYPE_LABEL: Record<MediaType, string> = {
  movie:  'Filme',
  series: 'Série',
  game:   'Jogo',
  book:   'Livro',
  music:  'Música',
}

export const TYPE_COLOR: Record<MediaType, string> = {
  movie:  'movies',
  series: 'series',
  game:   'games',
  book:   'books',
  music:  'music',
}

export const STATUS_LABEL = {
  wishlist:    'Wishlist',
  in_progress: 'Em andamento',
  completed:   'Concluído',
  dropped:     'Abandonado',
} as const

/** "5" for whole ratings, "4.5" for half steps. */
export function fmtRating(r: number): string {
  return r % 1 === 0 ? String(r) : r.toFixed(1)
}

export function formatRuntime(minutes: number): string {
  if (minutes < 60) return `${minutes}min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m > 0 ? `${h}h ${m}min` : `${h}h`
}

export function cn(...classes: (string | false | null | undefined)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Data de hoje no formato YYYY-MM-DD (local), para inputs type="date". */
export function todayISODate(): string {
  const d = new Date()
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10)
}

/** Converte um ISO (date ou datetime) para YYYY-MM-DD local. */
export function toISODate(iso: string): string {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso.slice(0, 10)
  const off = d.getTimezoneOffset()
  return new Date(d.getTime() - off * 60_000).toISOString().slice(0, 10)
}

export function daysUntil(dateStr: string): number {
  const ms = new Date(dateStr).getTime() - Date.now()
  return Math.ceil(ms / 86_400_000)
}
