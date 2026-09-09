import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { ListPosterTile } from '../components/ListPosterTile'
import { ListTierBoard } from '../components/ListTierBoard'
import { useMediaPreview } from '../components/MediaSummaryModal'
import { usePosterDrag, type DropTarget } from '../hooks/usePosterDrag'
import { MODES, MODE_LABEL, isConsumed, orderPayload, reorderItems } from '../lib/lists'
import { TYPE_LABEL, norm, timeAgoLong } from '../lib/utils'
import type { ListDetail as ListDetailData, ListMode, ListTier, MediaItem, MediaType } from '../types'

const TYPE_EMOJI: Record<string, string> = {
  game: '🎮', book: '📚', movie: '🎬', series: '📺', music: '🎵',
}

type SortKey = 'order' | 'added' | 'title' | 'year_desc' | 'year_asc' | 'rating'
const SORTS: { value: SortKey; label: string }[] = [
  { value: 'order',     label: 'Ordem da lista' },
  { value: 'added',     label: 'Adicionado — recente' },
  { value: 'title',     label: 'Título A–Z' },
  { value: 'year_desc', label: 'Lançamento — recente' },
  { value: 'year_asc',  label: 'Lançamento — antigo' },
  { value: 'rating',    label: 'Maior nota' },
]

/* ─── Seletor de mídia do acervo (também adiciona direto num tier) ─── */

function AddItemPicker({ listId, items, tier, onClose, onAssignTier }: {
  listId: number
  items:  MediaItem[]
  /** `undefined` = adicionar solto; um número/`null` = adicionar naquele tier. */
  tier:   { id: number | null; name: string } | undefined
  onClose: () => void
  onAssignTier: (itemId: number, tierId: number | null) => void
}) {
  const [q, setQ] = useState('')
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)

  const { data: allItems = [] } = useQuery({
    queryKey: ['media-all-picker'],
    // Inclui backlog: dá para pôr numa lista o que ainda não foi consumido.
    queryFn: () => api.media.listAll(),
  })

  const inList = useMemo(() => new Map(items.map(i => [i.id, i])), [items])

  const addMutation = useMutation({
    mutationFn: (itemId: number) => api.lists.addItem(listId, itemId, tier?.id ?? null),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['list', String(listId)] })
      qc.invalidateQueries({ queryKey: ['lists'] })
    },
  })

  const removeMutation = useMutation({
    mutationFn: (itemId: number) => api.lists.removeItem(listId, itemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['list', String(listId)] })
      qc.invalidateQueries({ queryKey: ['lists'] })
    },
  })

  useEffect(() => { inputRef.current?.focus() }, [])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const needle = norm(q)
  const filtered = needle ? allItems.filter(i => norm(i.title).includes(needle)) : allItems

  return createPortal(
    <div className="list-picker-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="list-picker" role="dialog" aria-label="Adicionar mídia à lista">
        <div className="list-picker-head">
          <p className="list-picker-title">
            {tier ? `Adicionar no tier ${tier.name}` : 'Adicionar à lista'}
          </p>
          <input
            ref={inputRef}
            className="list-picker-search"
            value={q}
            onChange={e => setQ(e.target.value)}
            placeholder="Buscar no acervo..."
            aria-label="Buscar no acervo"
          />
        </div>
        <div className="list-picker-body">
          {filtered.length === 0 ? (
            <p style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
              {q ? 'Nenhum resultado' : 'Acervo vazio'}
            </p>
          ) : filtered.map(item => {
            const current  = inList.get(item.id)
            const here     = current && (!tier || (current.tier_id ?? null) === tier.id)
            const elsewhere = current && !here

            const act = () => {
              if (!current)   return addMutation.mutate(item.id)
              if (elsewhere)  return onAssignTier(item.id, tier!.id)   // move de tier
              removeMutation.mutate(item.id)
            }

            return (
              <button
                key={item.id}
                type="button"
                className={`list-picker-row${here ? ' is-in' : ''}`}
                onClick={act}
                title={!current ? 'Adicionar' : elsewhere ? `Mover para ${tier!.name}` : 'Remover da lista'}
              >
                <span style={{ fontSize: 18, flexShrink: 0 }}>{TYPE_EMOJI[item.type] ?? '📌'}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {item.title}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 1 }}>
                    {item.year ?? '—'}{item.genre ? ` · ${item.genre}` : ''}
                  </p>
                </div>
                <span style={{ fontSize: 16, color: here ? 'var(--accent)' : 'var(--border-strong)', flexShrink: 0 }}>
                  {here ? '✓' : elsewhere ? '↧' : '+'}
                </span>
              </button>
            )
          })}
        </div>
      </div>
    </div>,
    document.body,
  )
}

