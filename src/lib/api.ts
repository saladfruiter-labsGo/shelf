import type {
  Details, List, ListCheck, ListDetail, ListMode, ListTier,
  MediaItem, MediaStatus, MediaType,
  SearchResult, WrapData, SeriesView, SeriesPreview, DiaryEntry, TmdbMediaPreview,
  IntegrationStatus, NowPlaying, ActivityEvent, ActivityMediaType, MusicStats, TrendingItem,
  GamePriceBacklog, GamePriceDetails, GamePriceRange, GamePriceCandidate,
  SteamSyncResult, ExportScope, ExportSummary, ImportReport, BackupStatus, DatabaseBackupInfo,
  LetterboxdKind, LetterboxdPlan, LetterboxdPreview, LetterboxdApplyResult,
  PlexFilenameSyncResult, SearchApiKeySettings,
} from '../types'

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...init,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error: string }).error ?? res.statusText)
  }
  return res.json()
}

/** Upload de arquivo. Sem `Content-Type`: quem escreve o boundary é o navegador. */
async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  const res = await fetch(`/api${path}`, { method: 'POST', body: form })
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }))
    throw new Error((err as { error: string }).error ?? res.statusText)
  }
  return res.json()
}

export const api = {
  search: (q: string, type?: MediaType): Promise<{ results: SearchResult[] }> =>
    request(`/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`),

  details: (type: MediaType, externalId: string): Promise<Details> =>
    request(`/details/${type}/${externalId}`),

  media: {
    /** `library: true` exclui a wishlist no servidor, antes do limite de linhas. */
    list: (params?: { type?: MediaType; status?: MediaStatus; limit?: number; offset?: number; library?: boolean }): Promise<MediaItem[]> => {
      const qs = new URLSearchParams()
      if (params?.type)    qs.set('type', params.type)
      if (params?.status)  qs.set('status', params.status)
      if (params?.library) qs.set('library', '1')
      if (params?.limit)   qs.set('limit', String(params.limit))
      if (params?.offset)  qs.set('offset', String(params.offset))
      return request(`/media?${qs}`)
    },
    /**
     * A coleção inteira, buscada em páginas.
     *
     * Para telas que precisam de todos os itens para trabalhar — o Backlog monta
     * as opções de filtro e ordena por preço a partir do conjunto completo. Um
     * `limit` chutado ali esconde item sem avisar; aqui a busca só para quando o
     * servidor devolve uma página curta.
     */
    listAll: async (params?: { type?: MediaType; status?: MediaStatus; library?: boolean }, pageSize = 500): Promise<MediaItem[]> => {
      const all: MediaItem[] = []
      for (let offset = 0; ; offset += pageSize) {
        const page = await api.media.list({ ...params, limit: pageSize, offset })
        all.push(...page)
        if (page.length < pageSize) return all
      }
    },
    recent:   (): Promise<Record<MediaType, MediaItem[]>> => request('/media/recent'),
    upcoming: (): Promise<{ wishlist: MediaItem[]; hype: MediaItem[] }> => request('/media/upcoming'),
    get:      (id: number): Promise<MediaItem>            => request(`/media/${id}`),
    add: (data: Omit<MediaItem, 'id' | 'hype' | 'favorite' | 'added_at' | 'updated_at' | 'original_filename'> & { rating?: number }): Promise<MediaItem> =>
      request('/media', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Pick<MediaItem, 'rating' | 'status' | 'runtime' | 'synopsis' | 'creators' | 'author' | 'release_date' | 'hype' | 'favorite' | 'completed_at' | 'game_status' | 'last_played_at' | 'playtime_seconds'>>): Promise<MediaItem> =>
      request(`/media/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    quickRate: (id: number, rating: number): Promise<MediaItem> =>
      request(`/media/${id}/quick-rating`, { method: 'PATCH', body: JSON.stringify({ rating }) }),
    previewTmdb: (id: number, tmdbId: string): Promise<TmdbMediaPreview> =>
      request(`/media/${id}/tmdb-preview?tmdb_id=${encodeURIComponent(tmdbId)}`),
    identifyTmdb: (id: number, tmdbId: string): Promise<MediaItem> =>
      request(`/media/${id}/tmdb-identification`, { method: 'PATCH', body: JSON.stringify({ tmdb_id: tmdbId }) }),
    remove: (id: number): Promise<{ ok: boolean }> =>
      request(`/media/${id}`, { method: 'DELETE' }),
  },

  diary: {
    list: (params?: { media_item_id?: number }): Promise<DiaryEntry[]> => {
      const qs = new URLSearchParams()
      if (params?.media_item_id) qs.set('media_item_id', String(params.media_item_id))
      const q = qs.toString()
      return request(`/diary${q ? `?${q}` : ''}`)
    },
    create: (data: { media_item_id: number; watched_at?: string; rating?: number | null; comment?: string | null }): Promise<DiaryEntry> =>
      request('/diary', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: { watched_at?: string; rating?: number | null; comment?: string | null }): Promise<DiaryEntry> =>
      request(`/diary/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number): Promise<{ ok: boolean }> =>
      request(`/diary/${id}`, { method: 'DELETE' }),
  },

  series: {
    get: (id: number): Promise<SeriesView> => request(`/series/${id}`),
    preview: (tmdbId: string): Promise<SeriesPreview> => request(`/series/preview/${tmdbId}`),
    enrich: (id: number): Promise<SeriesView> => request(`/series/${id}/enrich`, { method: 'POST' }),
    watchedBatch: (id: number, data: {
      episodes: { season_number: number; episode_number: number }[]
      diary?: boolean
      watched_at?: string
      rating?: number | null
      comment?: string | null
    }): Promise<SeriesView> =>
      request(`/series/${id}/watched-batch`, { method: 'POST', body: JSON.stringify(data) }),
    toggleEpisode: (id: number, season_number: number, episode_number: number, watched: boolean): Promise<SeriesView> =>
      request(`/series/${id}/episode`, { method: 'PATCH', body: JSON.stringify({ season_number, episode_number, watched }) }),
    toggleSeason: (id: number, season_number: number, watched: boolean): Promise<SeriesView> =>
      request(`/series/${id}/season`, { method: 'PATCH', body: JSON.stringify({ season_number, watched }) }),
  },

  lists: {
    list:    (): Promise<List[]>                                => request('/lists'),
    check:   (mediaItemId: number): Promise<ListCheck[]>       => request(`/lists/check/${mediaItemId}`),
    get:     (id: number): Promise<ListDetail>                 => request(`/lists/${id}`),
    create:  (data: { name: string; description?: string; mode?: ListMode }): Promise<List> =>
      request('/lists', { method: 'POST', body: JSON.stringify(data) }),
    update:  (id: number, data: { name?: string; description?: string; mode?: ListMode; dim_seen?: boolean }): Promise<List> =>
      request(`/lists/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove:  (id: number): Promise<{ ok: boolean }> =>
      request(`/lists/${id}`, { method: 'DELETE' }),
    addItem: (listId: number, mediaItemId: number, tierId?: number | null): Promise<{ ok: boolean }> =>
      request(`/lists/${listId}/items`, { method: 'POST', body: JSON.stringify({ media_item_id: mediaItemId, tier_id: tierId ?? null }) }),
    removeItem: (listId: number, mediaItemId: number): Promise<{ ok: boolean }> =>
      request(`/lists/${listId}/items/${mediaItemId}`, { method: 'DELETE' }),
    /** Ordem manual completa — serve ao ranking e ao arraste entre tiers. */
    reorder: (listId: number, items: { media_item_id: number; tier_id: number | null }[]): Promise<{ ok: boolean }> =>
      request(`/lists/${listId}/order`, { method: 'PUT', body: JSON.stringify({ items }) }),
    addTier: (listId: number, data: { name: string; color?: string }): Promise<ListTier> =>
      request(`/lists/${listId}/tiers`, { method: 'POST', body: JSON.stringify(data) }),
    updateTier: (listId: number, tierId: number, data: { name?: string; color?: string }): Promise<ListTier> =>
      request(`/lists/${listId}/tiers/${tierId}`, { method: 'PATCH', body: JSON.stringify(data) }),
    reorderTiers: (listId: number, tiers: { id: number }[]): Promise<ListTier[]> =>
      request(`/lists/${listId}/tiers/order`, { method: 'PUT', body: JSON.stringify({ tiers }) }),
    removeTier: (listId: number, tierId: number): Promise<{ ok: boolean }> =>
      request(`/lists/${listId}/tiers/${tierId}`, { method: 'DELETE' }),
  },

  wrap: (params: { period: 'monthly' | 'annual'; year: number; month?: number }): Promise<WrapData> => {
    const qs = new URLSearchParams({ period: params.period, year: String(params.year) })
    if (params.month) qs.set('month', String(params.month))
    return request(`/wrap?${qs}`)
  },

  settings: {
    get:    (): Promise<SearchApiKeySettings> => request('/settings'),
    update: (data: Record<string, unknown>): Promise<SearchApiKeySettings> =>
      request('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  },

  integrations: {
    status:     (): Promise<IntegrationStatus> => request('/integrations'),
    plexSyncFiles: (): Promise<PlexFilenameSyncResult> =>
      request('/integrations/plex/sync-files', { method: 'POST' }),
    update:     (data: Record<string, unknown>): Promise<{ ok: boolean }> =>
      request('/integrations', { method: 'PATCH', body: JSON.stringify(data) }),
    nowPlaying: (): Promise<NowPlaying> => request('/integrations/now-playing'),
    activity:   (params?: { limit?: number; source?: 'plex' | 'lastfm' | 'kavita' | 'playnite'; media_type?: ActivityMediaType }): Promise<ActivityEvent[]> => {
      const qs = new URLSearchParams()
      if (params?.limit)      qs.set('limit', String(params.limit))
      if (params?.source)     qs.set('source', params.source)
      if (params?.media_type) qs.set('media_type', params.media_type)
      return request(`/integrations/activity?${qs}`)
    },
    musicStats: (): Promise<MusicStats> => request('/integrations/music/stats'),
    trending:   (): Promise<TrendingItem[]> => request('/integrations/trending'),
    lastfmSync: (): Promise<{ ok: boolean }> =>
      request('/integrations/lastfm/sync', { method: 'POST' }),
    telegramTest: (): Promise<{ ok: boolean; error?: string }> =>
      request('/integrations/telegram/test', { method: 'POST' }),
    telegramDetectChat: (): Promise<{ chats: { chat_id: string; thread_id: string; name: string }[] }> =>
      request('/integrations/telegram/detect-chat'),
    kavitaSync: (): Promise<{ ok: boolean }> =>
      request('/integrations/kavita/sync', { method: 'POST' }),
    kavitaTest: (): Promise<{ ok: boolean; error?: string }> =>
      request('/integrations/kavita/test', { method: 'POST' }),
    playniteTest: (): Promise<{ ok: boolean; error?: string }> =>
      request('/integrations/playnite/test', { method: 'POST' }),
    itadTest: (): Promise<{ ok: boolean; shops?: number; error?: string }> =>
      request('/integrations/itad/test', { method: 'POST' }),
    itadSync: (): Promise<{ ok: boolean }> =>
      request('/integrations/itad/sync', { method: 'POST' }),
    steamTest: (): Promise<{ ok: boolean; wishlist?: number; owned?: number | null; can_write?: boolean; error?: string }> =>
      request('/integrations/steam/test', { method: 'POST' }),
    steamSync: (): Promise<SteamSyncResult> =>
      request('/integrations/steam/sync', { method: 'POST' }),
    steamResolve: (input: string): Promise<{ ok: boolean; steam_id?: string; error?: string }> =>
      request('/integrations/steam/resolve', { method: 'POST', body: JSON.stringify({ input }) }),
  },

  transfer: {
    summary: (): Promise<ExportSummary> => request('/transfer/export/summary'),
    backupStatus: (): Promise<BackupStatus> => request('/transfer/backup/status'),
    backupNow: (): Promise<DatabaseBackupInfo> => request('/transfer/backup', { method: 'POST' }),
    /** URL de download direto — o navegador baixa o arquivo, sem passar pelo fetch. */
    exportUrl: (scope: ExportScope, format: 'json' | 'csv'): string =>
      `/api/transfer/export?scope=${scope}&format=${format}`,
    importShelf: (payload: unknown, mode: 'merge' | 'replace' = 'merge'): Promise<ImportReport> =>
      request('/transfer/import/shelf', { method: 'POST', body: JSON.stringify({ payload, mode }) }),
    /** Lê o .zip (ou um .csv solto) e devolve o plano — sem escrever nada ainda. */
    previewLetterboxd: (file: File): Promise<LetterboxdPreview> =>
      upload('/transfer/import/letterboxd/preview', file),
    /** Refaz o plano com o tipo corrigido na tela, no mesmo `planId`. */
    replanLetterboxd: (planId: string, overrides: Record<string, LetterboxdKind>): Promise<{ planId: string; plan: LetterboxdPlan }> =>
      request('/transfer/import/letterboxd/replan', { method: 'POST', body: JSON.stringify({ planId, overrides }) }),
    /** Confirma o plano da prévia. Vale uma vez: depois dela o plano é descartado. */
    applyLetterboxd: (planId: string, redo = false): Promise<LetterboxdApplyResult> =>
      request('/transfer/import/letterboxd/apply', { method: 'POST', body: JSON.stringify({ planId, redo }) }),
    /** Aborta: descarta o plano no servidor sem escrever nada. */
    abortLetterboxd: (planId: string): Promise<{ ok: boolean; discarded: boolean }> =>
      request('/transfer/import/letterboxd/abort', { method: 'POST', body: JSON.stringify({ planId }) }),
    /** Traz a wishlist da Steam para o backlog, uma vez. */
    importSteam: (): Promise<SteamSyncResult> =>
      request('/transfer/import/steam', { method: 'POST' }),
  },

  prices: {
    /** Resumo de todos os jogos do backlog numa única chamada. */
    backlog: (): Promise<GamePriceBacklog> => request('/prices/backlog'),
    game: (mediaItemId: number, params?: { range?: GamePriceRange; shop?: number | null }): Promise<GamePriceDetails> => {
      const qs = new URLSearchParams()
      if (params?.range) qs.set('range', params.range)
      if (params?.shop)  qs.set('shop', String(params.shop))
      const q = qs.toString()
      return request(`/prices/games/${mediaItemId}${q ? `?${q}` : ''}`)
    },
    refresh: (mediaItemId: number): Promise<{ ok: boolean }> =>
      request(`/prices/games/${mediaItemId}/refresh`, { method: 'POST' }),
    matches: (mediaItemId: number, query: string): Promise<{ candidates: GamePriceCandidate[] }> =>
      request(`/prices/games/${mediaItemId}/matches?q=${encodeURIComponent(query)}`),
    setMatch: (mediaItemId: number, match: { provider_game_id?: string; title?: string; clear?: boolean }): Promise<{ ok: boolean }> =>
      request(`/prices/games/${mediaItemId}/match`, { method: 'PATCH', body: JSON.stringify(match) }),
  },
}
