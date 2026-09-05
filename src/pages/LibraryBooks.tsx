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

  const read    = items.filter(i => i.status === 'completed').length
  const reading = items.filter(i => i.status === 'in_progress').length

  return (
    <div style={{ background: '#F5F0E8', color: '#1A1409', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '64px 64px 48px', maxWidth: 1200, margin: '0 auto', borderBottom: '1px solid rgba(26,20,9,.1)', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <button
            onClick={() => navigate('/library')}
            style={{ fontSize: 12, color: '#7A6B55', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, letterSpacing: '0.5px' }}
          >
            ← Biblioteca
          </button>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '3px', textTransform: 'uppercase', color: '#B52A1A', marginBottom: 16 }}>
            Livros
          </p>
          <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: '#1A1409' }}>
            Minhas leituras
          </h1>
        </div>
        <p style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#7A6B55', paddingBottom: 8 }}>
          {items.length} livros · {read} lidos
        </p>
      </div>

      {/* List */}
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 64px 80px' }}>
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ height: 72, background: 'rgba(26,20,9,.04)', borderRadius: 8, margin: '4px -16px', marginBottom: 0, borderBottom: '1px solid rgba(26,20,9,.08)' }} />
            ))
          : items.map((item, idx) => (
              <div
                key={item.id}
                onClick={() => navigate(`/media/${item.id}`)}
                style={{
                  display: 'grid', gridTemplateColumns: '40px 1fr auto auto',
                  alignItems: 'center', gap: 24, padding: '24px 16px',
                  borderBottom: '1px solid rgba(26,20,9,.08)',
                  cursor: 'pointer', borderRadius: 8, margin: '0 -16px',
                  transition: 'background .2s',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.background = '#EDE7D9')}
                onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.background = 'transparent')}
              >
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, color: '#7A6B55', fontVariantNumeric: 'tabular-nums', textAlign: 'center' }}>
                  {String(idx + 1).padStart(2, '0')}
                </span>
                <div>
                  <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 18, fontWeight: 700, color: '#1A1409', marginBottom: 4 }}>{item.title}</p>
                  <p style={{ fontSize: 13, color: '#7A6B55' }}>{item.author ?? item.creators ?? '—'}</p>
                </div>
                {item.genre && (
                  <span style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1px', color: '#B52A1A', padding: '4px 10px', background: 'rgba(181,42,26,.08)', borderRadius: 4, whiteSpace: 'nowrap' }}>
                    {item.genre}
                  </span>
                )}
                <span style={{
                  fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px',
                  padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap',
                  background: item.status === 'completed' ? 'rgba(45,122,45,.1)' : 'rgba(181,42,26,.1)',
                  color: item.status === 'completed' ? '#2A6B2A' : '#B52A1A',
                }}>
                  {STATUS_LABEL[item.status] ?? item.status}
                </span>
              </div>
            ))
        }

        {items.length === 0 && !isLoading && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <p style={{ fontFamily: 'Syne, sans-serif', fontSize: '3rem', fontWeight: 800, color: 'rgba(26,20,9,.1)', marginBottom: 12 }}>Vazio</p>
            <p style={{ color: '#7A6B55' }}>Nenhum livro na biblioteca ainda</p>
          </div>
        )}
      </div>
    </div>
  )
}
