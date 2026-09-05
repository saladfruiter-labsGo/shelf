import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { MediaCard } from '../components/MediaCard'
import type { MediaItem, MediaType } from '../types'

const CATEGORIES = [
  { key: 'game',   label: 'Jogos',   emoji: '🎮', path: '/library/games',  color: '#2DFF8A' },
  { key: 'book',   label: 'Livros',  emoji: '📚', path: '/library/books',  color: '#C47A3A' },
  { key: 'movie',  label: 'Filmes',  emoji: '🎬', path: '/library/films',  color: '#E63560' },
  { key: 'series', label: 'Séries',  emoji: '📺', path: '/library/series', color: '#E63560' },
  { key: 'music',  label: 'Músicas', emoji: '🎵', path: '/library/music',  color: '#8B5CF6' },
] as const

export function Dashboard() {
  const navigate = useNavigate()
  const currentYear = new Date().getFullYear()

  const { data: allItems = [] } = useQuery({
    queryKey: ['media-all'],
    queryFn: () => api.media.list({ limit: 1000 }),
  })

  const { data: recent } = useQuery({
    queryKey: ['recent'],
    queryFn: api.media.recent,
  })

  const yearItems = allItems.filter(item => {
    const y = new Date(item.added_at).getFullYear()
    return y === currentYear
  })

  const total   = yearItems.length
  const done    = yearItems.filter(i => i.status === 'completed').length
  const inProg  = yearItems.filter(i => i.status === 'in_progress').length

  const countByType = (type: string) =>
    allItems.filter(i => i.type === type).length

  const recentItems: MediaItem[] = (() => {
    if (!recent) return []
    const types: MediaType[] = ['movie', 'series', 'game', 'book']
    return types.flatMap(t => recent[t] ?? []).slice(0, 4)
  })()

  return (
    <div style={{ background: 'var(--bg)', position: 'relative', overflow: 'hidden', minHeight: '100vh' }}>
      {/* Glow decorations */}
      <div style={{
        position: 'absolute', width: 600, height: 600, borderRadius: '50%',
        background: 'radial-gradient(circle,rgba(170,255,46,.06) 0%,transparent 70%)',
        top: -100, right: -100, pointerEvents: 'none',
      }} />
      <div style={{
        position: 'absolute', width: 400, height: 400, borderRadius: '50%',
        background: 'radial-gradient(circle,rgba(123,63,255,.07) 0%,transparent 70%)',
        bottom: 200, left: -50, pointerEvents: 'none',
      }} />

      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 64px 64px', position: 'relative' }}>
        {/* Eyebrow */}
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: 'var(--dim)', marginBottom: 24 }}>
          Coleção pessoal
        </p>

        {/* Headline */}
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 'clamp(48px,6vw,88px)', fontWeight: 800, lineHeight: 1.02, letterSpacing: '-2.5px', color: 'var(--text-primary)', marginBottom: 48 }}>
          Tudo que você{' '}
          <em style={{ fontStyle: 'normal', color: 'var(--accent)' }}>assistiu, leu,<br />jogou e ouviu.</em>
        </h1>

        {/* Year pill */}
        <div style={{
          display: 'inline-flex', alignItems: 'center',
          background: 'var(--surface)', border: '1px solid var(--border-strong)',
          borderRadius: 9999, padding: '16px 0 16px 32px',
          marginBottom: 80, overflow: 'hidden',
        }}>
          <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 10, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '2px', marginRight: 24 }}>
            {currentYear}
          </span>
          {[
            { num: total,  lbl: 'Total' },
            { num: done,   lbl: 'Concluídos' },
            { num: inProg, lbl: 'Em andamento' },
          ].map(s => (
            <div key={s.lbl} style={{ display: 'flex', flexDirection: 'column', gap: 2, borderLeft: '1px solid var(--border)', padding: '0 32px' }}>
              <span style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {s.num}
              </span>
              <span style={{ fontSize: 10, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>
                {s.lbl}
              </span>
            </div>
          ))}
        </div>

        {/* Recent activity */}
        {recentItems.length > 0 && (
          <section style={{ marginBottom: 64 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
              <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: 'var(--text-muted)' }}>
                Recentes
              </p>
              <button
                onClick={() => navigate('/library')}
                style={{ fontSize: 13, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', transition: 'color .2s' }}
                onMouseEnter={e => (e.currentTarget.style.color = 'var(--accent)')}
                onMouseLeave={e => (e.currentTarget.style.color = 'var(--text-muted)')}
              >
                Ver tudo →
              </button>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 16 }}>
              {recentItems.map(item => (
                <div key={item.id} style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 24, cursor: 'pointer', transition: 'border-color .2s, background .2s' }}
                  onMouseEnter={e => {
                    ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-strong)'
                    ;(e.currentTarget as HTMLDivElement).style.background = 'var(--card)'
                  }}
                  onMouseLeave={e => {
                    ;(e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border)'
                    ;(e.currentTarget as HTMLDivElement).style.background = 'var(--surface)'
                  }}
                  onClick={() => navigate(`/media/${item.id}`)}
                >
                  <span style={{ fontSize: 32, display: 'block', marginBottom: 16 }}>
                    {item.type === 'game' ? '🎮' : item.type === 'book' ? '📚' : item.type === 'movie' ? '🎬' : '📺'}
                  </span>
                  <p style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--dim)', marginBottom: 8 }}>
                    {item.type === 'game' ? 'Jogo' : item.type === 'book' ? 'Livro' : item.type === 'movie' ? 'Filme' : 'Série'}
                  </p>
                  <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8, lineHeight: 1.3 }}>
                    {item.title}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    {item.year ?? '—'} · {item.genre ?? '—'}
                  </p>
                </div>
              ))}
            </div>
          </section>
        )}

        {/* Category strip */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: 'var(--text-muted)' }}>
              Categorias
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 16 }}>
            {CATEGORIES.map(cat => (
              <button
                key={cat.key}
                onClick={() => navigate(cat.path)}
                style={{
                  background: 'var(--surface)', border: '1px solid var(--border)',
                  borderRadius: 16, padding: '32px 16px',
                  cursor: 'pointer', transition: 'all .28s',
                  textAlign: 'center', display: 'block', width: '100%',
                }}
                onMouseEnter={e => {
                  const el = e.currentTarget
                  el.style.borderColor = 'var(--accent)'
                  el.style.background = 'var(--card)'
                  el.style.transform = 'translateY(-4px)'
                }}
                onMouseLeave={e => {
                  const el = e.currentTarget
                  el.style.borderColor = 'var(--border)'
                  el.style.background = 'var(--surface)'
                  el.style.transform = 'translateY(0)'
                }}
              >
                <span style={{ fontSize: 40, display: 'block', marginBottom: 16 }}>{cat.emoji}</span>
                <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{cat.label}</p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {cat.key === 'music' ? '—' : countByType(cat.key)} itens
                </p>
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  )
}
