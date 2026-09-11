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
  original_filename: string | null
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
  favorite:     number   // 0 = não; 1 = favorito; 2 = o destaque da categoria (capa coroada)
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
  tmdb_id?:          string | null     // filmes/séries: identificação explícita no TMDB
  list_added_at?:    string            // só em /lists/:id — quando o item entrou na lista
  list_position?:    number            // só em /lists/:id — ordem manual (ranking)
  tier_id?:          number | null     // só em /lists/:id — tier em que a capa está
  list_only?:        number            // 1 = snapshot pertencente somente à lista
}

/* ─── Diário: registros de consumo (N por mídia) ─── */

export interface DiaryEntry {
  id:            number
  media_item_id: number
  watched_at:    string
  rating:        number | null
  comment:       string | null
  source:        'manual' | 'plex' | 'backfill' | 'kavita' | 'playnite' | string
  created_at:    string
  season_number:  number | null   // séries: episódio registrado
  episode_number: number | null
  progress_day:  string | null     // dia civil fechado pelo job de progresso
  progress_value: number | null    // páginas lidas ou segundos jogados
  progress_total: number | null    // total de páginas; jogos não têm total
  progress_unit: 'pages' | 'seconds' | null
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

export interface TmdbMediaPreview {
  tmdb_id:      string
  type:         'movie' | 'series'
  title:        string
  cover_url:    string | null
  year:         number | null
  genre:        string | null
  runtime:      number | null
  synopsis:     string | null
  creators:     string | null
  author:       null
  release_date: string | null
}

/** Como a lista é exibida: grade simples, ranking numerado ou tierlist. */
export type ListMode = 'list' | 'ranking' | 'tier'

export interface ListTier {
  id:       number
  name:     string
  /** Chave de token de cor (movies, books, gold, games, series, music, accent). */
  color:    string
  position: number
}

export interface List {
  id:          number
  name:        string
  description: string | null
  mode:        ListMode
  /** 1 = esmaecer o que já foi consumido. */
  dim_seen:    number
  created_at:  string
  updated_at:  string
  item_count?: number
  /** Até 6 capas na ordem da lista — alimentam a colagem do card. */
  covers?:      string[]
  /** Quantos itens de cada tipo a lista tem. */
  type_counts?: Partial<Record<MediaType, number>>
}

export interface ListDetail extends List {
  items: MediaItem[]
  tiers: ListTier[]
}

export interface ListCheck {
  id:       number
  name:     string
  contains: 0 | 1
}

export interface ListSearchAddResult {
  ok:              boolean
  list_item_id:    number
  created:         boolean
  already_in_list: boolean
}

/* ─── Integrações (Plex + Last.fm) ─── */

export type ActivityMediaType = 'movie' | 'series' | 'music'

export interface PlexFilenameSyncResult {
  sections:     number
  scanned:      number
  matched:      number
  updated:      number
  without_file: number
  unmatched:    number
}

export type SearchApiKey = 'TMDB_API_KEY' | 'RAWG_API_KEY' | 'GOOGLE_BOOKS_KEY'
export type SearchApiKeySettings = Record<SearchApiKey, { set: boolean; masked: string }>

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
    rating_policy:  'shelf' | 'playnite'
  }
  steam: {
    enabled:        boolean
    steam_id:       string
    api_key_set:    boolean
    api_key_masked: string
    /** Cookies da loja presentes — sem eles a sincronização é só Steam → Shelf. */
    cookie_set:     boolean
    login_secure_set: boolean
    session_id_set: boolean
    session_id_masked: string
    sync_mode:      SteamSyncMode
    sync_removals:  boolean
    running:        boolean
    last_sync:      SteamSyncResult | null
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

/* ─── Steam: conector bidirecional do backlog ─── */

export type SteamSyncMode = 'pull' | 'push' | 'both'

export interface SteamSyncResult {
  at:            string
  pulled:        number
  pushed:        number
  removed_shelf: number
  removed_steam: number
  unmatched:     string[]
  pending_push:  number
  can_write:     boolean
  errors:        string[]
}

/* ─── Importação / Exportação ─── */

export type ExportScope = 'all' | 'library' | 'backlog'
export type LetterboxdKind = 'watched' | 'watchlist' | 'ratings' | 'diary'

export interface ExportSummary {
  all:     { items: number; diary: number }
  library: { items: number; diary: number }
  backlog: { items: number; diary: number }
}

export interface ImportReport {
  created:    number
  updated:    number
  skipped:    number
  diary:      number
  unresolved: string[]
  errors:     string[]
  restored?:  { lists: number; activity: number; tracks: number; prices: number }
}

export interface DatabaseBackupInfo {
  filename:    string
  reason:      'automatic' | 'before-import' | 'before-migration' | 'manual'
  created_at:  string
  size_bytes:  number
}

export interface BackupStatus {
  enabled:        boolean
  directory:      string
  interval_hours: number
  retention:      { daily_days: number; weekly_weeks: number; safety_copies: number }
  latest:         DatabaseBackupInfo | null
  count:          number
  running:        boolean
  last_error:     { at: string; message: string } | null
}

/* ── Letterboxd: prévia antes de escrever, e o resultado depois ── */

export interface LetterboxdPlanFile {
  path:      string
  kind:      LetterboxdKind
  does:      string
  rows:      number
  discarded: number
  /** Tipo é palpite do cabeçalho: a tela deixa corrigir antes de confirmar. */
  ambiguous: boolean
}

export interface LetterboxdPlanIgnored {
  path:   string
  reason: string
}

export interface LetterboxdPlanTitle {
  name:     string
  year:     number | null
  slug:     string
  rating:   number | null
  sessions: number
  target:   'library' | 'backlog'
}

export interface LetterboxdPlan {
  files:   LetterboxdPlanFile[]
  ignored: LetterboxdPlanIgnored[]
  titles:  LetterboxdPlanTitle[]
  totals: {
    titles:        number
    library:       number
    backlog:       number
    sessions:      number
    rated:         number
    discardedRows: number
  }
}

export interface LetterboxdPreview {
  /** `null` quando não há nada a importar — não há plano a confirmar. */
  planId:   string | null
  origin:   'zip' | 'csv'
  filename: string
  plan:     LetterboxdPlan
  /** Registros de diário que já vieram de uma importação anterior do Letterboxd. */
  existingDiary: number
}

export interface LetterboxdFileReport extends ImportReport {
  path: string
  kind: LetterboxdKind
  rows: number
}

export interface LetterboxdApplyResult {
  files:   LetterboxdFileReport[]
  total:   ImportReport & { rows: number }
  /** Registros de diário apagados antes de importar, quando "refazer" foi pedido. */
  cleared: number
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
