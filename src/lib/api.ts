import type {
  Details, List, ListCheck, ListDetail,
  MediaItem, MediaStatus, MediaType,
  SearchResult, WrapData, SeriesView, SeriesPreview, DiaryEntry,
  IntegrationStatus, NowPlaying, ActivityEvent, ActivityMediaType, MusicStats,
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

export const api = {
  search: (q: string, type?: MediaType): Promise<{ results: SearchResult[] }> =>
    request(`/search?q=${encodeURIComponent(q)}${type ? `&type=${type}` : ''}`),

  details: (type: MediaType, externalId: string): Promise<Details> =>
    request(`/details/${type}/${externalId}`),

  media: {
    list: (params?: { type?: MediaType; status?: MediaStatus; limit?: number }): Promise<MediaItem[]> => {
      const qs = new URLSearchParams()
      if (params?.type)   qs.set('type', params.type)
      if (params?.status) qs.set('status', params.status)
      if (params?.limit)  qs.set('limit', String(params.limit))
      return request(`/media?${qs}`)
    },
    recent:   (): Promise<Record<MediaType, MediaItem[]>> => request('/media/recent'),
    upcoming: (): Promise<{ wishlist: MediaItem[]; hype: MediaItem[] }> => request('/media/upcoming'),
    get:      (id: number): Promise<MediaItem>            => request(`/media/${id}`),
    add: (data: Omit<MediaItem, 'id' | 'hype' | 'added_at' | 'updated_at'> & { rating?: number }): Promise<MediaItem> =>
      request('/media', { method: 'POST', body: JSON.stringify(data) }),
    update: (id: number, data: Partial<Pick<MediaItem, 'rating' | 'status' | 'runtime' | 'synopsis' | 'creators' | 'author' | 'release_date' | 'hype' | 'completed_at' | 'game_status' | 'last_played_at' | 'playtime_seconds'>>): Promise<MediaItem> =>
      request(`/media/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
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
    create:  (data: { name: string; description?: string }): Promise<List> =>
      request('/lists', { method: 'POST', body: JSON.stringify(data) }),
    update:  (id: number, data: { name?: string; description?: string }): Promise<List> =>
      request(`/lists/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove:  (id: number): Promise<{ ok: boolean }> =>
      request(`/lists/${id}`, { method: 'DELETE' }),
    addItem: (listId: number, mediaItemId: number): Promise<{ ok: boolean }> =>
      request(`/lists/${listId}/items`, { method: 'POST', body: JSON.stringify({ media_item_id: mediaItemId }) }),
    removeItem: (listId: number, mediaItemId: number): Promise<{ ok: boolean }> =>
      request(`/lists/${listId}/items/${mediaItemId}`, { method: 'DELETE' }),
  },

  wrap: (params: { period: 'monthly' | 'annual'; year: number; month?: number }): Promise<WrapData> => {
    const qs = new URLSearchParams({ period: params.period, year: String(params.year) })
    if (params.month) qs.set('month', String(params.month))
    return request(`/wrap?${qs}`)
  },

  settings: {
    get:    (): Promise<Record<string, string>> => request('/settings'),
    update: (data: Record<string, string>): Promise<Record<string, string>> =>
      request('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  },

  integrations: {
    status:     (): Promise<IntegrationStatus> => request('/integrations'),
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
  },
}
