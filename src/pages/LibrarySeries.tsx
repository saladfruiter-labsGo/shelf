import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

const STATUS_LABEL: Record<string, string> = {
  completed:   'Finalizada',
  in_progress: 'Assistindo',
  wishlist:    'Wishlist',
  dropped:     'Abandonada',
}

export function LibrarySeries() {
  const navigate = useNavigate()

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['media', 'series'],
    queryFn: () => api.media.list({ type: 'series', limit: 500 }),
  })

  const done     = items.filter(i => i.status === 'completed').length
  const watching = items.filter(i => i.status === 'in_progress').length

  return (
    <div style={{ background: '#06060C', color: '#F0F0F8', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '64px 64px 48px', maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <button
            onClick={() => navigate('/library')}
            style={{ fontSize: 12, color: '#5A5A78', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, letterSpacing: '0.5px' }}
          >
            ← Biblioteca
          </button>
          <p style={{ fontSize: 11, letterSpacing: '3px', textTransform: 'uppercase', color: '#E63560', marginBottom: 16, fontWeight: 600 }}>
            Séries
          </p>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1 }}>
            Minhas séries
          </h1>
        </div>
        <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#5A5A78', paddingBottom: 8 }}>
          {items.length} séries · {done} finalizadas
        </p>
      </div>

      {/* Grid — 3 columns banner cards */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 64px 80px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 24 }}>
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ background: '#0E0E18', borderRadius: 16, overflow: 'hidden', height: 260 }} />
            ))
          : items.map(item => (
              <div
                key={item.id}
                onClick={() => navigate(`/media/${item.id}`)}
                style={{
                  background: '#0E0E18', borderRadius: 16, overflow: 'hidden',
                  cursor: 'pointer', border: '1px solid rgba(255,255,255,.04)',
                  transition: 'transform .28s cubic-bezier(.34,1.56,.64,1), box-shadow .28s',
                }}
                onMouseEnter={e => {
                  ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(-8px)'
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 24px 48px rgba(0,0,0,.7)'
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
                }}
              >
                {/* Banner */}
                <div style={{
                  width: '100%', aspectRatio: '16/9',
                  background: item.cover_url ? 'transparent' : '#12121E',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 64, overflow: 'hidden',
                }}>
                  {item.cover_url
                    ? <img src={item.cover_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : '📺'
                  }
                </div>
                {/* Body */}
                <div style={{ padding: 24 }}>
                  <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#5A5A78', marginBottom: 8 }}>
                    {item.genre ?? 'Série'} · {item.year ?? '—'}
                  </p>
                  <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: '#F0F0F8', marginBottom: 12 }}>
                    {item.title}
                  </p>
                  {/* Progress bar */}
                  <div style={{ height: 3, background: 'rgba(255,255,255,.08)', borderRadius: 2, marginBottom: 8, overflow: 'hidden' }}>
                    <div style={{
                      height: '100%', borderRadius: 2, background: '#E63560',
                      width: item.status === 'completed' ? '100%' : item.status === 'in_progress' ? '50%' : '0%',
                      transition: 'width .5s ease',
                    }} />
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                    <span style={{ fontSize: 12, color: '#5A5A78' }}>{STATUS_LABEL[item.status] ?? item.status}</span>
                    {item.rating > 0 && (
                      <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#E63560' }}>★ {item.rating}</span>
                    )}
                  </div>
                </div>
              </div>
            ))
        }
      </div>

      {items.length === 0 && !isLoading && (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <p style={{ fontFamily: 'Syne, sans-serif', fontSize: '3rem', fontWeight: 800, color: '#0E0E18', marginBottom: 12 }}>Vazio</p>
          <p style={{ color: '#5A5A78' }}>Nenhuma série na biblioteca ainda</p>
        </div>
      )}
    </div>
  )
}
