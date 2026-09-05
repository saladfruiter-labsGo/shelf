import { useState, useRef, useEffect } from 'react'
import { useParams, useNavigate, Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { MediaCard } from '../components/MediaCard'
import type { MediaItem } from '../types'

const TYPE_EMOJI: Record<string, string> = {
  game: '🎮', book: '📚', movie: '🎬', series: '📺',
}

function AddItemPicker({ listId, listItemIds, onClose }: {
  listId: number
  listItemIds: Set<number>
  onClose: () => void
}) {
  const [q, setQ] = useState('')
  const qc = useQueryClient()
  const inputRef = useRef<HTMLInputElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const { data: allItems = [] } = useQuery({
    queryKey: ['media-all-picker'],
    queryFn: () => api.media.list({ limit: 500 }),
  })

  const toggleMutation = useMutation({
    mutationFn: ({ itemId, inList }: { itemId: number; inList: boolean }) =>
      inList ? api.lists.removeItem(listId, itemId) : api.lists.addItem(listId, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['list', String(listId)] }),
  })

  useEffect(() => { inputRef.current?.focus() }, [])

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onClose])

  const filtered = allItems.filter(item =>
    !q.trim() || item.title.toLowerCase().includes(q.toLowerCase())
  )

  return (
    <div
      ref={containerRef}
      style={{
        position: 'absolute', top: '100%', right: 0, zIndex: 50,
        width: 360, maxHeight: 420,
        background: 'var(--card)', border: '1px solid var(--border-strong)',
        borderRadius: 12, boxShadow: '0 16px 48px rgba(0,0,0,.5)',
        display: 'flex', flexDirection: 'column', overflow: 'hidden',
        marginTop: 8,
      }}
    >
      <div style={{ padding: '12px 12px 8px', borderBottom: '1px solid var(--border)' }}>
        <input
          ref={inputRef}
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar no acervo..."
          style={{
            width: '100%', background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 8, padding: '8px 12px', fontSize: 13,
            color: 'var(--text-primary)', outline: 'none',
          }}
        />
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {filtered.length === 0 ? (
          <p style={{ padding: '24px 16px', textAlign: 'center', fontSize: 13, color: 'var(--text-muted)' }}>
            {q ? 'Nenhum resultado' : 'Acervo vazio'}
          </p>
        ) : filtered.map(item => {
          const inList = listItemIds.has(item.id)
          return (
            <button
              key={item.id}
              onClick={() => toggleMutation.mutate({ itemId: item.id, inList })}
              style={{
                display: 'flex', alignItems: 'center', gap: 10,
                width: '100%', padding: '10px 14px', textAlign: 'left',
                background: inList ? 'var(--accent-bg)' : 'none',
                border: 'none', cursor: 'pointer',
                borderBottom: '1px solid var(--border)',
                transition: 'background .15s',
              }}
              onMouseEnter={e => { if (!inList) (e.currentTarget as HTMLButtonElement).style.background = 'var(--card-hover)' }}
              onMouseLeave={e => { if (!inList) (e.currentTarget as HTMLButtonElement).style.background = 'none' }}
            >
              <span style={{ fontSize: 18, flexShrink: 0 }}>{TYPE_EMOJI[item.type] ?? '📌'}</span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <p style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                  {item.title}
                </p>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 1 }}>
                  {item.year ?? '—'}{item.genre ? ` · ${item.genre}` : ''}
                </p>
              </div>
              <span style={{ fontSize: 16, color: inList ? 'var(--accent)' : 'var(--border-strong)', flexShrink: 0 }}>
                {inList ? '✓' : '+'}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}

export function ListDetail() {
  const { id }   = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc       = useQueryClient()

  const { data, isLoading } = useQuery({
    queryKey: ['list', id],
    queryFn:  () => api.lists.get(parseInt(id!)),
    enabled:  !!id,
  })

  const [editing,     setEditing]     = useState(false)
  const [name,        setName]        = useState('')
  const [desc,        setDesc]        = useState('')
  const [pickerOpen,  setPickerOpen]  = useState(false)
  const addBtnRef = useRef<HTMLDivElement>(null)

  const updateMutation = useMutation({
    mutationFn: () => api.lists.update(parseInt(id!), { name: name.trim(), description: desc.trim() || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['list', id] }); setEditing(false) },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.lists.remove(parseInt(id!)),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['lists'] }); navigate('/lists') },
  })

  const removeItemMutation = useMutation({
    mutationFn: (mediaItemId: number) => api.lists.removeItem(parseInt(id!), mediaItemId),
    onSuccess:  () => qc.invalidateQueries({ queryKey: ['list', id] }),
  })

  if (isLoading) return (
    <div className="px-6 py-8 animate-pulse">
      <div className="h-8 bg-card rounded w-40 mb-2" />
      <div className="h-4 bg-card rounded w-60 mb-8" />
      <div className="grid grid-cols-4 gap-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i}><div className="w-full aspect-[2/3] bg-card rounded-md animate-pulse mb-2" /></div>
        ))}
      </div>
    </div>
  )

  if (!data) return <div className="px-6 py-8 text-muted">Lista não encontrada.</div>

  const listItemIds = new Set((data.items as MediaItem[]).map(i => i.id))

  return (
    <div className="px-6 py-8 max-w-5xl">
      <Link to="/lists" className="text-muted hover:text-primary text-sm mb-6 flex items-center gap-1 transition-colors w-fit">
        ← Listas
      </Link>

      {editing ? (
        <div className="mb-6">
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            className="w-full font-display text-2xl font-bold bg-transparent border-b border-accent text-primary outline-none mb-2"
            autoFocus
          />
          <input
            type="text"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Descrição..."
            className="w-full bg-transparent text-sm text-muted border-b border-border outline-none mb-3"
          />
          <div className="flex gap-2">
            <button
              onClick={() => updateMutation.mutate()}
              disabled={!name.trim()}
              className="px-4 py-1.5 bg-accent text-bg rounded text-sm font-medium"
            >Salvar</button>
            <button onClick={() => setEditing(false)} className="px-4 py-1.5 bg-card text-muted rounded text-sm">Cancelar</button>
          </div>
        </div>
      ) : (
        <div className="flex items-start justify-between mb-6">
          <div>
            <h1 className="font-display text-3xl font-bold text-primary mb-1">{data.name}</h1>
            {data.description && <p className="text-muted text-sm">{data.description}</p>}
            <p className="text-xs text-muted mt-1">{data.items.length} item{data.items.length !== 1 ? 's' : ''}</p>
          </div>
          <div className="flex items-center gap-2">
            {/* Add item button */}
            <div ref={addBtnRef} style={{ position: 'relative' }}>
              <button
                onClick={() => setPickerOpen(o => !o)}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-accent text-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
              >
                <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Adicionar
              </button>
              {pickerOpen && (
                <AddItemPicker
                  listId={parseInt(id!)}
                  listItemIds={listItemIds}
                  onClose={() => setPickerOpen(false)}
                />
              )}
            </div>
            <button
              onClick={() => { setName(data.name); setDesc(data.description ?? ''); setEditing(true) }}
              className="text-sm text-muted hover:text-primary transition-colors"
            >
              Editar
            </button>
            <button
              onClick={() => { if (confirm(`Excluir "${data.name}"?`)) deleteMutation.mutate() }}
              className="text-sm text-muted hover:text-red-400 transition-colors"
            >
              Excluir
            </button>
          </div>
        </div>
      )}

      {data.items.length === 0 ? (
        <div className="text-center py-20 text-muted">
          <p className="text-4xl mb-3">♡</p>
          <p className="text-base font-medium text-secondary mb-2">Lista vazia</p>
          <p className="text-sm">Clique em "+ Adicionar" para incluir mídias do seu acervo</p>
        </div>
      ) : (
        <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-5 lg:grid-cols-6 xl:grid-cols-7 gap-4">
          {(data.items as MediaItem[]).map(item => (
            <div key={item.id} className="group relative">
              <MediaCard item={item} compact />
              <button
                onClick={() => removeItemMutation.mutate(item.id)}
                className="absolute top-0 right-0 w-6 h-6 bg-black/70 text-white rounded-full text-xs
                           flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remover da lista"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
