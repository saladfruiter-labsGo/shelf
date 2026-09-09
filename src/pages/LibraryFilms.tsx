import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { LibrarySearch } from '../components/LibrarySearch'
import { Pager, usePagination } from '../components/Pager'
import { useMediaPreview } from '../components/MediaSummaryModal'
import { norm } from '../lib/utils'

export function LibraryFilms() {
  const navigate = useNavigate()
  const { openMedia } = useMediaPreview()
  const [search, setSearch] = useState('')

  const { data: rawItems = [], isLoading } = useQuery({
    queryKey: ['media', 'movie'],
    queryFn: () => api.media.listAll({ type: 'movie', library: true }),
  })

  // Itens em wishlist ficam só na Wishlist — excluídos no servidor (`library`),
  // senão um backlog grande ocuparia sozinho o limite de linhas.
  const items = rawItems

  const watched = items.filter(i => i.status === 'completed').length

  // Busca por nome (instantânea).
  const q = norm(search)
  const visible = q ? items.filter(i => norm(i.title).includes(q)) : items

  const { page, totalPages, pageItems, goTo, anchor } = usePagination(visible, [items.length, search])

  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text-primary)', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '64px var(--page-x) 48px', maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <button
            onClick={() => navigate('/library')}
            className="link-accent"
            style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, letterSpacing: '0.5px' }}
          >
            ← Biblioteca
          </button>
          <p style={{ fontSize: 11, letterSpacing: '3px', textTransform: 'uppercase', color: 'var(--movies)', marginBottom: 16, fontWeight: 600 }}>
            Filmes
          </p>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1 }}>
            Meus filmes
          </h1>
        </div>
        <p style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 13, color: 'var(--text-muted)', paddingBottom: 8 }}>
          {items.length} filmes · {watched} assistidos
        </p>
      </div>

      {/* Busca por nome (filtra instantaneamente) */}
      <LibrarySearch
        value={search}
        onChange={setSearch}
        ariaLabel="Buscar filme por nome"
        count={visible.length}
        showCount={Boolean(q)}
      />

      <div ref={anchor} style={{ scrollMarginTop: 24 }} />

      {/* Grid — 5 columns poster style */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 var(--page-x)', display: 'grid', gridTemplateColumns: 'var(--grid-films)', gap: 16 }}>
        {isLoading
          ? Array.from({ length: 10 }).map((_, i) => (
              <div key={i} style={{ aspectRatio: '2/3', background: 'var(--card)', borderRadius: 12 }} />
            ))
          : pageItems.map(item => (
              <div
                key={item.id}
                onClick={() => openMedia(item)}
                onKeyDown={event => {
                  if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMedia(item) }
                }}
                role="button"
                tabIndex={0}
                aria-label={`Abrir resumo de ${item.title}`}
                className="media-pop media-preview-card group"
                style={{ cursor: 'pointer' }}
              >
                {/* Poster */}
                <div style={{
                  aspectRatio: '2/3', background: 'var(--card)', borderRadius: 12,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontSize: 56, marginBottom: 12, overflow: 'hidden', position: 'relative',
                  border: '1px solid var(--border)',
                }}>
                  {item.cover_url
                    ? <img src={item.cover_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : '🎬'
                  }
                  {/* Hover overlay */}
                  <div style={{
                    position: 'absolute', inset: 0,
                    background: 'linear-gradient(to top,rgba(0,0,0,.9) 0%,transparent 55%)',
                    display: 'flex', alignItems: 'flex-end', padding: 12,
                    opacity: 0, transition: 'opacity .2s',
                  }}
                    className="film-overlay"
                  >
                    {item.status === 'completed' && (
                      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', padding: '3px 8px', borderRadius: 4, background: 'var(--movies-bg)', color: 'var(--movies)' }}>
                        Assistido
                      </span>
                    )}
                  </div>
                </div>
                <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3, lineHeight: 1.2 }}>
                  {item.title}
                </p>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.year ?? '—'}</span>
                  {item.rating > 0 && (
                    <span style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 11, color: 'var(--movies)' }}>★ {item.rating}</span>
                  )}
                </div>
              </div>
            ))
        }
      </div>

      {/* O `80px` de baixo saiu da grade e veio para cá: com uma página só o
          Pager some e o espaçamento fica igual ao de antes. */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 var(--page-x) 80px' }}>
        <Pager page={page} total={totalPages} count={visible.length} onGo={goTo} label="Paginação dos filmes" />
      </div>

      {visible.length === 0 && !isLoading && (
        <div style={{ textAlign: 'center', padding: '80px 0' }}>
          <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, color: 'var(--border-strong)', marginBottom: 12 }}>Vazio</p>
          <p style={{ color: 'var(--text-muted)' }}>{items.length === 0 ? 'Nenhum filme na biblioteca ainda' : 'Nenhum filme encontrado'}</p>
        </div>
      )}

      <style>{`.group:hover .film-overlay { opacity: 1; }`}</style>
    </div>
  )
}
