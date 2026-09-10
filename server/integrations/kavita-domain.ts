export interface KavitaSeries {
  id: number
  name: string
  pages: number
  pagesRead: number
  userRating: number
  hasUserRated: boolean
  latestReadDate: string | null
  libraryId: number
}

export type KavitaState = Record<string, {
  status: string
  pagesRead: number
  rating: number
}>

export function kavitaRating(series: Pick<KavitaSeries, 'hasUserRated' | 'userRating'>): number {
  if (!series.hasUserRated || !series.userRating) return 0
  const value = series.userRating > 5 ? series.userRating / 20 : series.userRating
  return Math.round(value * 2) / 2
}

export function kavitaReadingStatus(pages: number, pagesRead: number): 'in_progress' | 'completed' {
  return pages > 0 && pagesRead >= pages ? 'completed' : 'in_progress'
}
