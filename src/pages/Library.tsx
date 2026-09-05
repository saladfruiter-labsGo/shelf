import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { MediaCard } from '../components/MediaCard'
import type { MediaType } from '../types'

const CATS = [
  { key: 'game'  as MediaType, label: 'Jogos',   emoji: '🎮', path: '/library/games'  },
  { key: 'book'  as MediaType, label: 'Livros',  emoji: '📚', path: '/library/books'  },
  { key: 'movie' as MediaType, label: 'Filmes',  emoji: '🎬', path: '/library/films'  },
  { key: 'series' as MediaType, label: 'Séries', emoji: '📺', path: '/library/series' },
  { key: null,                  label: 'Músicas', emoji: '🎵', path: '/library/music'  },
]

export function Library() {
  const navigate = useNavigate()

  const { data: allItems = [], isLoading } = useQuery({
    queryKey: ['media-all'],
    queryFn: () => api.media.list({ limit: 500 }),
  })

  const countByType = (key: MediaType | null) =>
    key ? allItems.filter(i => i.type === key).length : 0

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1200, margin: '0 auto', padding: '80px 64px' }}>

        {/* Header */}
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: 'var(--dim)', marginBottom: 16 }}>
          Coleção pessoal
        </p>
        <h1 style={{ fontFamily: 'Syne, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--text-primary)', marginBottom: 16 }}>
          A sua biblioteca
        </h1>
        <p style={{ fontSize: 16, color: 'var(--text-muted)', marginBottom: 64 }}>
          {allItems.length} itens na coleção
        </p>

        {/* Category hub cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5,1fr)', gap: 16, marginBottom: 80 }}>
          {CATS.map(cat => (
            <button
              key={cat.label}
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
                {cat.key === null ? '—' : countByType(cat.key)} itens
              </p>
            </button>
          ))}
        </div>

        {/* All items */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: 'var(--text-muted)' }}>
              Todos os itens
            </p>
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 12, color: 'var(--dim)' }}>
              {allItems.length}
            </span>
          </div>

          {isLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '16px 16px' }}>
              {Array.from({ length: 14 }).map((_, i) => (
                <div key={i}>
                  <div style={{ width: '100%', aspectRatio: '2/3', background: 'var(--card)', borderRadius: 6, marginBottom: 8 }} className="animate-pulse" />
                  <div style={{ height: 12, background: 'var(--card)', borderRadius: 4, width: '80%' }} className="animate-pulse" />
                </div>
              ))}
            </div>
          ) : allItems.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: '16px 16px' }}>
              {allItems.map(item => (
                <MediaCard key={item.id} item={item} compact />
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <p style={{ fontFamily: 'Syne, sans-serif', fontSize: '3rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--border)', marginBottom: 12 }}>Vazio</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Pressione ⌘K para adicionar algo</p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
