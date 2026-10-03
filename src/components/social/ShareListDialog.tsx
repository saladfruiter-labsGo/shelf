import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'

/** Compartilhar uma lista (ou tier list) no feed, com um comentário opcional. */
export function ShareListDialog({ listId, listName, open, onClose }: {
  listId: number
  listName: string
  open: boolean
  onClose: () => void
}) {
  const qc = useQueryClient()
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [postId, setPostId] = useState<number | null>(null)

  useEffect(() => {
    if (!open) return
    setBody(''); setError(null); setPostId(null)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open, onClose])

  if (!open) return null

  const share = async () => {
    setBusy(true)
    setError(null)
    try {
      const post = await api.feed.shareList({ list_id: listId, body: body.trim() })
      qc.invalidateQueries({ queryKey: ['feed'] })
      setPostId(post.id)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="share-list-title" className="relative w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl p-6">
        {postId ? (
          <>
            <h2 id="share-list-title" className="text-lg font-bold text-primary mb-2">Compartilhada! 🎉</h2>
            <p className="text-secondary mb-5" style={{ fontSize: 16 }}>
              "{listName}" está no feed. Quem abrir vê a lista inteira, sempre atualizada — e só esta lista: as outras continuam privadas.
            </p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border-strong text-secondary hover:text-primary">Fechar</button>
              <Link to={`/feed/${postId}`} className="px-4 py-2 rounded-lg bg-accent text-bg font-semibold hover:opacity-90">Ver no feed</Link>
            </div>
          </>
        ) : (
          <>
            <h2 id="share-list-title" className="text-lg font-bold text-primary mb-2">Compartilhar "{listName}" no feed</h2>
            <p className="text-sm text-muted mb-4">Os amigos veem uma prévia no feed e podem abrir a lista completa. As suas outras listas continuam privadas.</p>
            <label htmlFor="share-list-body" className="block text-sm font-medium text-secondary mb-1.5">Comentário (opcional)</label>
            <textarea id="share-list-body" value={body} onChange={e => setBody(e.target.value.slice(0, 2000))} rows={3} autoFocus
              placeholder="Ex.: fiz minha tier list dos Souls, podem discordar 😅"
              className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-primary outline-none focus:border-accent resize-y" style={{ fontSize: 16 }} />
            {error && <p role="alert" className="text-movies text-sm mt-2">{error}</p>}
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border-strong text-secondary hover:text-primary">Cancelar</button>
              <button type="button" onClick={share} disabled={busy} className="px-4 py-2 rounded-lg bg-accent text-bg font-semibold hover:opacity-90 disabled:opacity-60">
                {busy ? 'Compartilhando…' : 'Compartilhar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
