export type MediaType   = 'movie' | 'series' | 'game' | 'book' | 'music'
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
  progress?:    number   // 0..1 — só séries (fração de episódios vistos)
}

/* ─── Séries: temporadas e episódios ─── */

export interface SeriesEpisode {
  episode_number: number
  title:          string | null
  watched:        boolean
  watched_at:     string | null
}

export interface SeriesSeason {
  season_number: number
  title:         string | null
  status:        string
  episode_count: number
  watched_count: number
  episodes:      SeriesEpisode[]
}

export interface SeriesView {
  media_item_id: number
  total:         number
  watched:       number
  percent:       number   // 0..1
  seasons:       SeriesSeason[]
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

/* ─── Integrações (Plex + Last.fm) ─── */

export type ActivityMediaType = 'movie' | 'series' | 'music'

export interface IntegrationStatus {
  plex: {
    enabled:        boolean
    url:            string
    token_set:      boolean
    token_masked:   string
    user:           string
    webhook_secret: string
  }
  lastfm: {
    enabled:        boolean
    api_key_set:    boolean
    api_key_masked: string
    user:           string
  }
  telegram: {
    enabled:          boolean
    bot_token_set:    boolean
    bot_token_masked: string
    chat_id:          string
    thread_id:        string
  }
}

export interface NowPlayingItem {
  media_type:  ActivityMediaType
  title:       string
  subtitle:    string | null
  cover_url:   string | null
  state:       'playing' | 'paused'
  position_ms: number | null
  duration_ms: number | null
  updated_at:  number
}

export interface NowPlaying {
  plex:  NowPlayingItem | null
  music: NowPlayingItem | null
}

export interface ActivityEvent {
  id:           number
  source:       'plex' | 'lastfm'
  event_type:   string
  media_type:   ActivityMediaType
  external_ref: string | null
  title:        string
  subtitle:     string | null
  cover_url:    string | null
  rating:       number | null
  duration_ms:  number | null
  genre:        string | null
  occurred_at:  string
}

export interface MusicStats {
  plays:       number
  hours:       number
  top_genres:  { genre: string; n: number }[]
  top_artists: { artist: string; n: number }[]
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
