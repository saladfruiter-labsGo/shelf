export interface NowPlaying {
  media_type: 'movie' | 'series' | 'music'
  title: string
  subtitle: string | null
  cover_url: string | null
  state: 'playing' | 'paused'
  position_ms: number | null
  duration_ms: number | null
  updated_at: number
}
