import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function LibraryFilms() {
  const navigate = useNavigate()

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['media', 'movie'],
    queryFn: () => api.media.list({ type: 'movie', limit: 500 }),
  })

  const watched = items.filter(i => i.status === 'completed').length

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
            Filmes
          </p>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1 }}>
            Meus filmes
          </h1>
        </div>
        <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#5A5A78', paddingBottom: 8 }}>
          {items.length} filmes · {watched} assistidos
        </p>
      </div>

      {/* Grid — 5 columns poster style */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 64px 80px', display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 16 }}>
        {isLoading
          ? Array.from({ length: 10 }).map((_, i) => (
              <div key={i} style={{ aspectRatio: '2/3', background: '#0E0E18', borderRadius: 12 }} />
            ))
          : items.map(item => (
              <div
                key={item.id}
                onClick={() => navigate(`/media/${item.id}`)}
                style={{ cursor: 'pointer', transition: 'transform .28s cubic-bezier(.34,1.56,.64,1)' }}
                onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.transform = 'scale(1.03) translateY(-4px)')}
                onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.transform = 'scale(1) translateY(0)')}
              >
                {/* Poster */}
                <div style={{
                  aspectRatio: '2/3', background: '#0E0E18', borderRadius: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 56, marginBottom: 12, overflow: 'hidden', position: 'relative',
                }}>
                  {item.cover_url
                    ? <img src={item.cover_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : '🎬'
                  }
                  {/* Hover overlay */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(to top,rgba(6,6,12,.9) 0%,transparent 55%)',
                    display: 'flex', alignItems: 'flex-end', padding: 12,
                    opacity: 0, transition: 'opacity .2s',
                  }}
                    className="film-overlay"
                  >
                    {item.status === 'completed' && (
                      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 4, background: 'rgba(230,53,96,.2)', color: '#E63560' }}>
                        Assistido
                      </span>
                    )}
                  </div>
                </div>
                <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 14, fontWeight: 700, color: '#F0F0F8', marginBottom: 3, lineHeight: 1.2 }}>
                  {item.title}
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: '#5A5A78' }}>{item.year ?? '—'}</span>
                  {item.rating > 0 && (
                    <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: '#E63560' }}>★ {item.rating}</span>
                  )}
                </div>
              </div>
            ))
        }
      </div>

      {items.length === 0 && !isLoading && (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <p style={{ fontFamily: 'Syne, sans-serif', fontSize: '3rem', fontWeight: 800, color: '#0E0E18', marginBottom: 12 }}>Vazio</p>
          <p style={{ color: '#5A5A78' }}>Nenhum filme na biblioteca ainda</p>
        </div>
      )}

      <style>{`.film-overlay:hover { opacity: 1; }`}</style>
    </div>
  )
}
