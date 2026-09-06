import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

const STATUS_LABEL: Record<string, string> = {
  completed:   'Lido',
  in_progress: 'Lendo',
  wishlist:    'Wishlist',
  dropped:     'Abandonado',
}

export function LibraryBooks() {
  const navigate = useNavigate()

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['media', 'book'],
    queryFn: () => api.media.list({ type: 'book', limit: 500 }),
  })

  const read = items.filter(i => i.status === 'completed').length

  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text-primary)', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '64px 64px 48px', maxWidth: 1200, margin: '0 auto', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <button
            onClick={() => navigate('/library')}
            className="link-accent"
            style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, letterSpacing: '0.5px' }}
          >
            ← Biblioteca
          </button>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '3px', textTransform: 'uppercase', color: 'var(--books)', marginBottom: 16 }}>
            Livros
          </p>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--text-primary)' }}>
            Minhas leituras
          </h1>
        </div>
        <p style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 13, color: 'var(--text-muted)', paddingBottom: 8 }}>
          {items.length} livros · {read} lidos
        </p>
      </div>

      {/* List */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 64px 80px' }}>
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ height: 72, background: 'var(--card)', borderRadius: 8, margin: '4px -16px', marginBottom: 0, borderBottom: '1px solid var(--border)' }} />
            ))
          : items.map((item, idx) => (
              <div
                key={item.id}
                onClick={() => navigate(`/media/${item.id}`)}
                className="row-hover"
                style={{
                  display: 'grid', gridTemplateColumns: '40px 1fr auto auto',
                  alignItems: 'center', gap: 24, padding: '24px 16px',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer', borderRadius: 8, margin: '0 -16px',
                }}
              >
                <span style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 13, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <div>
                  <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>{item.title}</p>
                  <p style={{ fontSize: 13, color: 'var(--text-muted)' }}>{item.author ?? item.creators ?? '—'}</p>
                </div>
                {item.genre && (
                  <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--books)', padding: '4px 10px', background: 'var(--books-bg)', borderRadius: 4, whiteSpace: 'nowrap' }}>
                    {item.genre}
                  </span>
                )}
                <span style={{
                  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px',
                  padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap',
                  background: item.status === 'completed' ? 'var(--accent-bg)' : 'var(--books-bg)',
                  color: item.status === 'completed' ? 'var(--accent)' : 'var(--books)',
                }}>
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
              </div>
            ))
        }

        {items.length === 0 && !isLoading && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, color: 'var(--border-strong)', marginBottom: 12 }}>Vazio</p>
            <p style={{ color: 'var(--text-muted)' }}>Nenhum livro na biblioteca ainda</p>
          </div>
        )}
      </div>
    </div>
  )
}
