import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { formatPlaytime, formatDate, GAME_STATUS_LABEL, GAME_STATUS_STYLE, gameStatusOf } from '../lib/utils'
import type { GameStatus } from '../types'

// Estados que aparecem na biblioteca (nunca_jogado = wishlist, fica de fora).
const HEADER_STATES: GameStatus[] = ['jogando', 'zerado', 'platinado', 'abandonado']

// normaliza para busca insensível a acento/caixa
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()

export function LibraryGames() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<GameStatus | null>(null)
  const [search, setSearch] = useState('')

  const { data: rawItems = [], isLoading } = useQuery({
    queryKey: ['media', 'game'],
    queryFn: () => api.media.list({ type: 'game', limit: 500 }),
  })

  // Itens em wishlist (nunca jogado) ficam só na Wishlist, fora da biblioteca.
  // Ordena da última vez jogada mais recente para a mais antiga (sem data vai pro fim).
  const items = rawItems
    .filter(i => i.status !== 'wishlist')
    .sort((a, b) => (b.last_played_at ? Date.parse(b.last_played_at) : 0) - (a.last_played_at ? Date.parse(a.last_played_at) : 0))

  const countByStatus = (s: GameStatus) => items.filter(i => gameStatusOf(i) === s).length

  // Grid filtrado por status (contador clicado) + busca por nome (instantânea).
  const q = norm(search)
  const visible = items.filter(i => {
    if (statusFilter && gameStatusOf(i) !== statusFilter) return false
    if (q && !norm(i.title).includes(q)) return false
    return true
  })

  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text-primary)', minHeight: '100vh' }}>
      {/* Header */}
      <div className="lib-header" style={{ padding: '64px var(--page-x) 48px', maxWidth: 1280, margin: '0 auto' }}>
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
        <div className="lib-stats">
          {[
            { key: null as GameStatus | null, n: items.length, l: 'Total', color: 'var(--text-primary)' },
            ...HEADER_STATES.map(s => ({ key: s as GameStatus | null, n: countByStatus(s), l: GAME_STATUS_LABEL[s], color: GAME_STATUS_STYLE[s].color })),
          ].map(s => {
            const active = statusFilter === s.key
            return (
              <button
                key={s.l}
                onClick={() => setStatusFilter(prev => (s.key && prev === s.key ? null : s.key))}
                title={s.key ? `Filtrar por ${s.l}` : 'Mostrar todos'}
                style={{
                  textAlign: 'right', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 4px',
                  borderBottom: `2px solid ${active ? s.color : 'transparent'}`, opacity: active ? 1 : 0.55,
                  transition: 'opacity .15s',
                }}
              >
                <p className="lib-stat-n" style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 800, color: s.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.n}</p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>{s.l}</p>
              </button>
            )
          })}
        </div>
      </div>

      {/* Busca por nome (filtra instantaneamente) */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 var(--page-x) 24px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar por nome…"
            aria-label="Buscar jogo por nome"
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
        {(statusFilter || q) && (
          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
            {visible.length} resultado{visible.length === 1 ? '' : 's'}{statusFilter ? ` · ${GAME_STATUS_LABEL[statusFilter]}` : ''}
          </span>
        )}
      </div>

      {/* Grid */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 var(--page-x) 80px', display: 'grid', gridTemplateColumns: 'var(--grid-games)', gap: 16 }}>
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ background: 'var(--card)', borderRadius: 16, overflow: 'hidden', border: '1px solid var(--border)', aspectRatio: '2/3.55' }} />
            ))
          : visible.map(item => (
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
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, flexWrap: 'wrap', marginTop: 10 }}>
                    {(item.playtime_seconds ?? 0) > 0
                      ? <span style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 13, color: 'var(--games)' }}>⏱ {formatPlaytime(item.playtime_seconds!)}</span>
                      : item.runtime
                        ? <span style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 13, color: 'var(--games)' }}>{item.runtime}h</span>
                        : <span />
                    }
                    {(() => {
                      const gs = gameStatusOf(item)
                      const st = GAME_STATUS_STYLE[gs]
                      return (
                        <span style={{
                          fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.5px',
                          padding: '3px 8px', borderRadius: 4,
                          background: st.bg, color: st.color,
                        }}>
                          {GAME_STATUS_LABEL[gs]}
                        </span>
                      )
                    })()}
                  </div>
                  {item.last_played_at && (
                    <p style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                      Jogado em {formatDate(item.last_played_at)}
                    </p>
                  )}
                </div>
              </div>
            ))
        }
      </div>

      {visible.length === 0 && !isLoading && (
        <div style={{ textAlign: 'center', padding: '80px 0', color: 'var(--text-muted)' }}>
          <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, color: 'var(--border-strong)', marginBottom: 12 }}>Vazio</p>
          <p>{items.length === 0 ? 'Nenhum jogo na biblioteca ainda' : 'Nenhum jogo encontrado'}</p>
        </div>
      )}
    </div>
  )
}
