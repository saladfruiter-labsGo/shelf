import type { MediaItem, MediaStatus, MediaType, SearchResult, WrapData } from '../types'

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

  media: {
    list: (params?: { type?: MediaType; status?: MediaStatus; limit?: number }): Promise<MediaItem[]> => {
      const qs = new URLSearchParams()
      if (params?.type)   qs.set('type', params.type)
      if (params?.status) qs.set('status', params.status)
      if (params?.limit)  qs.set('limit', String(params.limit))
      return request(`/media?${qs}`)
    },

    recent: (): Promise<Record<MediaType, MediaItem[]>> =>
      request('/media/recent'),

    get: (id: number): Promise<MediaItem> =>
      request(`/media/${id}`),

    add: (data: Omit<MediaItem, 'id' | 'rating' | 'added_at' | 'updated_at'> & { rating?: number }): Promise<MediaItem> =>
      request('/media', { method: 'POST', body: JSON.stringify(data) }),

    update: (id: number, data: Partial<Pick<MediaItem, 'rating' | 'status' | 'notes' | 'runtime'>>): Promise<MediaItem> =>
      request(`/media/${id}`, { method: 'PATCH', body: JSON.stringify(data) }),

    remove: (id: number): Promise<{ ok: boolean }> =>
      request(`/media/${id}`, { method: 'DELETE' }),
  },

  wrap: (params: { period: 'monthly' | 'annual'; year: number; month?: number }): Promise<WrapData> => {
    const qs = new URLSearchParams({ period: params.period, year: String(params.year) })
    if (params.month) qs.set('month', String(params.month))
    return request(`/wrap?${qs}`)
  },

  settings: {
    get: (): Promise<Record<string, string>> =>
      request('/settings'),
    update: (data: Record<string, string>): Promise<Record<string, string>> =>
      request('/settings', { method: 'PATCH', body: JSON.stringify(data) }),
  },
}
