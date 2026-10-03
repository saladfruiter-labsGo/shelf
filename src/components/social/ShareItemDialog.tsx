import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { Avatar } from '../Avatar'

/**
 * "Enviar para um amigo": manda um item da biblioteca por mensagem direta,
 * com um comentário. Abre a partir da página da mídia ou do jogo.
 */
export function ShareItemDialog({ mediaItemId, title, open, onClose }: {
  mediaItemId: number
  title: string
  open: boolean
  onClose: () => void
}) {
  const { user } = useAuth()
  const qc = useQueryClient()
  const { data: people = [] } = useQuery({ queryKey: ['users'], queryFn: api.users.list, staleTime: 5 * 60_000, enabled: open })
  const [to, setTo] = useState<string | null>(null)
  const [body, setBody] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sentTo, setSentTo] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setTo(null); setBody(''); setError(null); setSentTo(null)
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', esc)
    return () => window.removeEventListener('keydown', esc)
  }, [open, onClose])

  if (!open) return null
  const others = people.filter(p => p.id !== user.id)

  const send = async () => {
    if (!to) return setError('Escolha para quem enviar.')
    setBusy(true)
    setError(null)
    try {
      await api.messages.send(to, { body: body.trim(), media_item_id: mediaItemId })
      qc.invalidateQueries({ queryKey: ['dm-conversations'] })
      qc.invalidateQueries({ queryKey: ['dm-thread', to] })
      setSentTo(to)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" aria-labelledby="share-item-title" className="relative w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl p-6">
        {sentTo ? (
          <>
            <h2 id="share-item-title" className="text-lg font-bold text-primary mb-2">Enviado! ✉️</h2>
            <p className="text-secondary mb-5" style={{ fontSize: 16 }}>"{title}" foi para a conversa com @{sentTo}, com a sua nota e o seu status junto.</p>
            <div className="flex gap-2 justify-end">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border-strong text-secondary hover:text-primary">Fechar</button>
              <Link to={`/messages/${sentTo}`} className="px-4 py-2 rounded-lg bg-accent text-bg font-semibold hover:opacity-90">Abrir conversa</Link>
            </div>
          </>
        ) : (
          <>
            <h2 id="share-item-title" className="text-lg font-bold text-primary mb-1">Enviar "{title}"</h2>
            <p className="text-sm text-muted mb-4">Vai por mensagem direta, só para a pessoa escolhida.</p>
            {others.length === 0 ? (
              <p className="text-secondary mb-4" style={{ fontSize: 16 }}>Ainda não há outras pessoas no Shelf.</p>
            ) : (
              <fieldset className="mb-4">
                <legend className="text-sm font-medium text-secondary mb-2">Para</legend>
                <div className="flex flex-wrap gap-2">
                  {others.map(p => (
                    <button key={p.id} type="button" onClick={() => setTo(p.username)} aria-pressed={to === p.username}
                      className={`flex items-center gap-2 pl-1 pr-3 py-1 rounded-full border ${to === p.username ? 'border-accent bg-accent-bg text-primary' : 'border-border text-secondary hover:border-accent'}`}>
                      <Avatar name={p.display_name} url={p.avatar_url} id={p.id} size={28} />
                      <span style={{ fontSize: 15 }}>{p.display_name}</span>
                    </button>
                  ))}
                </div>
              </fieldset>
            )}
            <label htmlFor="share-item-body" className="block text-sm font-medium text-secondary mb-1.5">Comentário (opcional)</label>
            <textarea id="share-item-body" rows={3} value={body} onChange={e => setBody(e.target.value.slice(0, 2000))}
              placeholder="Ex.: acho que você vai curtir esse!"
              className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-primary outline-none focus:border-accent resize-y" style={{ fontSize: 16 }} />
            {error && <p role="alert" className="text-movies text-sm mt-2">{error}</p>}
            <div className="flex gap-2 justify-end mt-4">
              <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-border-strong text-secondary hover:text-primary">Cancelar</button>
              <button type="button" onClick={send} disabled={busy || !others.length}
                className="px-4 py-2 rounded-lg bg-accent text-bg font-semibold hover:opacity-90 disabled:opacity-60">
                {busy ? 'Enviando…' : 'Enviar'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}
