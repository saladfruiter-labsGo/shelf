import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { StarRating } from '../components/StarRating'
import { LibraryStats } from '../components/LibraryStats'
import { LibrarySearch } from '../components/LibrarySearch'
import { Pager, usePagination } from '../components/Pager'
import { norm } from '../lib/utils'

const STATUS_LABEL: Record<string, string> = {
  completed:   'Lido',
  in_progress: 'Lendo',
  wishlist:    'Backlog',
  dropped:     'Abandonado',
}

// Estados com contador próprio no cabeçalho (como na biblioteca de jogos).
type ShelfFilter = 'in_progress' | 'completed'
const HEADER_STATES: { key: ShelfFilter; label: string; color: string }[] = [
  { key: 'in_progress', label: 'Em andamento', color: 'var(--books)' },
  { key: 'completed',   label: 'Lidos',        color: 'var(--accent)' },
]

export function LibraryBooks() {
  const navigate = useNavigate()
  const [statusFilter, setStatusFilter] = useState<ShelfFilter | null>(null)
  const [search, setSearch] = useState('')

  const { data: rawItems = [], isLoading } = useQuery({
    queryKey: ['media', 'book'],
    queryFn: () => api.media.listAll({ type: 'book', library: true }),
  })

  // Itens em wishlist ficam só na Wishlist, fora da biblioteca.
  const items = rawItems

  const countByStatus = (st: ShelfFilter) => items.filter(i => i.status === st).length

  // Lista filtrada pelo contador clicado + busca por nome (instantânea).
  const q = norm(search)
  const visible = items.filter(i => {
    if (statusFilter && i.status !== statusFilter) return false
    if (q && !norm(i.title).includes(q)) return false
    return true
  })

  const { page, totalPages, pageItems, goTo, anchor } = usePagination(visible, [items.length, search, statusFilter])

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
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '3px', textTransform: 'uppercase', color: 'var(--books)', marginBottom: 16 }}>
            Livros
          </p>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--text-primary)' }}>
            Minhas leituras
          </h1>
        </div>
        <LibraryStats
          stats={[
            { key: null, n: items.length, label: 'Total', color: 'var(--text-primary)' },
            ...HEADER_STATES.map(st => ({ key: st.key, n: countByStatus(st.key), label: st.label, color: st.color })),
          ]}
          active={statusFilter}
          onChange={setStatusFilter}
        />
      </div>

      {/* Busca por nome (filtra instantaneamente) */}
      <LibrarySearch
        value={search}
        onChange={setSearch}
        ariaLabel="Buscar livro por nome"
        count={visible.length}
        showCount={Boolean(statusFilter || q)}
        countSuffix={statusFilter ? ` · ${HEADER_STATES.find(h => h.key === statusFilter)!.label}` : undefined}
      />

      <div ref={anchor} style={{ scrollMarginTop: 24 }} />

      {/* List */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 var(--page-x) 80px' }}>
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} style={{ height: 72, background: 'var(--card)', borderRadius: 8, margin: '4px -16px', marginBottom: 0, borderBottom: '1px solid var(--border)' }} />
            ))
          : pageItems.map((item, idx) => (
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
                  <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: (item.status === 'in_progress' || item.status === 'completed') ? 8 : 0 }}>
                    {item.author ?? item.creators ?? '—'}
                  </p>
                  {/* Progresso de páginas lidas (Kavita); concluído sempre mostra 100% */}
                  {(item.status === 'in_progress' || item.status === 'completed') && (() => {
                    const pct = Math.round((item.progress ?? (item.status === 'completed' ? 1 : 0)) * 100)
                    return (
                      <div>
                        <div style={{ maxWidth: 220, height: 3, background: 'var(--border)', borderRadius: 2, marginBottom: 6, overflow: 'hidden' }}>
                          <div style={{
                            height: '100%', borderRadius: 2, background: 'var(--books)',
                            width: `${pct}%`, transition: 'width .5s ease',
                          }} />
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
                          <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                            {pct}% lido{item.pages_total ? ` · ${item.pages_read ?? 0}/${item.pages_total} páginas` : ''}
                          </span>
                          {item.rating > 0 && <StarRating value={item.rating} readonly size="sm" />}
                        </div>
                      </div>
                    )
                  })()}
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

        <Pager page={page} total={totalPages} count={visible.length} onGo={goTo} label="Paginação dos livros" />

        {visible.length === 0 && !isLoading && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, color: 'var(--border-strong)', marginBottom: 12 }}>Vazio</p>
            <p style={{ color: 'var(--text-muted)' }}>{items.length === 0 ? 'Nenhum livro na biblioteca ainda' : 'Nenhum livro encontrado'}</p>
          </div>
        )}
      </div>
    </div>
  )
}
