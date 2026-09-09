export type MediaType   = 'movie' | 'series' | 'game' | 'book' | 'music'
export type MediaStatus = 'wishlist' | 'in_progress' | 'completed' | 'dropped'
/** Status granular exclusivo de games (Playnite). */
export type GameStatus  = 'jogando' | 'zerado' | 'platinado' | 'abandonado' | 'nunca_jogado'

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
  progress?:    number   // 0..1 — séries (fração de episódios vistos) e livros (páginas lidas via Kavita)
  pages_total?: number | null
  pages_read?:  number | null
  playtime_seconds?: number | null   // games (Playnite): tempo total jogado, em segundos
  game_status?:      GameStatus | null // games (Playnite): status granular
  last_played_at?:   string | null     // games (Playnite): última vez jogado (ISO)
  publisher?:        string | null     // games (Playnite): distribuidora(s)
  library?:          string | null     // games (Playnite): biblioteca/origem (Steam, GOG...)
}

/* ─── Diário: registros de "visto/concluído" (N por mídia) ─── */

export interface DiaryEntry {
  id:            number
  media_item_id: number
  watched_at:    string
  rating:        number | null
  comment:       string | null
  source:        'manual' | 'plex' | 'backfill' | string
  created_at:    string
  season_number:  number | null   // séries: episódio registrado
  episode_number: number | null
  // campos da mídia (join)
  title:         string
  type:          MediaType
  cover_url:     string | null
  year:          number | null
  genre:         string | null
  external_id:   string
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

/* ─── Séries: preview (TMDB, antes de adicionar à biblioteca) ─── */

export interface SeriesPreviewEpisode {
  episode_number: number
  title:          string | null
}

export interface SeriesPreviewSeason {
  season_number: number
  title:         string | null
  episode_count: number
  episodes:      SeriesPreviewEpisode[]
}

export interface SeriesPreview {
  tmdb_id: string
  total:   number
  seasons: SeriesPreviewSeason[]
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
  kavita: {
    enabled:        boolean
    url:            string
    api_key_set:    boolean
    api_key_masked: string
    library_id:     string
  }
  playnite: {
    enabled:        boolean
    webhook_secret: string
  }
  prices: {
    enabled:        boolean
    api_key_set:    boolean
    api_key_masked: string
    country:        string
    tracked:        number
    last_sync:      string | null
    running:        boolean
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
  source:       'plex' | 'lastfm' | 'kavita' | 'playnite'
  event_type:   string
  media_type:   ActivityMediaType | 'book' | 'game'
  external_ref: string | null
  title:        string
  subtitle:     string | null
  cover_url:    string | null
  rating:       number | null
  duration_ms:  number | null
  genre:        string | null
  occurred_at:  string
}

/** "Em alta no público": item de trending externo (TMDB/RAWG/Last.fm). */
export interface TrendingItem {
  type:         'movie' | 'series' | 'game' | 'music'
  title:        string
  subtitle:     string | null
  cover_url:    string | null
  metric:       string
  metric_label: string
  external_id:  string | null
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

/* ─── Preços de jogos (IsThereAnyDeal) ─── */

export type GamePriceMatchStatus = 'pending' | 'resolved' | 'ambiguous' | 'not_found'

/**
 * Uma loja na lista de preços. Valores monetários são sempre inteiros em
 * centavos. Lojas sem oferta ativa (`available: false`) trazem o último preço
 * conhecido e não têm link de compra.
 */
export interface GamePriceOffer {
  shop_id:          number
  shop_name:        string
  price_minor:      number
  regular_minor:    number
  currency:         string
  discount_percent: number
  url:              string | null
  drm:              string | null
  voucher:          string | null
  available:        boolean
  /** Menor preço já visto nesta loja, e quando. */
  shop_low_minor:   number | null
  shop_low_at:      string | null
  /** Última vez que este preço foi observado. */
  last_seen_at:     string
}

export interface GamePriceSummary {
  media_item_id:     number
  match_status:      GamePriceMatchStatus
  matched_title:     string | null
  currency:          string | null
  best:              GamePriceOffer | null
  history_low_minor: number | null
  is_history_low:    boolean
  last_synced_at:    string | null
  stale:             boolean
}

export interface GamePriceSyncState {
  running:  boolean
  last_run: { at: string; ok: number; failed: number; error: string | null } | null
}

export interface GamePriceBacklog {
  enabled: boolean
  sync:    GamePriceSyncState
  items:   GamePriceSummary[]
}

/** Um ponto do gráfico: menor preço disponível naquele dia. */
export interface GamePricePoint {
  day:              string   // YYYY-MM-DD
  price_minor:      number
  regular_minor:    number
  discount_percent: number
  shop_name:        string
}

export interface GamePriceMatch {
  status:           GamePriceMatchStatus
  provider_game_id: string | null
  matched_title:    string | null
  method:           string | null
}

export type GamePriceRange = '30d' | '90d' | '1y' | 'all'

export interface GamePriceDetails {
  media_item_id: number
  enabled:       boolean
  match:         GamePriceMatch
  currency:      string | null
  stats: {
    current_minor:     number | null
    history_low_minor: number | null
    month_low_minor:   number | null
    last30_low_minor:  number | null
    local_since:       string | null
  }
  best:           GamePriceOffer | null
  offers:         GamePriceOffer[]
  points:         GamePricePoint[]
  shops:          { id: number; name: string }[]
  range:          GamePriceRange
  shop:           number | null
  last_synced_at: string | null
  last_error:     string | null
  stale:          boolean
}

/** Candidato do provedor para a correspondência manual. */
export interface GamePriceCandidate {
  id:     string
  slug:   string
  title:  string
  type:   string | null
  mature: boolean
}