/* ─── Controles da barra ─── */

function BarSelect({ label, value, onChange, options }: {
  label: string
  value: string
  onChange: (v: string) => void
  options: { value: string; label: string }[]
}) {
  if (options.length === 0) return null
  return (
    <select
      className={`list-select${value ? ' is-on' : ''}`}
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={label}
    >
      <option value="">{label}</option>
      {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
    </select>
  )
}

function GridIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="0" y="0" width="6" height="6" rx="1" />
      <rect x="8" y="0" width="6" height="6" rx="1" />
      <rect x="0" y="8" width="6" height="6" rx="1" />
      <rect x="8" y="8" width="6" height="6" rx="1" />
    </svg>
  )
}

function RowsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 14 14" fill="currentColor" aria-hidden="true">
      <rect x="0" y="1" width="14" height="2" rx="1" />
      <rect x="0" y="6" width="14" height="2" rx="1" />
      <rect x="0" y="11" width="14" height="2" rx="1" />
    </svg>
  )
}

function Switch({ on, label, onToggle }: { on: boolean; label: string; onToggle: () => void }) {
  return (
    <button type="button" className="list-switch" aria-pressed={on} onClick={onToggle}>
      <span className="list-switch-track"><span className="list-switch-knob" /></span>
      {label}
    </button>
  )
}

/* ─── Página ─── */

