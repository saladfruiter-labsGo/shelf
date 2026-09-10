export const MEDIA_TYPES = ['movie', 'series', 'game', 'book'] as const
export type MediaType = typeof MEDIA_TYPES[number]

export const MEDIA_STATUSES = ['wishlist', 'in_progress', 'completed', 'dropped'] as const
export type MediaStatus = typeof MEDIA_STATUSES[number]

export const GAME_STATUSES = ['jogando', 'zerado', 'platinado', 'abandonado', 'nunca_jogado'] as const
export type GameStatus = typeof GAME_STATUSES[number]

const mediaTypes = new Set<string>(MEDIA_TYPES)
const mediaStatuses = new Set<string>(MEDIA_STATUSES)
const gameStatuses = new Set<string>(GAME_STATUSES)

export function isMediaType(value: unknown): value is MediaType {
  return typeof value === 'string' && mediaTypes.has(value)
}

export function isMediaStatus(value: unknown): value is MediaStatus {
  return typeof value === 'string' && mediaStatuses.has(value)
}

export function isGameStatus(value: unknown): value is GameStatus {
  return typeof value === 'string' && gameStatuses.has(value)
}

/** Status granular de games -> status base usado por toda a biblioteca. */
export const GAME_STATUS_TO_BASE: Record<GameStatus, MediaStatus> = {
  jogando:      'in_progress',
  zerado:       'completed',
  platinado:    'completed',
  abandonado:   'dropped',
  nunca_jogado: 'wishlist',
}

export const BACKLOG_STATUS: MediaStatus = 'wishlist'

/** Predicado SQL compartilhado pelas consultas que representam a biblioteca. */
export const LIBRARY_STATUS_PREDICATE = `status != '${BACKLOG_STATUS}'`

export function isLibraryStatus(status: unknown): status is Exclude<MediaStatus, 'wishlist'> {
  return isMediaStatus(status) && status !== BACKLOG_STATUS
}
