import type { MediaType, GameStatus, MediaItem } from '../types'

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
  wishlist:    'Backlog',
  in_progress: 'Em andamento',
  completed:   'Concluído',
  dropped:     'Abandonado',
} as const

/** Status granular de games (Playnite). Ordem usada nos botões. */
export const GAME_STATUS_LABEL: Record<GameStatus, string> = {
  jogando:      'Jogando',
  zerado:       'Zerado',
  platinado:    'Platinado',
  abandonado:   'Abandonado',
  nunca_jogado: 'Nunca jogado',
}
export const GAME_STATUSES: GameStatus[] = ['jogando', 'zerado', 'platinado', 'abandonado', 'nunca_jogado']

/** Cor (texto/fundo) por status de game — theme-aware, uma cor distinta por estado. */
export const GAME_STATUS_STYLE: Record<GameStatus, { color: string; bg: string }> = {
  jogando:      { color: 'var(--games)',      bg: 'var(--games-bg)' },
  zerado:       { color: 'var(--series)',     bg: 'var(--series-bg)' },
  platinado:    { color: 'var(--music)',      bg: 'var(--music-bg)' },
  abandonado:   { color: 'var(--movies)',     bg: 'var(--movies-bg)' },
  nunca_jogado: { color: 'var(--text-muted)', bg: 'var(--card-hover)' },
}

/** game_status do item; se ausente (jogo adicionado à mão), deriva do status base. */
export function gameStatusOf(item: Pick<MediaItem, 'game_status' | 'status'>): GameStatus {
  if (item.game_status) return item.game_status
  switch (item.status) {
    case 'completed': return 'zerado'
    case 'dropped':   return 'abandonado'
    case 'wishlist':  return 'nunca_jogado'
    default:          return 'jogando'
  }
}

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

/** Tempo de jogo (Playnite) a partir de segundos: "45min", "12h", "12h 30min". */
export function formatPlaytime(seconds: number): string {
  const totalMin = Math.round(seconds / 60)
  if (totalMin < 60) return `${totalMin}min`
  const h = Math.floor(totalMin / 60)
  const m = totalMin % 60
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

/** Normaliza para busca por nome: sem acento, sem caixa, sem espaço nas pontas. */
export function norm(s: string): string {
  return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim()
}

/** Dinheiro vem do backend como inteiro em centavos — nunca como float. */
export function formatMoney(minor: number, currency = 'BRL'): string {
  try {
    return new Intl.NumberFormat('pt-BR', { style: 'currency', currency }).format(minor / 100)
  } catch {
    return `${currency} ${(minor / 100).toFixed(2)}`
  }
}

/** "agora", "12 min", "3 h", "5 d" — para selos de "atualizado há…". */
export function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso + (iso.includes('Z') || iso.includes('+') ? '' : 'Z')).getTime()
  const min = Math.floor(diff / 60000)
  if (!Number.isFinite(min)) return '—'
  if (min < 1) return 'agora'
  if (min < 60) return `${min} min`
  const h = Math.floor(min / 60)
  if (h < 24) return `${h} h`
  return `${Math.floor(h / 24)} d`
}

/** "hoje", "há 3 dias", "há 5 meses" — versão por extenso de `timeAgo`. */
export function timeAgoLong(iso: string): string {
  const ms = Date.now() - new Date(iso + (iso.includes('Z') || iso.includes('+') ? '' : 'Z')).getTime()
  if (!Number.isFinite(ms)) return '—'
  const days = Math.floor(ms / 86_400_000)
  if (days < 1)  return 'hoje'
  if (days === 1) return 'ontem'
  if (days < 30) return `há ${days} dias`
  const months = Math.floor(days / 30)
  if (months < 12) return `há ${months} ${months === 1 ? 'mês' : 'meses'}`
  const years = Math.floor(days / 365)
  return `há ${years} ${years === 1 ? 'ano' : 'anos'}`
}
