import { useQuery } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { MediaItem } from '../types'

const TYPE_EMOJI: Record<string, string> = {
  game:   '🎮',
  book:   '📚',
  movie:  '🎬',
  series: '📺',
}

const CAT_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  game:   { bg: 'rgba(45,255,138,.08)',  color: '#2DFF8A', label: 'Jogo'   },
  book:   { bg: 'rgba(196,122,58,.08)',  color: '#C47A3A', label: 'Livro'  },
  movie:  { bg: 'rgba(230,53,96,.08)',   color: '#E63560', label: 'Filme'  },
  series: { bg: 'rgba(230,53,96,.08)',   color: '#E63560', label: 'Série'  },
}

function formatDiaryDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric',
  })
}

export function Diary() {
  const navigate = useNavigate()

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['diary'],
    queryFn: () => api.media.list({ status: 'completed', limit: 500 }),
  })

  const sorted = [...items].sort((a, b) => {
    const da = a.completed_at ?? a.updated_at
    const db = b.completed_at ?? b.updated_at
    return new Date(db).getTime() - new Date(da).getTime()
  })

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ padding: '80px 64px 48px', maxWidth: 800, margin: '0 auto' }}>
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: 'var(--dim)', marginBottom: 16 }}>
          Histórico
        </p>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 'clamp(40px,5vw,64px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--text-primary)' }}>
          Diário
        </h1>
        <p style={{ marginTop: 16, fontSize: 15, color: 'var(--text-muted)' }}>
          {isLoading ? '…' : `${sorted.length} itens concluídos`}
        </p>
      </div>

      <div style={{ maxWidth: 800, margin: '0 auto', padding: '0 64px 80px' }}>
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ height: 72, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 112, height: 14, background: 'var(--card)', borderRadius: 4 }} />
              <div style={{ width: 36, height: 36, background: 'var(--card)', borderRadius: '50%' }} />
              <div style={{ flex: 1, height: 14, background: 'var(--card)', borderRadius: 4, maxWidth: 240 }} />
            </div>
          ))
        ) : sorted.length > 0 ? (
          sorted.map(item => {
            const dateStr = item.completed_at ?? item.updated_at
            const cat = CAT_STYLE[item.type] ?? { bg: 'rgba(106,106,136,.1)', color: 'var(--text-muted)', label: item.type }
            return (
              <div
                key={item.id}
                onClick={() => navigate(`/media/${item.id}`)}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '112px 36px 1fr auto',
                  alignItems: 'center', gap: 16,
                  padding: '20px 0',
                  borderBottom: '1px solid var(--border)',
                  cursor: 'pointer',
                  transition: 'opacity .2s',
                }}
                onMouseEnter={e => ((e.currentTarget as HTMLDivElement).style.opacity = '0.75')}
                onMouseLeave={e => ((e.currentTarget as HTMLDivElement).style.opacity = '1')}
              >
                <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                  {formatDiaryDate(dateStr)}
                </span>
                <span style={{ fontSize: 22, textAlign: 'center' }}>
                  {TYPE_EMOJI[item.type] ?? '📌'}
                </span>
                <div>
                  <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                    {item.title}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                    {item.year ?? '—'}{item.genre ? ` · ${item.genre}` : ''}
                    {item.rating > 0 ? ` · ★ ${item.rating}` : ''}
                  </p>
                </div>
                <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.5px', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 4, background: cat.bg, color: cat.color, whiteSpace: 'nowrap' }}>
                  {cat.label}
                </span>
              </div>
            )
          })
        ) : (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <p style={{ fontFamily: 'Syne, sans-serif', fontSize: '3rem', fontWeight: 800, color: 'var(--border)', marginBottom: 12 }}>Vazio</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Nenhum item concluído ainda</p>
          </div>
        )}
      </div>
    </div>
  )
}
