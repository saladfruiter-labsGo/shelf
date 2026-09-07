import { useEffect } from 'react'

interface Props {
  open:          boolean
  title:         string
  message?:      string
  confirmLabel?: string
  cancelLabel?:  string
  danger?:       boolean
  busy?:         boolean
  onConfirm:     () => void
  onCancel:      () => void
}

/** Modal de confirmação reutilizável (substitui o confirm() nativo). */
export function ConfirmDialog({
  open, title, message, confirmLabel = 'Confirmar', cancelLabel = 'Cancelar',
  danger = false, busy = false, onConfirm, onCancel,
}: Props) {
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel()
      if (e.key === 'Enter') onConfirm()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel, onConfirm])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        role="alertdialog"
        aria-modal="true"
        className="relative w-full max-w-sm bg-surface border border-border rounded-2xl shadow-2xl animate-scale-in p-6"
      >
        <h2 className="text-lg font-bold text-primary mb-2">{title}</h2>
        {message && <p className="text-sm text-secondary leading-relaxed mb-6">{message}</p>}
        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:text-primary border border-border hover:border-border-strong transition-colors disabled:opacity-60"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={busy}
            className={`px-4 py-2 rounded-lg text-sm font-semibold transition-colors disabled:opacity-60 ${
              danger
                ? 'bg-red-500/90 text-white hover:bg-red-500'
                : 'bg-accent text-bg hover:opacity-90'
            }`}
          >
            {busy ? '...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
