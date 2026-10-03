import { useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import type { FeedMedia } from '../../types'

/** "Quero" — leva a obra para a própria Wishlist. */
export function WantButton({ media }: { media: { type: FeedMedia['type']; external_id: string; title: string; cover_url: string | null; year: number | null } }) {
  const qc = useQueryClient()
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'have'>('idle')
  // Capas que passam pelo proxy de outra pessoa não servem para a sua biblioteca.
  const cover = media.cover_url && !/^\/api\/(feed|messages)\//.test(media.cover_url) ? media.cover_url : null
  const add = async () => {
    setState('busy')
    try {
      await api.media.add({ external_id: media.external_id, type: media.type, title: media.title, cover_url: cover, year: media.year, status: 'wishlist' } as Parameters<typeof api.media.add>[0])
      qc.invalidateQueries({ queryKey: ['media'] })
      setState('done')
    } catch (err) {
      setState(/já está/i.test((err as Error).message) ? 'have' : 'idle')
    }
  }
  if (state === 'done') return <span className="text-sm text-games">✓ Na sua Wishlist</span>
  if (state === 'have') return <span className="text-sm text-muted">Já está na sua prateleira</span>
  return (
    <button type="button" onClick={add} disabled={state === 'busy'} className="social-action">
      <span aria-hidden>＋</span><span>Quero</span>
    </button>
  )
}
