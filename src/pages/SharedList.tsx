import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { imageUrl } from '../lib/images'
import { tierVar } from '../lib/lists'
import { fmtRating } from '../lib/utils'
import { Avatar } from '../components/Avatar'
import { useMediaPreview } from '../components/MediaSummaryModal'
import type { SharedListView } from '../types'

type Item = SharedListView['items'][number]

function Poster({ item, rank }: { item: Item; rank?: number }) {
  const { openMedia } = useMediaPreview()
  return (
    <button type="button" className="text-left w-full"
      onClick={() => openMedia({ type: item.type, title: item.title, cover_url: item.cover_url, year: item.year, rating: item.rating })}>
      <span className="block relative rounded-lg overflow-hidden bg-card" style={{ aspectRatio: '2/3' }}>
        {item.cover_url && <img src={item.cover_url.startsWith('/') ? item.cover_url : imageUrl(item.cover_url, 240) ?? ''} alt="" loading="lazy" className="w-full h-full object-cover" />}
        {rank != null && <span className="social-rank">{rank}</span>}
        {item.rating != null && <span className="absolute bottom-1 right-1 text-xs font-bold px-1.5 py-0.5 rounded bg-black/70 text-white">★ {fmtRating(item.rating)}</span>}
      </span>
      <span className="block text-sm text-primary leading-tight mt-1.5">{item.title}</span>
      {item.year && <span className="block text-xs text-muted">{item.year}</span>}
    </button>
  )
}

/** Lista que outra pessoa compartilhou no feed — somente leitura. */
export function SharedList() {
  const { username = '', id } = useParams()
  const { data, error, isLoading } = useQuery({ queryKey: ['shared-list', username, id], queryFn: () => api.social.list(username, Number(id)) })

  if (isLoading) return <p className="text-muted text-center py-16">Carregando…</p>
  if (error || !data) return <p className="text-muted text-center py-16" style={{ fontSize: 16 }}>{(error as Error)?.message ?? 'Lista não encontrada.'}</p>

  const grid = { gridTemplateColumns: 'repeat(auto-fill, minmax(112px, 1fr))' }
  const untiered = data.items.filter(i => i.tier_id == null)

  return (
    <div className="px-4 sm:px-6 py-8 max-w-5xl mx-auto">
      <Link to={`/u/${data.owner.username}`} className="inline-flex items-center gap-2 text-sm text-muted hover:text-primary">
        <Avatar name={data.owner.display_name} url={data.owner.avatar_url} id={data.owner.id} size={24} />
        Lista de {data.owner.display_name}
      </Link>
      <h1 className="font-display font-extrabold text-primary mt-3" style={{ fontSize: 'clamp(30px,4vw,48px)', lineHeight: 1.05, letterSpacing: '-1px' }}>{data.name}</h1>
      {data.description && <p className="text-secondary mt-3 whitespace-pre-wrap" style={{ fontSize: 16 }}>{data.description}</p>}
      <p className="text-sm text-muted mt-2 mb-8">
        {data.mode === 'tier' ? 'Tier list' : data.mode === 'ranking' ? 'Ranking' : 'Lista'} · {data.items.length} {data.items.length === 1 ? 'item' : 'itens'}
      </p>

      {data.mode === 'tier' ? (
        <div className="space-y-2">
          {data.tiers.map(tier => {
            const items = data.items.filter(i => i.tier_id === tier.id)
            return (
              <div key={tier.id} className="flex gap-3 bg-surface border border-border rounded-xl p-2">
                <span className="social-tier" style={{ background: tierVar(tier.color), minWidth: 64, fontSize: 22 }}>{tier.name}</span>
                <div className="grid gap-2 flex-1" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(84px, 1fr))' }}>
                  {items.map(item => <Poster key={item.id} item={item} />)}
                  {!items.length && <span className="text-sm text-muted self-center">—</span>}
                </div>
              </div>
            )
          })}
          {untiered.length > 0 && (
            <div className="mt-6">
              <h2 className="text-sm text-muted mb-2">Sem tier</h2>
              <div className="grid gap-3" style={grid}>{untiered.map(item => <Poster key={item.id} item={item} />)}</div>
            </div>
          )}
        </div>
      ) : (
        <div className="grid gap-4" style={grid}>
          {data.items.map((item, i) => <Poster key={item.id} item={item} rank={data.mode === 'ranking' ? i + 1 : undefined} />)}
        </div>
      )}
    </div>
  )
}
