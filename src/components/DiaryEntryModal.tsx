import { useEffect, useState } from 'react'
import { StarRating } from './StarRating'
import { todayISODate, toISODate } from '../lib/utils'

export interface DiaryEntryValues {
  watched_at: string        // YYYY-MM-DD
  rating:     number        // 0 = sem nota
  comment:    string
}

interface Props {
  open:       boolean
  mode:       'create' | 'edit'
  title:      string        // título da mídia (exibido no cabeçalho)
  subtitle?:  string        // ex.: "Registrar conclusão"
  initial?:   Partial<DiaryEntryValues>
  busy?:      boolean
  onCancel:   () => void
  onSubmit:   (v: DiaryEntryValues) => void
}

/** Modal para criar/editar um registro do diário (data, nota, comentário). */
export function DiaryEntryModal({ open, mode, title, subtitle, initial, busy, onCancel, onSubmit }: Props) {
  const [watchedAt, setWatchedAt] = useState('')
  const [rating, setRating]       = useState(0)
  const [comment, setComment]     = useState('')

  // Reinicializa os campos sempre que o modal abre
  useEffect(() => {
    if (!open) return
    setWatchedAt(initial?.watched_at ? toISODate(initial.watched_at) : todayISODate())
    setRating(initial?.rating ?? 0)
    setComment(initial?.comment ?? '')
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const submit = () => onSubmit({ watched_at: watchedAt, rating, comment: comment.trim() })

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div className="relative w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl animate-scale-in p-6">
        <p className="text-xs text-muted uppercase tracking-wide mb-1">{subtitle ?? (mode === 'edit' ? 'Editar registro' : 'Registrar conclusão')}</p>
        <h2 className="text-lg font-bold text-primary mb-5 truncate">{title}</h2>

        {/* Data */}
        <div className="mb-4">
          <label className="block text-xs text-muted uppercase tracking-wide mb-2">Data</label>
          <input
            type="date"
            value={watchedAt}
            max={todayISODate()}
            onChange={e => setWatchedAt(e.target.value)}
            className="w-full bg-card border border-border rounded-md px-3 py-2 text-sm text-primary outline-none focus:border-accent"
          />
        </div>

        {/* Nota */}
        <div className="mb-4">
          <label className="block text-xs text-muted uppercase tracking-wide mb-2">Avaliação</label>
          <div className="flex items-center gap-2">
            <StarRating value={rating} onChange={setRating} size="lg" />
            {rating > 0 && <span className="text-xs text-muted">{rating} / 5</span>}
          </div>
        </div>

        {/* Comentário */}
        <div className="mb-6">
          <label className="block text-xs text-muted uppercase tracking-wide mb-2">Comentário <span className="text-dim normal-case">(opcional)</span></label>
          <textarea
            value={comment}
            onChange={e => setComment(e.target.value)}
            rows={3}
            placeholder="O que você achou?"
            className="w-full resize-none bg-card border border-border rounded-md px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-accent"
          />
        </div>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:text-primary border border-border hover:border-border-strong transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={submit}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-bg hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {busy ? '...' : mode === 'edit' ? 'Salvar' : 'Registrar'}
          </button>
        </div>
      </div>
    </div>
  )
}
