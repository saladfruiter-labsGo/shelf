import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

export function Lists() {
  const qc = useQueryClient()
  const { data: lists = [], isLoading } = useQuery({ queryKey: ['lists'], queryFn: api.lists.list })

  const [creating, setCreating] = useState(false)
  const [name, setName]         = useState('')
  const [desc, setDesc]         = useState('')

  const createMutation = useMutation({
    mutationFn: () => api.lists.create({ name: name.trim(), description: desc.trim() || undefined }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['lists'] })
      setCreating(false)
      setName('')
      setDesc('')
    },
  })

  const deleteMutation = useMutation({
    mutationFn: (id: number) => api.lists.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['lists'] }),
  })

  return (
    <div className="px-6 py-8 max-w-3xl">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-display text-3xl font-bold text-primary mb-1">Listas</h1>
          <p className="text-muted text-sm">Organize sua coleção em listas personalizadas</p>
        </div>
        <button
          onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-accent text-bg rounded-lg text-sm font-medium hover:opacity-90 transition-opacity"
        >
          + Nova lista
        </button>
      </div>

      {/* Create form */}
      {creating && (
        <div className="bg-surface border border-border rounded-xl p-4 mb-6 animate-fade-in">
          <p className="text-sm font-medium text-primary mb-3">Nova lista</p>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Nome da lista"
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-accent mb-2"
            autoFocus
            onKeyDown={e => e.key === 'Enter' && name.trim() && createMutation.mutate()}
          />
          <input
            type="text"
            value={desc}
            onChange={e => setDesc(e.target.value)}
            placeholder="Descrição (opcional)"
            className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-accent mb-3"
          />
          <div className="flex gap-2">
            <button
              onClick={() => name.trim() && createMutation.mutate()}
              disabled={!name.trim() || createMutation.isPending}
              className="px-4 py-2 bg-accent text-bg rounded-lg text-sm font-medium disabled:opacity-60"
            >
              Criar
            </button>
            <button onClick={() => { setCreating(false); setName(''); setDesc('') }} className="px-4 py-2 bg-card text-muted rounded-lg text-sm">
              Cancelar
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-20 bg-card rounded-xl animate-pulse" />
          ))}
        </div>
      ) : lists.length === 0 ? (
        <div className="text-center py-24 text-muted">
          <p className="text-5xl mb-4">♡</p>
          <p className="text-lg font-medium text-secondary mb-2">Nenhuma lista ainda</p>
          <p className="text-sm">Crie listas para organizar sua coleção</p>
        </div>
      ) : (
        <div className="space-y-3">
          {lists.map(list => (
            <div key={list.id} className="flex items-center gap-4 bg-surface border border-border rounded-xl p-4 hover:border-border-strong transition-colors group">
              <Link to={`/lists/${list.id}`} className="flex-1 min-w-0">
                <p className="font-medium text-primary group-hover:text-accent transition-colors truncate">{list.name}</p>
                {list.description && <p className="text-xs text-muted mt-0.5 truncate">{list.description}</p>}
                <p className="text-xs text-muted mt-1">{list.item_count ?? 0} item{(list.item_count ?? 0) !== 1 ? 's' : ''}</p>
              </Link>
              <button
                onClick={() => { if (confirm(`Excluir "${list.name}"?`)) deleteMutation.mutate(list.id) }}
                className="text-muted hover:text-red-400 transition-colors text-xs opacity-0 group-hover:opacity-100"
              >
                Excluir
              </button>
              <Link to={`/lists/${list.id}`} className="text-muted hover:text-primary transition-colors">
                →
              </Link>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
