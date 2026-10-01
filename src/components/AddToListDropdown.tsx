import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

/** Liga/desliga a mídia em cada lista. Usado no detalhe da mídia e na página de jogo. */
export function AddToListDropdown({ itemId }: { itemId: number }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data: checks = [] } = useQuery({
    queryKey: ['list-check', itemId],
    queryFn: () => api.lists.check(itemId),
    enabled: open,
  })

  const toggleMutation = useMutation({
    mutationFn: ({ listId, contains }: { listId: number; contains: boolean }) =>
      contains ? api.lists.removeItem(listId, itemId) : api.lists.addItem(listId, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['list-check', itemId] }),
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-lg text-sm text-secondary hover:border-border-strong hover:text-primary transition-colors"
      >
        <span>♡</span> Adicionar à lista
        <span className="text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-surface border border-border rounded-xl shadow-xl z-20 animate-fade-in overflow-hidden">
          {checks.length === 0 ? (
            <p className="text-center text-muted text-sm py-4 px-3">
              Nenhuma lista criada.<br />
              <a href="/lists" className="text-accent underline text-xs">Criar lista</a>
            </p>
          ) : (
            checks.map(l => (
              <button
                key={l.id}
                onClick={() => toggleMutation.mutate({ listId: l.id, contains: l.contains === 1 })}
                className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-card transition-colors text-left text-sm"
              >
                <span className={l.contains ? 'text-accent' : 'text-muted'}>
                  {l.contains ? '♥' : '♡'}
                </span>
                <span className={l.contains ? 'text-primary' : 'text-secondary'}>{l.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}
