import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { MODES, MODE_LABEL } from '../lib/lists'
import { TYPE_LABEL, timeAgoLong } from '../lib/utils'
import type { List, ListMode, MediaType } from '../types'
import { imageUrl } from '../lib/images'

/** "32 filmes · 8 séries" — o subtítulo do card. */
function typeSummary(list: List): string {
  const counts = list.type_counts ?? {}
  const parts = (Object.entries(counts) as [MediaType, number][])
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([type, n]) => `${n} ${TYPE_LABEL[type].toLowerCase()}${n > 1 ? 's' : ''}`)
  if (parts.length === 0) return 'Vazia'
  return parts.join(' · ')
}

function Collage({ covers }: { covers: string[] }) {
  if (covers.length === 0) {
    return (
      <div className="list-collage">
        <div className="list-collage-empty">♡</div>
      </div>
    )
  }
  return (
    <div className="list-collage">
      {covers.slice(0, 5).map((cover, i) => (
        <div key={`${cover}-${i}`} className="list-collage-poster">
          <img src={imageUrl(cover, 160)!} alt="" loading="lazy" />
        </div>
      ))}
    </div>
  )
}

export function Lists() {
  const qc = useQueryClient()
  const { data: lists = [], isLoading } = useQuery({ queryKey: ['lists'], queryFn: api.lists.list })

  const [creating, setCreating] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [mode, setMode] = useState<ListMode>('list')

  const createMutation = useMutation({
    mutationFn: () => api.lists.create({ name: name.trim(), description: desc.trim() || undefined, mode }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lists'] })
      setCreating(false)
      setName('')
      setDesc('')
      setMode('list')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.lists.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists'] }),
  })

  const total = lists.reduce((sum, l) => sum + (l.item_count ?? 0), 0)

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '64px var(--page-x) 80px' }}>

        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: 'var(--dim)', marginBottom: 16 }}>
          Coleções
        </p>
        <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 24, flexWrap: 'wrap', marginBottom: 40 }}>
          <div>
            <h1 className="font-display" style={{ fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--text-primary)' }}>
              Listas
            </h1>
            <p style={{ marginTop: 14, fontSize: 16, color: 'var(--text-secondary)' }}>
              Organize sua coleção em listas, rankings e tierlists
            </p>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16, paddingBottom: 6 }}>
            <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>
              {lists.length} {lists.length === 1 ? 'lista' : 'listas'} · {total} {total === 1 ? 'item' : 'itens'}
            </span>
            <button
              onClick={() => setCreating(c => !c)}
              className="btn-accent"
              style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '9px 16px', borderRadius: 10, border: 0, background: 'var(--accent)', color: 'var(--bg)', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer' }}
            >
              <span style={{ fontSize: 16, lineHeight: 1 }}>+</span> Nova lista
            </button>
          </div>
        </div>

        {/* Criar */}
        {creating && (
          <div
            className="animate-fade-in"
            style={{ marginBottom: 28, padding: 18, border: '1px solid var(--border)', borderRadius: 'var(--r)', background: 'var(--surface)' }}
          >
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 14 }}>Nova lista</p>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Nome da lista"
              aria-label="Nome da lista"
              autoFocus
              onKeyDown={e => e.key === 'Enter' && name.trim() && createMutation.mutate()}
              style={{ width: '100%', marginBottom: 10, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', color: 'var(--text-primary)', font: 'inherit', fontSize: 16, outline: 'none' }}
            />
            <input
              type="text"
              value={desc}
              onChange={e => setDesc(e.target.value)}
              placeholder="Descrição (opcional)"
              aria-label="Descrição da lista"
              style={{ width: '100%', marginBottom: 14, padding: '10px 12px', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--card)', color: 'var(--text-primary)', font: 'inherit', fontSize: 16, outline: 'none' }}
            />
            <div style={{ display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
              <div className="list-modes" role="group" aria-label="Modo da lista">
                {MODES.map(m => (
                  <button
                    key={m}
                    type="button"
                    className={`list-mode-btn${mode === m ? ' is-active' : ''}`}
                    aria-pressed={mode === m}
                    onClick={() => setMode(m)}
                  >
                    {MODE_LABEL[m]}
                  </button>
                ))}
              </div>
              <span style={{ flex: 1 }} />
              <button
                onClick={() => name.trim() && createMutation.mutate()}
                disabled={!name.trim() || createMutation.isPending}
                className="btn-accent"
                style={{ padding: '9px 18px', borderRadius: 10, border: 0, background: 'var(--accent)', color: 'var(--bg)', font: 'inherit', fontSize: 14, fontWeight: 600, cursor: 'pointer', opacity: name.trim() ? 1 : .6 }}
              >
                Criar
              </button>
              <button
                onClick={() => { setCreating(false); setName(''); setDesc('') }}
                style={{ padding: '9px 18px', borderRadius: 10, border: '1px solid var(--border)', background: 'none', color: 'var(--text-muted)', font: 'inherit', fontSize: 14, cursor: 'pointer' }}
              >
                Cancelar
              </button>
            </div>
          </div>
        )}

        {isLoading ? (
          <div className="list-index">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="animate-pulse" style={{ height: 122, borderRadius: 'var(--r)', background: 'var(--card)' }} />
            ))}
          </div>
        ) : lists.length === 0 ? (
          <div style={{ padding: '96px 0', textAlign: 'center', color: 'var(--text-muted)' }}>
            <p style={{ fontSize: 48, marginBottom: 16 }}>♡</p>
            <p style={{ fontSize: 18, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Nenhuma lista ainda</p>
            <p style={{ fontSize: 16 }}>Crie listas, rankings ou tierlists para organizar sua coleção</p>
          </div>
        ) : (
          <div className="list-index">
            {lists.map(list => (
              <div key={list.id} style={{ position: 'relative' }} className="group">
                <Link to={`/lists/${list.id}`} className="list-card">
                  <Collage covers={list.covers ?? []} />
                  <div style={{ minWidth: 0 }}>
                    <div className="list-card-head">
                      <span className="list-card-title">{list.name}</span>
                      {list.mode !== 'list' && <span className="list-mode-pill">{MODE_LABEL[list.mode]}</span>}
                    </div>
                    <div className="list-card-meta">
                      <span>{list.item_count ?? 0} {(list.item_count ?? 0) === 1 ? 'item' : 'itens'}</span>
                      <span style={{ color: 'var(--dim)' }}>·</span>
                      <span>{typeSummary(list)}</span>
                      <span style={{ color: 'var(--dim)' }}>·</span>
                      <span>atualizada {timeAgoLong(list.updated_at)}</span>
                    </div>
                    {list.description && <p className="list-card-desc">{list.description}</p>}
                  </div>
                </Link>
                <button
                  onClick={() => { if (confirm(`Excluir "${list.name}"?`)) deleteMutation.mutate(list.id) }}
                  title={`Excluir ${list.name}`}
                  aria-label={`Excluir ${list.name}`}
                  className="row-fade"
                  style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 0, color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', opacity: .55 }}
                >
                  Excluir
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
