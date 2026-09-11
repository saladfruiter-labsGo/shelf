import type { GameStatus } from '../media-domain.js'

export interface PlaynitePayload {
  gameId?: string
  name?: string
  playtimeSeconds?: number
  completionStatus?: string
  userScore?: number | null
  releaseYear?: number | null
  lastPlayed?: string | null
  library?: string | null
  developers?: string[] | string | null
  publishers?: string[] | string | null
}

export type PlayniteRatingPolicy = 'shelf' | 'playnite'

export type PlayniteState = Record<string, {
  externalId: string
  gameStatus: string
  rating: number
  playtime: number
  lastPlayedAt?: string | null
}>

/** CompletionStatus do Playnite -> status granular do Shelf. */
export function playniteGameStatus(completion: string | undefined, playtimeSeconds: number): GameStatus {
  switch ((completion ?? '').trim().toLowerCase()) {
    case 'beaten':
      return 'platinado'
    case 'completed':
    case 'finished':
      return 'zerado'
    case 'abandoned':
      return 'abandonado'
    case 'not played':
    case 'plan to play':
      return 'nunca_jogado'
    case 'played':
    case 'playing':
    case 'on hold':
      return 'jogando'
    default:
      return playtimeSeconds > 0 ? 'jogando' : 'nunca_jogado'
  }
}

/** UserScore 0-100 -> escala 0-5 do Shelf, em passos de meio ponto. */
export function playniteRating(userScore: number | null | undefined): number {
  if (userScore == null || userScore <= 0) return 0
  return Math.round((userScore / 20) * 2) / 2
}

/**
 * Por padrão, uma nota já curada no Shelf é a fonte de verdade. A política
 * `playnite` pode ser escolhida explicitamente para aceitar sobrescritas.
 */
export function resolvePlayniteRating(
  currentRating: number,
  incomingRating: number,
  policy: PlayniteRatingPolicy,
): number {
  if (incomingRating <= 0) return currentRating
  if (policy === 'playnite' || currentRating <= 0) return incomingRating
  return currentRating
}

/** Aceita array ou string única, conforme a serialização do PowerShell. */
export function joinPlayniteNames(list: string[] | string | null | undefined): string | null {
  const names = Array.isArray(list) ? list : typeof list === 'string' ? [list] : []
  return names.map(name => String(name ?? '').trim()).filter(Boolean).join(', ') || null
}
