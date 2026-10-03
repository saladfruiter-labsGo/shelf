export type MediaType   = 'movie' | 'series' | 'game' | 'book' | 'music'
export type MediaStatus = 'wishlist' | 'in_progress' | 'completed' | 'dropped'
export type MediaQueue  = 'wishlist' | 'backlog' // filas fora da biblioteca, cada uma com sua página
/** Status granular exclusivo de games. */
export type GameStatus  = 'jogando' | 'pausado' | 'zerado' | 'platinado' | 'abandonado' | 'backlog' | 'nunca_jogado'
export type GameDataSource = 'steam' | 'playnite' | 'manual'

export interface MediaItem {
  id:           number
  external_id:  string
  type:         MediaType
  title:        string
  cover_url:    string | null
  default_cover_url?: string | null  // capa do provedor, guardada enquanto há arte personalizada
  cover_custom?:      number         // 1 = `cover_url` é uma arte escolhida pelo usuário
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
  game_status?:      GameStatus | null // games: status granular
  game_status_source?: GameDataSource | null // de onde veio o status (selo só para 'steam')
  playtime_source?:  GameDataSource | null // de onde veio o tempo de jogo
  steam_appid?:      number | null // games: AppID na Steam (página de jogo, conquistas)
  ttb_main_seconds?: number | null // games: tempo para zerar a história (IGDB)
  achievements_total?: number | null // games: conquistas lidas da Steam
  achievements_unlocked?: number | null
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
  season_number:  number | null   // séries: temporada ou episódio registrado
  episode_number: number | null
  season_title:   string | null
  episode_title:  string | null
  progress_day:  string | null     // dia civil fechado pelo job de progresso
  progress_value: number | null    // páginas lidas ou segundos jogados
  progress_total: number | null    // total de páginas; jogos não têm total
  progress_unit: 'pages' | 'seconds' | null
  // campos da mídia (join)
  title:         string
  type:          MediaType
  cover_url:     string | null
  default_cover_url: string | null
  cover_custom:  number
  year:          number | null
  genre:         string | null
  external_id:   string
}

/* ─── Arte de capa personalizada ─── */

export interface CoverOption {
  url:    string
  source: 'default' | 'current' | 'tmdb' | 'rawg' | 'steam'
}

export interface CoverChoices {
  current: string | null
  default: string | null
  custom:  boolean
  options: CoverOption[]
  notice?: string
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
  rating:        number
  episodes:      SeriesEpisode[]
}

export interface UnratedSeason {
  media_item_id: number
  season_number: number
  season_title:  string | null
  completed_at:  string | null
  title:         string
  cover_url:     string | null
  year:          number | null
}

