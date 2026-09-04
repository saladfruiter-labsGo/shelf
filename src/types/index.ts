export type MediaType   = 'movie' | 'series' | 'game' | 'book'
export type MediaStatus = 'wishlist' | 'in_progress' | 'completed' | 'dropped'

export interface MediaItem {
  id:           number
  external_id:  string
  type:         MediaType
  title:        string
  cover_url:    string | null
  year:         number | null
  genre:        string | null
  runtime:      number | null
  rating:       number
  status:       MediaStatus
  notes:        string | null
  synopsis:     string | null
  creators:     string | null
  author:       string | null
  release_date: string | null
  hype:         number
  completed_at: string | null
  added_at:     string
  updated_at:   string
}

export interface SearchResult {
  external_id:  string
  type:         MediaType
  title:        string
  cover_url:    string | null
  year:         number | null
  genre:        string | null
  author:       string | null
  release_date: string | null
}

export interface Details {
  synopsis: string | null
  creators: string | null
  author:   string | null
}

export interface List {
  id:          number
  name:        string
  description: string | null
  created_at:  string
  updated_at:  string
  item_count?: number
}

export interface ListDetail extends List {
  items: MediaItem[]
}

export interface ListCheck {
  id:       number
  name:     string
  contains: 0 | 1
}

export interface WrapData {
  period:               'monthly' | 'annual'
  year:                 number
  month?:               number
  total:                number
  byType:               { type: MediaType; count: number }[]
  avgRating:            { type: MediaType; avg: number }[]
  topByType:            Record<MediaType, MediaItem[]>
  activity:             { period_key: string; count: number }[]
  totalRuntimeMinutes:  number
  dominantGenre:        string | null
}
