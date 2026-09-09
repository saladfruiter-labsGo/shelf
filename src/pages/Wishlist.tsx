import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { DiaryEntryModal, type DiaryEntryValues } from '../components/DiaryEntryModal'
import { CategoryTag } from '../components/CategoryTag'
import { PriceBadge } from '../components/PriceBadge'
import { TYPE_LABEL, formatDate } from '../lib/utils'
import type { MediaItem, MediaType } from '../types'

/* ─── Ordenações disponíveis ─── */
type SortKey = 'added_desc' | 'added_asc' | 'release_desc' | 'release_asc' | 'price_asc' | 'discount_desc'
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'added_desc',    label: 'Adicionado — recente' },
  { value: 'added_asc',     label: 'Adicionado — antigo' },
  { value: 'release_desc',  label: 'Lançamento — recente' },
  { value: 'release_asc',   label: 'Lançamento — antigo' },
  { value: 'price_asc',     label: 'Menor preço' },
  { value: 'discount_desc', label: 'Maior desconto' },
]

const TYPE_EMOJI: Record<MediaType, string> = {
  movie: '🎬', series: '📺', game: '🎮', book: '📚', music: '🎵',
}

/** Mês (YYYY-MM) de added_at. */
function addedMonthKey(iso: string): string {
  return iso.slice(0, 7)
}
function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  const s = new Date(y, m - 1, 1).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

/* ─── Select estilizado (combina com o resto do app) ─── */
function FilterSelect({
  label, value, onChange, options,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  if (options.length === 0) return null
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text-muted)' }}>
        {label}
      </span>
      <select
        value={value}
        onChange={e => onChange(e.target.value)}
        style={{
          background: value ? 'var(--accent-bg)' : 'var(--card)',
          border: `1px solid ${value ? 'var(--accent)' : 'var(--border-strong)'}`,
          color: value ? 'var(--accent)' : 'var(--text-secondary)',
          borderRadius: 9999, padding: '7px 14px', fontSize: 13, fontWeight: 500,
          cursor: 'pointer', outline: 'none', fontFamily: 'inherit', minWidth: 120,
        }}
      >
        <option value="">Todos</option>
        {options.map(o => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    </label>
  )
}

/* ─── Paginação da grade ─── */

/**
 * A paginação é da **grade**, não da consulta: os filtros (gênero, ano, diretor,
 * loja) e a ordenação por preço são montados a partir do backlog inteiro. Se o
 * servidor mandasse só uma página, o seletor de gênero listaria os gêneros
 * daquela página e "menor preço" ordenaria dentro dela. Então os dados vêm
 * completos (`listAll`, em páginas) e só o que é desenhado é fatiado.
 */
const PER_PAGE = 48

/** Páginas a mostrar: as pontas, a atual e as vizinhas; o resto vira reticência. */
function pageWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const near = [current - 1, current, current + 1].filter(n => n > 1 && n < total)
  const out: (number | '…')[] = [1]
  if (near[0] > 2) out.push('…')
  out.push(...near)
  if (near[near.length - 1] < total - 1) out.push('…')
  out.push(total)
  return out
}

const pageBtn = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--accent)' : 'var(--card)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
  color: active ? 'var(--bg)' : 'var(--text-secondary)',
  borderRadius: 9999, padding: '7px 14px', fontSize: 13, fontWeight: active ? 700 : 500,
  cursor: 'pointer', outline: 'none', fontFamily: 'inherit', minWidth: 40,
})

function Pager({ page, total, count, onGo }: {
  page: number
  total: number
  /** Total de itens depois dos filtros — para a linha "mostrando X–Y de Z". */
  count: number
  onGo: (p: number) => void
}) {
  if (total <= 1) return null
  const first = (page - 1) * PER_PAGE + 1
  const last  = Math.min(page * PER_PAGE, count)

  return (
    <nav
      aria-label="Paginação do backlog"
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 48 }}
    >
      <button onClick={() => onGo(page - 1)} disabled={page === 1}
        style={{ ...pageBtn(false), opacity: page === 1 ? 0.4 : 1, cursor: page === 1 ? 'default' : 'pointer' }}>
        ← Anterior
      </button>

      {pageWindow(page, total).map((p, i) =>
        p === '…'
          ? <span key={`gap-${i}`} style={{ color: 'var(--text-muted)', padding: '0 4px', fontSize: 13 }}>…</span>
          : <button key={p} onClick={() => onGo(p)} aria-current={p === page ? 'page' : undefined} style={pageBtn(p === page)}>
              {p}
            </button>,
      )}

      <button onClick={() => onGo(page + 1)} disabled={page === total}
        style={{ ...pageBtn(false), opacity: page === total ? 0.4 : 1, cursor: page === total ? 'default' : 'pointer' }}>
        Próxima →
      </button>

      <p style={{ width: '100%', textAlign: 'center', marginTop: 12, fontFamily: 'Space Grotesk, monospace', fontSize: 12, color: 'var(--text-muted)' }}>
        {first}–{last} de {count}
      </p>
    </nav>
  )
}

