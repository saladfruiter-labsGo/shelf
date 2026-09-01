export type MediaType = 'movie' | 'series' | 'game' | 'book'
export type MediaStatus = 'wishlist' | 'in_progress' | 'completed' | 'dropped'

export interface MediaItem {
  id: number
  external_id: string
  type: MediaType
  title: string
  cover_url: string | null
  year: number | null
  genre: string | null
  runtime: number | null
  rating: number
  status: MediaStatus
  notes: string | null
  added_at: string
  updated_at: string
}

export interface SearchResult {
  external_id: string
  type: MediaType
  title: string
  cover_url: string | null
  year: number | null
  genre: string | null
}

export interface WrapData {
  period: 'monthly' | 'annual'
  year: number
  month?: number
  total: number
  byType: { type: MediaType; count: number }[]
  avgRating: { type: MediaType; avg: number }[]
  topByType: Record<MediaType, MediaItem[]>
  activity: { period_key: string; count: number }[]
  totalRuntimeMinutes: number
  dominantGenre: string | null
}
