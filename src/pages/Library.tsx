import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { MediaCard } from '../components/MediaCard'
import { norm } from '../lib/utils'
import type { MediaType } from '../types'

const CATS = [
  { key: 'game'  as MediaType, label: 'Jogos',   emoji: '🎮', path: '/library/games'  },
  { key: 'book'  as MediaType, label: 'Livros',  emoji: '📚', path: '/library/books'  },
  { key: 'movie' as MediaType, label: 'Filmes',  emoji: '🎬', path: '/library/films'  },
  { key: 'series' as MediaType, label: 'Séries', emoji: '📺', path: '/library/series' },
  { key: 'music' as MediaType,  label: 'Músicas', emoji: '🎵', path: '/library/music'  },
]

export function Library() {
  const navigate = useNavigate()
  const [search, setSearch] = useState('')

  const { data: rawItems = [], isLoading } = useQuery({
    queryKey: ['media-all'],
    queryFn: () => api.media.list({ limit: 500 }),
  })

  // Música não é um item por faixa na coleção: a biblioteca de músicas é o
  // histórico de execuções (scrobbles), então o card conta execuções — igual à
  // página de músicas — em vez de media_items (que ficaria sempre em 0).
  const { data: musicEvents = [] } = useQuery({
    queryKey: ['integrations', 'activity', 'music'],
    queryFn: () => api.integrations.activity({ limit: 500, media_type: 'music' }),
  })
  const musicPlays = musicEvents.filter(e => e.event_type === 'scrobble' || e.event_type === 'listen').length

  // A wishlist é separada da coleção: itens ainda não adquiridos/consumidos
  // vivem só na Wishlist e não contam para a biblioteca.
  const allItems = rawItems.filter(i => i.status !== 'wishlist')

  const countByType = (key: MediaType) =>
    key === 'music' ? musicPlays : allItems.filter(i => i.type === key).length

  // Busca por nome sobre "Todos os itens" (instantânea).
  const q = norm(search)
  const visible = q ? allItems.filter(i => norm(i.title).includes(q)) : allItems

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '64px var(--page-x) 80px' }}>

        {/* Header */}
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: 'var(--dim)', marginBottom: 16 }}>
          Coleção pessoal
        </p>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--text-primary)', marginBottom: 16 }}>
          A sua biblioteca
        </h1>
        <p style={{ fontSize: 16, color: 'var(--text-muted)', marginBottom: 64 }}>
          {allItems.length} itens na coleção
        </p>

        {/* Category hub cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'var(--grid-cats)', gap: 16, marginBottom: 80 }}>
          {CATS.map(cat => (
            <button
              key={cat.label}
              onClick={() => navigate(cat.path)}
              className="hover-lift"
              style={{
                background: 'var(--surface)', border: '1px solid var(--border)',
                borderRadius: 16, padding: '32px 16px',
                cursor: 'pointer',
                textAlign: 'center', display: 'block', width: '100%',
              }}
            >
              <span style={{ fontSize: 40, display: 'block', marginBottom: 16 }}>{cat.emoji}</span>
              <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>{cat.label}</p>
              <p style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                {countByType(cat.key)} {cat.key === 'music'
                  ? (countByType(cat.key) === 1 ? 'execução' : 'execuções')
                  : 'itens'}
              </p>
            </button>
          ))}
        </div>

        {/* All items */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 24 }}>
            <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: 'var(--text-muted)' }}>
              Todos os itens
            </p>
            <span style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 12, color: 'var(--dim)' }}>
              {q ? `${visible.length}/${allItems.length}` : allItems.length}
            </span>
          </div>

          {/* Busca por nome (filtra instantaneamente) */}
          <div style={{ position: 'relative', maxWidth: 420, marginBottom: 24 }}>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Buscar por nome…"
              aria-label="Buscar item por nome"
              style={{
                width: '100%', boxSizing: 'border-box', padding: '10px 34px 10px 14px', borderRadius: 10,
                border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text-primary)', fontSize: 14, outline: 'none',
              }}
            />
            {search && (
              <button onClick={() => setSearch('')} title="Limpar" aria-label="Limpar busca"
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>
                ×
              </button>
            )}
          </div>

          {isLoading ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'var(--grid-lib)', gap: '16px 16px' }}>
              {Array.from({ length: 14 }).map((_, i) => (
                <div key={i}>
                  <div style={{ width: '100%', aspectRatio: '2/3', background: 'var(--card)', borderRadius: 6, marginBottom: 8 }} className="animate-pulse" />
                  <div style={{ height: 12, background: 'var(--card)', borderRadius: 4, width: '80%' }} className="animate-pulse" />
                </div>
              ))}
            </div>
          ) : visible.length > 0 ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'var(--grid-lib)', gap: '16px 16px' }}>
              {visible.map(item => (
                <MediaCard key={item.id} item={item} compact />
              ))}
            </div>
          ) : (
            <div style={{ textAlign: 'center', padding: '80px 0' }}>
              <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--border)', marginBottom: 12 }}>Vazio</p>
              <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
                {allItems.length === 0 ? 'Pressione ⌘K para adicionar algo' : 'Nenhum item encontrado'}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