export function Wishlist() {
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['media', 'wishlist'],
    queryFn: () => api.media.listAll({ status: 'wishlist' }),
  })

  // Uma única consulta em lote alimenta o preço de todos os cards.
  const { data: prices } = useQuery({
    queryKey: ['prices', 'backlog'],
    queryFn: api.prices.backlog,
    staleTime: 60_000,
  })
  const priceBy = useMemo(
    () => new Map((prices?.items ?? []).map(p => [p.media_item_id, p])),
    [prices],
  )

  /* ─── filtros ─── */
  const [fType, setFType]         = useState('')
  const [fGenre, setFGenre]       = useState('')
  const [fYear, setFYear]         = useState('')
  const [fDecade, setFDecade]     = useState('')
  const [fDirector, setFDirector] = useState('')
  const [fMonth, setFMonth]       = useState('')
  const [fShop, setFShop]         = useState('')
  const [fOnSale, setFOnSale]     = useState(false)
  const [sort, setSort]           = useState<SortKey>('added_desc')
  const [page, setPage]           = useState(1)
  const gridTop = useRef<HTMLDivElement>(null)

  /* ─── modal "adicionar ao diário" ─── */
  const [diaryFor, setDiaryFor] = useState<MediaItem | null>(null)

  const addToDiary = useMutation({
    mutationFn: (values: DiaryEntryValues) =>
      api.diary.create({
        media_item_id: diaryFor!.id,
        watched_at: values.watched_at,
        rating: values.rating > 0 ? values.rating : null,
        comment: values.comment || null,
      }),
    onSuccess: () => {
      // O servidor marca a mídia como concluída → sai da wishlist e entra na biblioteca.
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['media-all'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
      qc.invalidateQueries({ queryKey: ['diary'] })
      setDiaryFor(null)
    },
  })

  /* ─── opções de filtro derivadas dos itens ─── */
  const opts = useMemo(() => {
    const uniq = <T,>(arr: T[]) => Array.from(new Set(arr))
    const types    = uniq(items.map(i => i.type))
    const genres   = uniq(items.map(i => i.genre).filter((g): g is string => !!g)).sort()
    const years    = uniq(items.map(i => i.year).filter((y): y is number => !!y).map(String))
      .sort((a, b) => Number(b) - Number(a))
    const decades  = uniq(items.map(i => i.year).filter((y): y is number => !!y).map(y => `${Math.floor(y / 10) * 10}`))
      .sort((a, b) => Number(b) - Number(a))
    const directors = uniq(items.map(i => i.creators).filter((c): c is string => !!c)).sort()
    const months   = uniq(items.map(i => addedMonthKey(i.added_at))).sort((a, b) => (a < b ? 1 : -1))
    const shops    = uniq([...priceBy.values()].map(p => p.best?.shop_name).filter((n): n is string => !!n)).sort()
    return {
      shops:     shops.map(sh => ({ value: sh, label: sh })),
      types:     types.map(t => ({ value: t, label: `${TYPE_EMOJI[t]} ${TYPE_LABEL[t]}` })),
      genres:    genres.map(g => ({ value: g, label: g })),
      years:     years.map(y => ({ value: y, label: y })),
      decades:   decades.map(d => ({ value: d, label: `Anos ${d}` })),
      directors: directors.map(d => ({ value: d, label: d })),
      months:    months.map(m => ({ value: m, label: monthLabel(m) })),
    }
  }, [items, priceBy])

  /* ─── aplica filtros + ordenação ─── */
  const filtered = useMemo(() => {
    let out = items.filter(i =>
      (!fType     || i.type === fType) &&
      (!fGenre    || i.genre === fGenre) &&
      (!fYear     || String(i.year) === fYear) &&
      (!fDecade   || (i.year != null && `${Math.floor(i.year / 10) * 10}` === fDecade)) &&
      (!fDirector || i.creators === fDirector) &&
      (!fMonth    || addedMonthKey(i.added_at) === fMonth) &&
      (!fShop     || priceBy.get(i.id)?.best?.shop_name === fShop) &&
      (!fOnSale   || (priceBy.get(i.id)?.best?.discount_percent ?? 0) > 0)
    )
    const time = (v: string | null | undefined) => (v ? new Date(v).getTime() : 0)
    // Itens sem preço conhecido vão para o fim das ordenações por preço.
    const price    = (id: number) => priceBy.get(id)?.best?.price_minor ?? Number.POSITIVE_INFINITY
    const discount = (id: number) => priceBy.get(id)?.best?.discount_percent ?? -1
    out = [...out].sort((a, b) => {
      switch (sort) {
        case 'added_asc':     return time(a.added_at) - time(b.added_at)
        case 'release_desc':  return time(b.release_date) - time(a.release_date)
        case 'release_asc':   return time(a.release_date) - time(b.release_date)
        case 'price_asc':     return price(a.id) - price(b.id)
        case 'discount_desc': return discount(b.id) - discount(a.id)
        case 'added_desc':
        default:              return time(b.added_at) - time(a.added_at)
      }
    })
    return out
  }, [items, priceBy, fType, fGenre, fYear, fDecade, fDirector, fMonth, fShop, fOnSale, sort])

  const totalPages = Math.max(1, Math.ceil(filtered.length / PER_PAGE))

  // Mexeu no filtro ou na ordenação, a lista é outra: voltar para a primeira
  // página, senão o usuário cai numa página que talvez nem exista mais.
  useEffect(() => {
    setPage(1)
  }, [items.length, fType, fGenre, fYear, fDecade, fDirector, fMonth, fShop, fOnSale, sort])

  const safePage = Math.min(page, totalPages)
  const pageItems = useMemo(
    () => filtered.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE),
    [filtered, safePage],
  )

  /** Trocar de página sem deixar o usuário no meio da grade anterior. */
  const goTo = (p: number) => {
    setPage(Math.min(Math.max(1, p), totalPages))
    gridTop.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  const anyFilter = fType || fGenre || fYear || fDecade || fDirector || fMonth || fShop || fOnSale
  const clearAll = () => {
    setFType(''); setFGenre(''); setFYear(''); setFDecade(''); setFDirector('')
    setFMonth(''); setFShop(''); setFOnSale(false)
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '64px var(--page-x) 80px' }}>

        {/* Header */}
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: 'var(--dim)', marginBottom: 16 }}>
          Quero consumir
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 40 }}>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--text-primary)' }}>
            Backlog
          </h1>
          <p style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 13, color: 'var(--text-muted)', paddingBottom: 8 }}>
            {filtered.length}{anyFilter ? ` de ${items.length}` : ''} {items.length === 1 ? 'item' : 'itens'}
          </p>
        </div>

        {/* Barra de filtros + ordenação */}
        {items.length > 0 && (
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'flex-end', gap: 12, marginBottom: 40 }}>
            <FilterSelect label="Tipo"      value={fType}     onChange={setFType}     options={opts.types} />
            <FilterSelect label="Gênero"    value={fGenre}    onChange={setFGenre}    options={opts.genres} />
            <FilterSelect label="Ano"       value={fYear}     onChange={setFYear}     options={opts.years} />
            <FilterSelect label="Década"    value={fDecade}   onChange={setFDecade}   options={opts.decades} />
            <FilterSelect label="Diretor"   value={fDirector} onChange={setFDirector} options={opts.directors} />
            <FilterSelect label="Mês adic." value={fMonth}    onChange={setFMonth}    options={opts.months} />
            <FilterSelect label="Loja"      value={fShop}     onChange={setFShop}     options={opts.shops} />

            {opts.shops.length > 0 && (
              <button
                onClick={() => setFOnSale(v => !v)}
                aria-pressed={fOnSale}
                style={{
                  background: fOnSale ? 'var(--games-bg)' : 'var(--card)',
                  border: `1px solid ${fOnSale ? 'var(--games)' : 'var(--border-strong)'}`,
                  color: fOnSale ? 'var(--games)' : 'var(--text-secondary)',
                  borderRadius: 9999, padding: '7px 14px', fontSize: 13, fontWeight: 500,
                  cursor: 'pointer', outline: 'none', fontFamily: 'inherit',
                }}
              >
                🏷️ Em promoção
              </button>
            )}

            {/* Ordenação */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginLeft: 'auto' }}>
              <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text-muted)' }}>
                Ordenar
              </span>
              <select
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                style={{
                  background: 'var(--card)', border: '1px solid var(--border-strong)',
                  color: 'var(--text-secondary)', borderRadius: 9999, padding: '7px 14px',
                  fontSize: 13, fontWeight: 500, cursor: 'pointer', outline: 'none', fontFamily: 'inherit',
                }}
              >
                {SORTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </label>

            {anyFilter && (
              <button
                onClick={clearAll}
                className="link-accent"
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 12, paddingBottom: 8 }}
              >
                Limpar filtros
              </button>
            )}
          </div>
        )}

        {/* Âncora para onde a página rola ao trocar de página da grade. */}
        <div ref={gridTop} style={{ scrollMarginTop: 24 }} />

        {/* Grid */}
        {isLoading ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'var(--grid-poster)', gap: 16 }}>
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} style={{ aspectRatio: '2/3', background: 'var(--card)', borderRadius: 12 }} className="animate-pulse" />
            ))}
          </div>
        ) : filtered.length > 0 ? (
          <div style={{ display: 'grid', gridTemplateColumns: 'var(--grid-poster)', gap: 16 }}>
            {pageItems.map(item => (
              <div key={item.id} className="group" style={{ display: 'flex', flexDirection: 'column' }}>
                {/* Poster → detalhe */}
                <div
                  onClick={() => navigate(`/media/${item.id}`)}
                  className="media-pop"
                  style={{
                    aspectRatio: '2/3', background: 'var(--card)', borderRadius: 12,
                    overflow: 'hidden', position: 'relative', cursor: 'pointer',
                    border: '1px solid var(--border)', display: 'flex',
                    alignItems: 'center', justifyContent: 'center', fontSize: 56, marginBottom: 10,
                  }}
                >
                  {item.cover_url
                    ? <img src={item.cover_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                    : TYPE_EMOJI[item.type]
                  }
                  <div style={{ position: 'absolute', top: 8, left: 8 }}>
                    <CategoryTag type={item.type} size="sm" />
                  </div>
                  {item.release_date && (
                    <div style={{
                      position: 'absolute', bottom: 8, left: 8, right: 8,
                      fontSize: 10, fontWeight: 600, color: '#fff',
                      background: 'rgba(0,0,0,.6)', backdropFilter: 'blur(4px)',
                      borderRadius: 6, padding: '3px 8px', textAlign: 'center',
                    }}>
                      📅 {formatDate(item.release_date)}
                    </div>
                  )}
                </div>

                {/* Título + meta */}
                <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.2, marginBottom: 2 }}>
                  {item.title}
                </p>
                <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
                  {[item.year, item.genre].filter(Boolean).join(' · ') || '—'}
                </p>

                {/* Preço (só jogos, e só enquanto estão no backlog) */}
                {item.type === 'game' && prices?.enabled && (
                  <PriceBadge summary={priceBy.get(item.id)} />
                )}

                {/* Ação: adicionar ao diário */}
                <button
                  onClick={() => setDiaryFor(item)}
                  className="btn-accent"
                  style={{
                    marginTop: 'auto', width: '100%', padding: '8px 12px',
                    background: 'var(--accent)', border: 'none', borderRadius: 8,
                    color: '#000', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                  }}
                >
                  + Diário
                </button>
              </div>
            ))}
          </div>
        ) : items.length > 0 ? (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Nenhum item corresponde aos filtros.</p>
          </div>
        ) : (
          <div style={{ textAlign: 'center', padding: '100px 0' }}>
            <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--border)', marginBottom: 12 }}>
              Vazia
            </p>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              Adicione algo ao <strong style={{ color: 'var(--text-secondary)' }}>Backlog</strong> pelo ⌘K.
            </p>
          </div>
        )}

        <Pager page={safePage} total={totalPages} count={filtered.length} onGo={goTo} />
      </div>

      {/* Modal: adicionar ao diário (marca como concluído → entra na biblioteca) */}
      <DiaryEntryModal
        open={!!diaryFor}
        mode="create"
        title={diaryFor?.title ?? ''}
        subtitle="Adicionar ao diário"
        initial={{ rating: diaryFor?.rating ?? 0 }}
        busy={addToDiary.isPending}
        onCancel={() => setDiaryFor(null)}
        onSubmit={values => addToDiary.mutate(values)}
      />
    </div>
  )
}
