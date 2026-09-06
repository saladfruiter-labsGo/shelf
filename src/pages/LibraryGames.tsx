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
    <div style={{ background: 'var(--bg)', color: 'var(--text-primary)', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '64px 64px 48px', maxWidth: 1200, margin: '0 auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 32 }}>
        <div>
          <button
            onClick={() => navigate('/library')}
            className="link-accent"
            style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, letterSpacing: '0.5px' }}
          >
            ← Biblioteca
          </button>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '3px', textTransform: 'uppercase', color: 'var(--games)', marginBottom: 16 }}>
            Jogos
          </p>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, lineHeight: 1, letterSpacing: '-2px' }}>
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
              <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 40, fontWeight: 800, color: 'var(--games)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.n}</p>
              <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>{s.l}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Grid */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 64px 80px', display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ background: 'var(--card)', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)', aspectRatio: '2/3.55' }} />
            ))
          : items.map(item => (
              <div
                key={item.id}
                onClick={() => navigate(`/media/${item.id}`)}
                className="media-lift"
                style={{
                  background: 'var(--card)', borderRadius: 16, overflow: 'hidden',
                  cursor: 'pointer', border: '1px solid var(--border)',
                }}
              >
                {/* Cover — full 2:3 poster, like the Home page */}
                <div style={{
                  width: '100%', aspectRatio: '2/3',
                  background: item.cover_url ? 'transparent' : 'var(--card-hover)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 64, position: 'relative', overflow: 'hidden',
                }}>
                  {item.cover_url
                    ? <img src={item.cover_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : '🎮'
                  }
                </div>
                {/* Body */}
                <div style={{ padding: 16 }}>
                  <p style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 10, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text-muted)', marginBottom: 6 }}>
                    {item.genre ?? 'Jogo'} · {item.year ?? '—'}
                  </p>
                  <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, lineHeight: 1.2 }}>
                    {item.title}
                  </p>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 10 }}>
                    {item.runtime
                      ? <span style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 13, color: 'var(--games)' }}>{item.runtime}h</span>
                      : <span />
                    }
                    <span style={{
                      fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px',
                      padding: '3px 8px', borderRadius: 4,
                      background: item.status === 'completed' ? 'var(--accent-bg)' : 'var(--games-bg)',
                      color: item.status === 'completed' ? 'var(--accent)' : 'var(--games)',
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
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
          <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, color: 'var(--border-strong)', marginBottom: 12 }}>Vazio</p>
          <p>Nenhum jogo na biblioteca ainda</p>
        </div>
      )}
    </div>
  )
}