export interface SeasonRatingResult {
  media_item_id:  number
  season_number:  number
  rating:         number
  diary_entry_id: number | null
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
export type SearchApiKeySettings = Record<SearchApiKey, { set: boolean; masked: string }> & { can_edit?: boolean }

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
    library_enabled:   boolean
    library_last_sync: SteamLibraryResult | null
    achievements_last_sync: SteamAchievementsResult | null
    auto_abandon_days: number
  }
  /** Chaves da instância (IGDB, IsThereAnyDeal) só são editáveis por administradores. */
  instance: { can_edit: boolean }
  igdb: {
    configured:     boolean
    client_id:      string
    secret_set:     boolean
    secret_masked:  string
    last_sync:      { at: string; checked: number; found: number; errors: string[] } | null
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

/** Leitura das conquistas (ver server/steam/achievements.ts). */
export interface SteamAchievementsResult {
  at:          string
  checked:     number
  zerados:     number
  platinados:  number
  abandonados: number
  private:     boolean
  errors:      string[]
}

/** Conquista de um jogo na página de jogo. `finale` = marca o fim da história. */
export interface GameAchievement {
  api_name:       string
  name:           string
  description:    string | null
  icon:           string | null
  icon_gray:      string | null
  hidden:         boolean
  global_percent: number | null
  achieved:       boolean
  unlocked_at:    string | null
  finale:         boolean
}

/** Conquista recente de qualquer jogo, para a Home. */
export interface LatestAchievement {
  api_name:       string
  name:           string
  description:    string | null
  icon:           string | null
  global_percent: number | null
  unlocked_at:    string
  finale:         boolean
  hidden:         boolean
  media_item_id:  number
  game:           string
  cover_url:      string | null
}

/** Leitura da biblioteca da Steam (ver server/steam/library.ts). */
export interface SteamLibraryResult {
  at:      string
  owned:   number
  created: number
  adopted: number
  updated: number
  started: number
  errors:  string[]
}

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

/** Ficha da loja da Steam para a página de jogo (ver server/steam/store.ts). */
export interface SteamStorePage {
  format:            number
  appid:             number
  name:              string
  short_description: string | null
  genres:            string[]
  developers:        string[]
  publishers:        string[]
  release_date:      string | null
  year:              number | null
  coming_soon:       boolean
  header_image:      string
  background:        string | null
  screenshots:       { thumb: string; full: string }[]
  movies:            { name: string; thumbnail: string; mp4: string | null; webm: string | null; hls: string | null }[]
  metacritic:        { score: number; url: string | null } | null
  store_url:         string
}

/** Página de Perfil (ver server/profile.ts). `source` decide o selo da Steam. */
export type ProfileDataSource = 'steam' | 'shelf'
export interface ProfileView {
  user: {
    id:            number | null
    username:      string | null
    bio:           string | null
    display_name:  string
    avatar_url:    string | null
    avatar_source: ProfileDataSource | null
    member_since:  string
  }
  accounts: {
    steam: { persona: string; avatar_url: string | null; profile_url: string; source: 'steam' } | null
  }
  totals: { library: number; wishlist: number; backlog: number; diary: number; rated: number }
  shelf_by_year: { year: number; total: number; completed: number; in_progress: number }[]
  games: {
    year:                number
    played_hours:        number
    played_source:       ProfileDataSource
    playing:             number
    backlog:             number
    completed_total:     number
    platinum_total:      number
    completed_this_year: number
    platinum_this_year:  number
    completed_source:    ProfileDataSource
    achievements_unlocked: number
    rarest_achievement:  { name: string; game: string; media_item_id: number; percent: number } | null
  }
  favorites: { id: number; type: MediaType; title: string; cover_url: string | null; favorite: number }[]
  recent_ratings: { id: number; media_item_id: number; type: MediaType; title: string; cover_url: string | null; rating: number; watched_at: string }[]
  activity: { id: number; source: string; event_type: string; media_type: string; title: string; subtitle: string | null; cover_url: string | null; rating: number | null; occurred_at: string }[]
}

/** Diagnóstico só de leitura da conta Steam (ver server/steam/diagnostic.ts). */
export interface SteamDiagnostic {
  started_at:  string
  finished_at: string | null
  running:     boolean
  progress:    { done: number; total: number }
  owned_total:    number
  owned_played:   number
  playtime_hours: number
  shelf: {
    games:            number
    matched_by_appid: number
    matched_by_title: number
    outside_steam:    { library: string; count: number }[]
  }
  achievements: {
    checked:         number
    no_achievements: number
    auto:            number
    confirm:         number
    manual:          number
    games_with_hidden_without_description: number
    would_be_zerado:    number
    would_be_platinado: number
    private:            boolean
  }
  samples: {
    auto:    { title: string; achievements: string[]; unlocked: boolean }[]
    confirm: { title: string; candidates: string[]; hidden: number }[]
    manual:  string[]
  }
  errors: string[]
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

/* ─────────────────────────────── Contas ─────────────────────────────── */

export type UserRole = 'owner' | 'admin' | 'member'

/** A própria conta, como o servidor a descreve para o navegador. */
export interface SessionUser {
  id: number
  username: string
  display_name: string
  role: UserRole
  is_admin: boolean
  avatar_url: string | null
  bio: string | null
  must_change_password: boolean
}

export interface AuthState {
  setup_required: boolean
  user: SessionUser | null
}

/** Pessoa da instância (diretório público para menções e mensagens). */
export interface MemberSummary {
  id: number
  username: string
  display_name: string
  avatar_url: string | null
}

export interface AdminUser extends MemberSummary {
  role: UserRole
  status: 'active' | 'disabled'
  must_change_password: boolean
  created_at: string
  last_seen_at: string | null
}

/* ─────────────────────────────── Feed social ─────────────────────────────── */

export interface PersonRef {
  id: number
  username: string
  display_name: string
  avatar_url: string | null
}

/** Mídia marcada num post/comentário (retrato do momento em que foi marcada). */
export interface MediaRef {
  type: MediaType
  external_id: string
  title: string
  cover_url: string | null
  year: number | null
}

export interface Mention { id: number; username: string; display_name: string }

export interface ReactionSummary { emoji: string; count: number; mine: boolean; names: string[] }

export interface FeedMedia {
  local_id?: number
  type: MediaType
  external_id: string
  title: string
  cover_url: string | null
  year: number | null
}

export interface FeedDiaryData {
  entry_id: number
  watched_at: string
  rating: number | null
  comment: string | null
  source: string
  season_number: number | null
  episode_number: number | null
  episode_title: string | null
  progress: { value: number; total: number | null; unit: string } | null
  status: string | null
  game_status: string | null
}

export interface FeedAchievementsData {
  appid: number
  day: string
  items: { api_name: string; name: string; description: string | null; icon: string | null; percent: number | null; unlocked_at: string | null }[]
  unlocked: number | null
  total: number | null
}

export interface FeedListPreviewItem { title: string; cover_url: string | null; type: MediaType; rating?: number | null }

export interface FeedListData {
  list_id: number
  name: string
  description: string | null
  mode: 'list' | 'ranking' | 'tier'
  item_count: number
  tiers: { name: string; color: string; count: number; items: FeedListPreviewItem[] }[]
  items: FeedListPreviewItem[]
}

export interface FeedPost {
  id: number
  kind: 'post' | 'diary' | 'achievements' | 'list'
  created_at: string
  updated_at: string
  author: PersonRef
  body: string | null
  media: FeedMedia | null
  data: FeedDiaryData | FeedAchievementsData | FeedListData | null
  refs: MediaRef[]
  mentions: Mention[]
  images: { url: string; width: number; height: number }[]
  reactions: ReactionSummary[]
  comment_count: number
  can_delete: boolean
}

export interface FeedComment {
  id: number
  post_id: number
  parent_id: number | null
  author: PersonRef
  body: string | null
  deleted: boolean
  refs: MediaRef[]
  mentions: Mention[]
  created_at: string
  edited: boolean
  reactions: ReactionSummary[]
  can_edit: boolean
  can_delete: boolean
}

export interface FeedPage { posts: FeedPost[]; next: string | null }

export type NotificationType = 'comment' | 'reply' | 'reaction' | 'mention' | 'dm'

export interface NotificationItem {
  id: number
  type: NotificationType
  actor: PersonRef | null
  post_id: number | null
  comment_id: number | null
  detail: string | null
  snippet: string | null
  created_at: string
  read: boolean
}

export interface FeedPreferences { share_diary: boolean; share_achievements: boolean }

export interface PublicProfile {
  is_me: boolean
  profile: ProfileView
  shared_lists: { post_id: number; list_id: number; name: string; mode: string; item_count: number; created_at: string }[]
}

export interface SharedListView {
  id: number
  name: string
  description: string | null
  mode: 'list' | 'ranking' | 'tier'
  owner: PersonRef
  tiers: { id: number; name: string; color: string; position: number }[]
  items: { id: number; type: MediaType; external_id: string; title: string; cover_url: string | null; year: number | null; rating: number | null; tier_id: number | null; list_position: number }[]
}