export function ListDetail() {
  const { id }   = useParams<{ id: string }>()
  const listId   = Number(id)
  const navigate = useNavigate()
  const qc       = useQueryClient()
  const { openMedia } = useMediaPreview()

  const { data, isLoading } = useQuery({
    queryKey: ['list', id],
    queryFn:  () => api.lists.get(listId),
    enabled:  Number.isFinite(listId),
  })

  const [editing, setEditing] = useState(false)
  const [name,    setName]    = useState('')
  const [desc,    setDesc]    = useState('')
  const [picker,  setPicker]  = useState<{ id: number | null; name: string } | undefined | false>(false)

  const [fDecade, setFDecade] = useState('')
  const [fGenre,  setFGenre]  = useState('')
  const [fType,   setFType]   = useState('')
  const [sort,    setSort]    = useState<SortKey>('order')
  const [view,    setView]    = useState<'grid' | 'rows'>('grid')

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['list', id] })
    qc.invalidateQueries({ queryKey: ['lists'] })
  }

  const updateMutation = useMutation({
    mutationFn: (patch: { name?: string; description?: string; mode?: ListMode; dim_seen?: boolean }) =>
      api.lists.update(listId, patch),
    onSuccess: () => { invalidate(); setEditing(false) },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.lists.remove(listId),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lists'] }); navigate('/lists') },
  })

  const removeItemMutation = useMutation({
    mutationFn: (mediaItemId: number) => api.lists.removeItem(listId, mediaItemId),
    onSuccess:  invalidate,
  })

  const reorderMutation = useMutation({
    mutationFn: (payload: { media_item_id: number; tier_id: number | null }[]) =>
      api.lists.reorder(listId, payload),
    // A tela já mostra a ordem nova (otimista); só o índice precisa recarregar.
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists'] }),
    onError:   () => qc.invalidateQueries({ queryKey: ['list', id] }),
  })

  const tierMutation = useMutation({
    mutationFn: (action: () => Promise<unknown>) => action(),
    onSuccess: invalidate,
  })

  /** Aplica a ordem nova na hora e manda para o servidor. */
  const commitOrder = useCallback((mutate: (prev: ListDetailData) => MediaItem[]) => {
    const prev = qc.getQueryData<ListDetailData>(['list', id])
    if (!prev) return
    const items = mutate(prev)
    qc.setQueryData(['list', id], { ...prev, items })
    reorderMutation.mutate(orderPayload(items))
  }, [qc, id, reorderMutation])

  const handleDrop = useCallback((dragId: number, target: DropTarget) => {
    commitOrder(prev => reorderItems(prev.items, prev.tiers, prev.mode, dragId, target))
  }, [commitOrder])

  const dnd = usePosterDrag(handleDrop)

  const assignTier = useCallback((itemId: number, tierId: number | null) => {
    commitOrder(prev => reorderItems(prev.items, prev.tiers, 'tier', itemId, {
      zone:  tierId === null ? 'tier:none' : `tier:${tierId}`,
      index: Number.MAX_SAFE_INTEGER,
    }))
  }, [commitOrder])

  const items = useMemo(() => data?.items ?? [], [data])

  /* ─── opções de filtro derivadas dos itens ─── */
  const opts = useMemo(() => {
    const uniq = <T,>(arr: T[]) => Array.from(new Set(arr))
    const decades = uniq(items.map(i => i.year).filter((y): y is number => !!y).map(y => `${Math.floor(y / 10) * 10}`))
      .sort((a, b) => Number(b) - Number(a))
    const genres = uniq(items.map(i => i.genre).filter((g): g is string => !!g)).sort()
    const types  = uniq(items.map(i => i.type))
    return {
      decades: decades.map(d => ({ value: d, label: `Anos ${d}` })),
      genres:  genres.map(g => ({ value: g, label: g })),
      types:   types.map(t => ({ value: t, label: TYPE_LABEL[t as MediaType] })),
    }
  }, [items])

  const anyFilter = Boolean(fDecade || fGenre || fType)

  const visible = useMemo(() => {
    const out = items.filter(i =>
      (!fDecade || (i.year != null && `${Math.floor(i.year / 10) * 10}` === fDecade)) &&
      (!fGenre  || i.genre === fGenre) &&
      (!fType   || i.type === fType))

    if (sort === 'order') return out
    const time = (v?: string | null) => (v ? new Date(v).getTime() : 0)
    return [...out].sort((a, b) => {
      switch (sort) {
        case 'added':     return time(b.list_added_at) - time(a.list_added_at)
        case 'title':     return a.title.localeCompare(b.title, 'pt-BR')
        case 'year_desc': return (b.year ?? 0) - (a.year ?? 0)
        case 'year_asc':  return (a.year ?? 9999) - (b.year ?? 9999)
        case 'rating':    return b.rating - a.rating
        default:          return 0
      }
    })
  }, [items, fDecade, fGenre, fType, sort])

  if (isLoading) return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '64px var(--page-x) 80px' }}>
      <div className="h-8 bg-card rounded w-40 mb-2 animate-pulse" />
      <div className="h-4 bg-card rounded w-60 mb-8 animate-pulse" />
      <div className="list-grid">
        {Array.from({ length: 12 }).map((_, i) => (
          <div key={i} style={{ aspectRatio: '2/3', background: 'var(--card)', borderRadius: 10 }} className="animate-pulse" />
        ))}
      </div>
    </div>
  )

  if (!data) return <div className="px-6 py-8 text-muted">Lista não encontrada.</div>

  const mode      = data.mode
  const dimSeen   = data.dim_seen === 1
  const consumed  = items.filter(isConsumed).length
  // Ordenação e filtro embaralham a ordem manual: arrastar só com a lista inteira à vista.
  const canDrag   = mode !== 'list' && !anyFilter && sort === 'order'
  const dragging  = dnd.drag?.id ?? null

  /** Capas por tier, já sem a que está sendo arrastada (ela vira o fantasma). */
  const byTier = new Map<number | 'none', MediaItem[]>()
  if (mode === 'tier') {
    for (const tier of data.tiers) byTier.set(tier.id, [])
    byTier.set('none', [])
    for (const item of visible) {
      if (item.id === dragging) continue
      const key: number | 'none' = item.tier_id != null && byTier.has(item.tier_id) ? item.tier_id : 'none'
      byTier.get(key)!.push(item)
    }
  }

  const flat = visible.filter(i => i.id !== dragging)

  const caretFor = (index: number, total: number): 'before' | 'after' | null => {
    if (!dnd.over || dnd.over.zone !== 'main') return null
    if (dnd.over.index === index) return 'before'
    if (dnd.over.index >= total && index === total - 1) return 'after'
    return null
  }

  const moveTier = (tier: ListTier, direction: -1 | 1) => {
    const order = [...data.tiers]
    const from  = order.findIndex(t => t.id === tier.id)
    const to    = from + direction
    if (to < 0 || to >= order.length) return
    ;[order[from], order[to]] = [order[to], order[from]]
    qc.setQueryData<ListDetailData>(['list', id], prev => (prev ? { ...prev, tiers: order } : prev))
    tierMutation.mutate(() => api.lists.reorderTiers(listId, order.map(t => ({ id: t.id }))))
  }

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '48px var(--page-x) 80px' }}>

        <Link to="/lists" className="link-accent" style={{ display: 'inline-block', marginBottom: 20, fontSize: 12, letterSpacing: '.5px', color: 'var(--text-muted)' }}>
          ← Listas
        </Link>

        {/* Barra fina: quando mudou + filtros + interruptores */}
        <div className="list-bar">
          <span className="list-bar-note">Atualizada {timeAgoLong(data.updated_at)}</span>
          <span className="list-bar-spacer" />
          <div className="list-bar-group">
            <BarSelect label="Década" value={fDecade} onChange={setFDecade} options={opts.decades} />
            <BarSelect label="Gênero" value={fGenre}  onChange={setFGenre}  options={opts.genres} />
            <BarSelect label="Tipo"   value={fType}   onChange={setFType}   options={opts.types} />
            {mode === 'list' && (
              <select
                className={`list-select${sort !== 'order' ? ' is-on' : ''}`}
                value={sort}
                onChange={e => setSort(e.target.value as SortKey)}
                aria-label="Ordenar por"
              >
                {SORTS.map(s => <option key={s.value} value={s.value}>{`Ordenar: ${s.label}`}</option>)}
              </select>
            )}
            <Switch
              on={dimSeen}
              label="Esmaecer vistos"
              onToggle={() => updateMutation.mutate({ dim_seen: !dimSeen })}
            />
            {mode !== 'tier' && (
              <div style={{ display: 'flex', gap: 2 }}>
                <button
                  type="button"
                  className={`list-view-btn${view === 'grid' ? ' is-active' : ''}`}
                  onClick={() => setView('grid')}
                  aria-label="Ver em capas" title="Capas"
                >
                  <GridIcon />
                </button>
                <button
                  type="button"
                  className={`list-view-btn${view === 'rows' ? ' is-active' : ''}`}
                  onClick={() => setView('rows')}
                  aria-label="Ver em linhas" title="Linhas"
                >
                  <RowsIcon />
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Título, descrição e ações */}
        {editing ? (
          <div style={{ margin: '28px 0 24px' }}>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              className="font-display"
              style={{ width: '100%', background: 'transparent', border: 0, borderBottom: '1px solid var(--accent)', color: 'var(--text-primary)', fontSize: 34, fontWeight: 800, letterSpacing: '-1px', outline: 'none', marginBottom: 10, padding: '0 0 6px' }}
              autoFocus
              aria-label="Nome da lista"
            />
            <textarea
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Descrição..."
              rows={3}
              style={{ width: '100%', background: 'var(--card)', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-secondary)', font: 'inherit', fontSize: 16, padding: 12, outline: 'none', resize: 'vertical', marginBottom: 12 }}
              aria-label="Descrição da lista"
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                onClick={() => name.trim() && updateMutation.mutate({ name: name.trim(), description: desc.trim() })}
                disabled={!name.trim() || updateMutation.isPending}
                className="btn-accent"
                style={{ padding: '8px 18px', borderRadius: 10, border: 0, background: 'var(--accent)', color: 'var(--bg)', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >Salvar</button>
              <button
                onClick={() => setEditing(false)}
                style={{ padding: '8px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', font: 'inherit', fontSize: 14, cursor: 'pointer' }}
              >Cancelar</button>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', margin: '28px 0 20px' }}>
            <div style={{ minWidth: 0, flex: '1 1 420px' }}>
              <h1 className="font-display" style={{ fontSize: 'clamp(32px,4.2vw,56px)', fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1.02, color: 'var(--text-primary)' }}>
                {data.name}
              </h1>
              {data.description && (
                <p style={{ marginTop: 14, maxWidth: 680, fontSize: 16, lineHeight: 1.55, color: 'var(--text-secondary)', whiteSpace: 'pre-wrap' }}>
                  {data.description}
                </p>
              )}
              <p style={{ marginTop: 14, fontSize: 13, color: 'var(--text-muted)' }}>
                {items.length} {items.length === 1 ? 'item' : 'itens'}
                {anyFilter ? ` · ${visible.length} com os filtros` : ''}
              </p>
            </div>

            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <button
                onClick={() => setPicker(undefined)}
                className="btn-accent"
                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: 0, background: 'var(--accent)', color: 'var(--bg)', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Adicionar
              </button>
              <button
                onClick={() => { setName(data.name); setDesc(data.description ?? ''); setEditing(true) }}
                className="link-accent"
                style={{ background: 'none', border: 0, color: 'var(--text-muted)', font: 'inherit', fontSize: 14, cursor: 'pointer' }}
              >Editar</button>
              <button
                onClick={() => { if (confirm(`Excluir "${data.name}"?`)) deleteMutation.mutate() }}
                style={{ background: 'none', border: 0, color: 'var(--text-muted)', font: 'inherit', fontSize: 14, cursor: 'pointer' }}
              >Excluir</button>
            </div>
          </div>
        )}

        {/* Modo da lista + progresso */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 20, flexWrap: 'wrap', marginBottom: 28 }}>
          <div className="list-modes" role="group" aria-label="Modo da lista">
            {MODES.map(m => (
              <button
                key={m}
                type="button"
                className={`list-mode-btn${mode === m ? ' is-active' : ''}`}
                aria-pressed={mode === m}
                onClick={() => mode !== m && updateMutation.mutate({ mode: m })}
              >
                {MODE_LABEL[m]}
              </button>
            ))}
          </div>
          {items.length > 0 && (
            <div className="list-progress">
              <span>Já consumi <strong style={{ color: 'var(--text-primary)' }}>{consumed}</strong> de {items.length}</span>
              <span className="list-progress-track">
                <span className="list-progress-fill" style={{ width: `${Math.round((consumed / items.length) * 100)}%` }} />
              </span>
            </div>
          )}
        </div>

        {mode !== 'list' && !canDrag && items.length > 0 && (
          <p style={{ marginBottom: 16, fontSize: 13, color: 'var(--text-muted)' }}>
            Limpe os filtros e volte para a ordem da lista para poder arrastar as capas.
          </p>
        )}

        {/* Conteúdo */}
        {items.length === 0 ? (
          <div style={{ padding: '80px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: 40, marginBottom: 12 }}>♡</p>
            <p style={{ fontSize: 16, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Lista vazia</p>
            <p style={{ fontSize: 14 }}>Clique em “+ Adicionar” para incluir mídias do seu acervo</p>
          </div>
        ) : mode === 'tier' ? (
          <ListTierBoard
            tiers={data.tiers}
            byTier={byTier}
            over={dnd.over}
            draggable={canDrag}
            dimSeen={dimSeen}
            isConsumed={isConsumed}
            onOpen={item => { if (!dnd.justDragged()) openMedia(item) }}
            onRemove={item => removeItemMutation.mutate(item.id)}
            onDragStart={(e, item) => dnd.start(e, { id: item.id, title: item.title, cover: item.cover_url })}
            onAddTier={() => tierMutation.mutate(() => api.lists.addTier(listId, { name: 'Novo', color: 'accent' }))}
            onRenameTier={(tier, value) => {
              const next = value.trim()
              if (next && next !== tier.name) tierMutation.mutate(() => api.lists.updateTier(listId, tier.id, { name: next }))
            }}
            onColorTier={(tier, color) => tierMutation.mutate(() => api.lists.updateTier(listId, tier.id, { color }))}
            onMoveTier={moveTier}
            onDeleteTier={tier => {
              if (confirm(`Excluir o tier "${tier.name}"? As capas voltam para "sem tier".`)) {
                tierMutation.mutate(() => api.lists.removeTier(listId, tier.id))
              }
            }}
            onAddToTier={tierId => setPicker({ id: tierId, name: data.tiers.find(t => t.id === tierId)?.name ?? '—' })}
          />
        ) : view === 'grid' ? (
          <div className="list-grid" data-drop-zone="main">
            {flat.map((item, i) => (
              <ListPosterTile
                key={item.id}
                item={item}
                rank={mode === 'ranking' ? i + 1 : null}
                dimmed={dimSeen && isConsumed(item)}
                draggable={canDrag}
                caret={caretFor(i, flat.length)}
                onOpen={() => { if (!dnd.justDragged()) openMedia(item) }}
                onRemove={() => removeItemMutation.mutate(item.id)}
                onDragStart={e => dnd.start(e, { id: item.id, title: item.title, cover: item.cover_url })}
              />
            ))}
          </div>
        ) : (
          <div className="list-rows" data-drop-zone="main" data-drop-axis="y">
            {flat.map((item, i) => {
              const caret = caretFor(i, flat.length)
              const classes = [
                'list-row',
                dimSeen && isConsumed(item) && 'is-dim',
                canDrag && 'is-draggable',
                caret === 'before' && 'is-before',
                caret === 'after'  && 'is-after',
              ].filter(Boolean).join(' ')
              return (
                <div
                  key={item.id}
                  className={classes}
                  data-drag-id={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => { if (!dnd.justDragged()) openMedia(item) }}
                  onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openMedia(item) } }}
                  onPointerDown={canDrag ? e => dnd.start(e, { id: item.id, title: item.title, cover: item.cover_url }) : undefined}
                >
                  <span className="list-row-rank">{mode === 'ranking' ? i + 1 : TYPE_EMOJI[item.type]}</span>
                  <span className="list-row-cover">
                    {item.cover_url
                      ? <img src={item.cover_url} alt="" loading="lazy" draggable={false} />
                      : null}
                  </span>
                  <span style={{ minWidth: 0 }}>
                    <span className="list-row-title" style={{ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {item.title}
                    </span>
                    <span className="list-row-sub">
                      {[item.year ?? '—', TYPE_LABEL[item.type], item.genre].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    {item.rating > 0 && <span className="list-row-sub">★ {item.rating}</span>}
                    <button
                      type="button"
                      onClick={e => { e.stopPropagation(); removeItemMutation.mutate(item.id) }}
                      title="Remover da lista"
                      aria-label={`Remover ${item.title} da lista`}
                      style={{ background: 'none', border: 0, color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer' }}
                    >×</button>
                  </span>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Capa que segue o ponteiro */}
      {dnd.drag && createPortal(
        <div
          className="drag-ghost"
          style={{
            width:  dnd.drag.w,
            height: dnd.drag.w * 1.5,
            left:   dnd.drag.x - Math.min(dnd.drag.dx, dnd.drag.w - 8),
            top:    dnd.drag.y - Math.min(dnd.drag.dy, dnd.drag.w * 1.5 - 8),
          }}
        >
          {dnd.drag.cover
            ? <img src={dnd.drag.cover} alt="" />
            : <div style={{ width: '100%', height: '100%', display: 'grid', placeItems: 'center', background: 'var(--card)', color: 'var(--text-muted)', fontSize: 11, padding: 6, textAlign: 'center' }}>{dnd.drag.title}</div>}
        </div>,
        document.body,
      )}

      {picker !== false && (
        <AddItemPicker
          listId={listId}
          items={items}
          tier={picker || undefined}
          onClose={() => setPicker(false)}
          onAssignTier={assignTier}
        />
      )}
    </div>
  )
}
