import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

export function LibraryMusic() {
  const navigate = useNavigate()

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['media', 'music'],
    queryFn: () => api.media.list({ type: 'music', limit: 500 }),
  })

  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text-primary)', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '64px 64px 48px', maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <button
            onClick={() => navigate('/library')}
            className="link-accent"
            style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, letterSpacing: '0.5px' }}
          >
            ← Biblioteca
          </button>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '3px', textTransform: 'uppercase', color: 'var(--music)', marginBottom: 16 }}>
            Músicas
          </p>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--text-primary)' }}>
            Minhas músicas
          </h1>
        </div>
        <p style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 13, color: 'var(--text-muted)', paddingBottom: 8 }}>
          {items.length} faixas ouvidas
        </p>
      </div>

      {/* Grid — 5 columns square art */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 64px 80px', display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 16 }}>
        {isLoading
          ? Array.from({ length: 10 }).map((_, i) => (
              <div key={i} style={{ aspectRatio: '1/1', background: 'var(--card)', borderRadius: 12 }} />
            ))
          : items.map(item => (
              <div
                key={item.id}
                onClick={() => navigate(`/media/${item.id}`)}
                className="media-pop group"
                style={{ cursor: 'pointer' }}
              >
                {/* Album art */}
                <div style={{
                  aspectRatio: '1/1', background: 'var(--card)', borderRadius: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 48, marginBottom: 12, overflow: 'hidden', position: 'relative',
                  border: '1px solid var(--border)',
                }}>
                  {item.cover_url
                    ? <img src={item.cover_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : '🎵'
                  }
                </div>
                <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3, lineHeight: 1.2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.title}
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0 }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.author ?? '—'}
                  </span>
                  {item.rating > 0 && (
                    <span style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 11, color: 'var(--music)', flexShrink: 0 }}>★ {item.rating}</span>
                  )}
                </div>
              </div>
            ))
        }
      </div>

      {items.length === 0 && !isLoading && (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, color: 'var(--border-strong)', marginBottom: 12 }}>Vazio</p>
          <p style={{ color: 'var(--text-muted)' }}>Nenhuma faixa ouvida ainda</p>
          <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
            Conecte o Plex ou o Last.fm nos ajustes para registrar automaticamente o que você ouve.
          </p>
        </div>
      )}
    </div>
  )
}
