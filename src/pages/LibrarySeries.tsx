import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { SeriesModal } from '../components/SeriesModal'
import { LibraryStats } from '../components/LibraryStats'
import { LibrarySearch } from '../components/LibrarySearch'
import { norm } from '../lib/utils'

const STATUS_LABEL: Record<string, string> = {
  completed:   'Finalizada',
  in_progress: 'Assistindo',
  wishlist:    'Backlog',
  dropped:     'Abandonada',
}

// Estados com contador próprio no cabeçalho (como na biblioteca de jogos).
type ShelfFilter = 'in_progress' | 'completed'
const HEADER_STATES: { key: ShelfFilter; label: string; color: string }[] = [
  { key: 'in_progress', label: 'Em andamento', color: 'var(--series)' },
  { key: 'completed',   label: 'Finalizadas',  color: 'var(--accent)' },
]

export function LibrarySeries() {
  const navigate = useNavigate()
  const [openId, setOpenId] = useState<number | null>(null)
  const [statusFilter, setStatusFilter] = useState<ShelfFilter | null>(null)
  const [search, setSearch] = useState('')

  const { data: rawItems = [], isLoading } = useQuery({
    queryKey: ['media', 'series'],
    queryFn: () => api.media.list({ type: 'series', limit: 500 }),
  })

  // Itens em wishlist ficam só na Wishlist, fora da biblioteca.
  const items = rawItems.filter(i => i.status !== 'wishlist')

  const countByStatus = (st: ShelfFilter) => items.filter(i => i.status === st).length

  // Grid filtrado pelo contador clicado + busca por nome (instantânea).
  const q = norm(search)
  const visible = items.filter(i => {
    if (statusFilter && i.status !== statusFilter) return false
    if (q && !norm(i.title).includes(q)) return false
    return true
  })

  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text-primary)', minHeight: '100vh' }}>
      {/* Header */}
      <div className="lib-header" style={{ padding: '64px var(--page-x) 48px', maxWidth: 1280, margin: '0 auto' }}>
        <div>
          <button
            onClick={() => navigate('/library')}
            className="link-accent"
            style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, letterSpacing: '0.5px' }}
          >
            ← Biblioteca
          </button>
          <p style={{ fontSize: 11, letterSpacing: '3px', textTransform: 'uppercase', color: 'var(--series)', marginBottom: 16, fontWeight: 600 }}>
            Séries
          </p>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1 }}>
            Minhas séries
          </h1>
        </div>
        <LibraryStats
          stats={[
            { key: null, n: items.length, label: 'Total', color: 'var(--text-primary)' },
            ...HEADER_STATES.map(st => ({ key: st.key, n: countByStatus(st.key), label: st.label, color: st.color })),
          ]}
          active={statusFilter}
          onChange={setStatusFilter}
        />
      </div>

      {/* Busca por nome (filtra instantaneamente) */}
      <LibrarySearch
        value={search}
        onChange={setSearch}
        ariaLabel="Buscar série por nome"
        count={visible.length}
        showCount={Boolean(statusFilter || q)}
        countSuffix={statusFilter ? ` · ${HEADER_STATES.find(h => h.key === statusFilter)!.label}` : undefined}
      />

      {/* Grid — 3 columns banner cards */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 var(--page-x) 80px', display: 'grid', gridTemplateColumns: 'var(--grid-games)', gap: 16 }}>
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ background: 'var(--card)', borderRadius: 16, overflow: 'hidden', aspectRatio: '2/3.6' }} />
            ))
          : visible.map(item => (
              <div
                key={item.id}
                onClick={() => setOpenId(item.id)}
                className="media-lift"
                style={{
                  background: 'var(--card)', borderRadius: 16, overflow: 'hidden',
                  cursor: 'pointer', border: '1px solid var(--border)',
                }}
              >
                {/* Poster — full 2:3, like the Home page */}
                <div style={{
                  width: '100%', aspectRatio: '2/3',
                  background: item.cover_url ? 'transparent' : 'var(--card-hover)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 64, overflow: 'hidden',
                }}>
                  {item.cover_url
                    ? <img src={item.cover_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : '📺'
                  }
                </div>
                {/* Body */}
                <div style={{ padding: 16 }}>
                  <p style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text-muted)', marginBottom: 6 }}>
                    {item.genre ?? 'Série'} · {item.year ?? '—'}
                  </p>
                  <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 10 }}>
                    {item.title}
                  </p>
                  {/* Progress bar — percentual real de episódios vistos */}
                  {(() => {
                    const pct = Math.round((item.progress ?? (item.status === 'completed' ? 1 : 0)) * 100)
                    return (
                      <>
                        <div style={{ height: 3, background: 'var(--border)', borderRadius: 2, marginBottom: 8, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 2, background: 'var(--series)',
                            width: `${pct}%`, transition: 'width .5s ease',
                          }} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {item.status === 'completed' ? STATUS_LABEL.completed : `${pct}% assistido`}
                          </span>
                          {item.rating > 0 && (
                            <span style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 11, color: 'var(--series)' }}>★ {item.rating}</span>
                          )}
                        </div>
                      </>
                    )
                  })()}
                </div>
              </div>
            ))
        }
      </div>

      {visible.length === 0 && !isLoading && (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, color: 'var(--border-strong)', marginBottom: 12 }}>Vazio</p>
          <p style={{ color: 'var(--text-muted)' }}>{items.length === 0 ? 'Nenhuma série na biblioteca ainda' : 'Nenhuma série encontrada'}</p>
        </div>
      )}

      {openId != null && <SeriesModal id={openId} onClose={() => setOpenId(null)} />}
    </div>
  )
}
