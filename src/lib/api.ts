import type {
  Details, List, ListCheck, ListDetail,
  MediaItem, MediaStatus, MediaType,
  SearchResult, WrapData,
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
    update: (id: number, data: Partial<Pick<MediaItem, 'rating' | 'status' | 'notes' | 'runtime' | 'synopsis' | 'creators' | 'author' | 'release_date' | 'hype' | 'completed_at'>>): Promise<MediaItem> =>
      request(`/media/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),
    remove: (id: number): Promise<{ ok: boolean }> =>
      request(`/media/${id}`, { method: 'DELETE' }),
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
}
