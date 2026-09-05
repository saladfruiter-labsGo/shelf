import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

const STATUS_LABEL: Record<string, string> = {
  completed:   'Concluído',
  in_progress: 'Jogando',
  wishlist:    'Wishlist',
  dropped:     'Abandonado',
}

export function LibraryGames() {
  const navigate = useNavigate()

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['media', 'game'],
    queryFn: () => api.media.list({ type: 'game', limit: 500 }),
  })

  const done = items.filter(i => i.status === 'completed').length
  const playing = items.filter(i => i.status === 'in_progress').length

  return (
    <div style={{ background: '#0C1A0F', color: '#F0F8F0', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '64px 64px 48px', maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32 }}>
        <div>
          <button
            onClick={() => navigate('/library')}
            style={{ fontSize: 12, color: '#6B8C70', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, letterSpacing: '0.5px' }}
          >
            ← Biblioteca
          </button>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '3px', textTransform: 'uppercase', color: '#FF5F1F', marginBottom: 16 }}>
            Jogos
          </p>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, lineHeight: 1, letterSpacing: '-2px' }}>
            Meus jogos
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 32, flexShrink: 0 }}>
          {[
            { n: items.length, l: 'Total' },
            { n: done,         l: 'Concluídos' },
            { n: playing,      l: 'Jogando' },
          ].map(s => (
            <div key={s.l} style={{ textAlign: 'right' }}>
              <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 40, fontWeight: 800, color: '#FF5F1F', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.n}</p>
              <p style={{ fontSize: 11, color: '#6B8C70', textTransform: 'uppercase', letterSpacing: '1px' }}>{s.l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 64px 80px', display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 16 }}>
        {isLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} style={{ background: '#132018', borderRadius: 16, overflow: 'hidden', border: '1px solid rgba(255,255,255,.04)', height: 220 }} />
            ))
          : items.map(item => (
              <div
                key={item.id}
                onClick={() => navigate(`/media/${item.id}`)}
                style={{
                  background: '#132018', borderRadius: 16, overflow: 'hidden',
                  cursor: 'pointer', border: '1px solid rgba(255,255,255,.04)',
                  transition: 'transform .28s cubic-bezier(.34,1.56,.64,1), box-shadow .28s',
                }}
                onMouseEnter={e => {
                  ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(-8px)'
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow = '0 24px 48px rgba(0,0,0,.6)'
                }}
                onMouseLeave={e => {
                  ;(e.currentTarget as HTMLDivElement).style.transform = 'translateY(0)'
                  ;(e.currentTarget as HTMLDivElement).style.boxShadow = 'none'
                }}
              >
                {/* Cover */}
                <div style={{
                  width: '100%', aspectRatio: '16/9',
                  background: item.cover_url ? 'transparent' : '#1E3020',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 64, position: 'relative', overflow: 'hidden',
                }}>
                  {item.cover_url
                    ? <img src={item.cover_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : '🎮'
                  }
                </div>
                {/* Body */}
                <div style={{ padding: 24 }}>
                  <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '1.5px', color: '#6B8C70', marginBottom: 8 }}>
                    {item.genre ?? 'Jogo'} · {item.year ?? '—'}
                  </p>
                  <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: '#F0F8F0', marginBottom: 8, lineHeight: 1.2 }}>
                    {item.title}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 16 }}>
                    {item.runtime
                      ? <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#2DFF8A' }}>{item.runtime}h</span>
                      : <span />
                    }
                    <span style={{
                      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px',
                      padding: '3px 8px', borderRadius: 4,
                      background: item.status === 'completed' ? 'rgba(45,255,138,.1)' : 'rgba(255,95,31,.12)',
                      color: item.status === 'completed' ? '#2DFF8A' : '#FF5F1F',
                    }}>
                      {STATUS_LABEL[item.status] ?? item.status}
                    </span>
                  </div>
                </div>
              </div>
            ))
        }
      </div>

      {items.length === 0 && !isLoading && (
        <div style={{ textAlign: 'center', padding: '80px 0', color: '#6B8C70' }}>
          <p style={{ fontFamily: 'Syne, sans-serif', fontSize: '3rem', fontWeight: 800, color: '#1E3020', marginBottom: 12 }}>Vazio</p>
          <p>Nenhum jogo na biblioteca ainda</p>
        </div>
      )}
    </div>
  )
}
