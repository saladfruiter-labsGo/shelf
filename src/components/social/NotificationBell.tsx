import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { timeAgo } from '../../lib/utils'
import { Avatar } from '../Avatar'
import type { NotificationItem } from '../../types'

function describe(n: NotificationItem): string {
  switch (n.type) {
    case 'comment':  return 'comentou no seu post'
    case 'reply':    return 'respondeu seu comentário'
    case 'reaction': return `reagiu ${n.detail ?? ''} ${n.comment_id ? 'ao seu comentário' : 'ao seu post'}`.replace(/\s+/g, ' ')
    case 'mention':  return n.comment_id ? 'marcou você num comentário' : 'marcou você num post'
    case 'dm':       return 'mandou uma mensagem'
  }
}

function BellIcon() {
  return (
    <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M18 8a6 6 0 10-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.73 21a2 2 0 01-3.46 0"/>
    </svg>
  )
}

/** Sino da barra superior: contador a cada 30 s, lista ao abrir. */
export function NotificationBell() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)
  const { data: count } = useQuery({ queryKey: ['notifications-count'], queryFn: api.notifications.count, refetchInterval: 30_000 })
  const { data: list } = useQuery({ queryKey: ['notifications'], queryFn: api.notifications.list, enabled: open })
  const unread = count?.unread ?? 0

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const sync = (result: { unread: number; items: NotificationItem[] }) => {
    qc.setQueryData(['notifications'], result)
    qc.setQueryData(['notifications-count'], { unread: result.unread })
  }

  const go = async (n: NotificationItem) => {
    setOpen(false)
    if (!n.read) sync(await api.notifications.read([n.id]))
    if (n.type === 'dm' && n.actor) navigate(`/messages/${n.actor.username}`)
    else if (n.post_id) navigate(`/feed/${n.post_id}${n.comment_id ? `#c${n.comment_id}` : ''}`)
  }

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        aria-label={unread ? `Notificações: ${unread} não lidas` : 'Notificações'}
        aria-expanded={open}
        className="icon-btn"
        style={{
          width: 36, height: 36, borderRadius: '50%', position: 'relative',
          background: 'transparent', border: '1px solid var(--border-strong)',
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)',
        }}
      >
        <BellIcon />
        {unread > 0 && (
          <span aria-hidden style={{
            position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
            background: 'var(--movies)', color: '#fff', fontSize: 11, fontWeight: 700, lineHeight: '18px', textAlign: 'center',
          }}>{unread > 99 ? '99+' : unread}</span>
        )}
      </button>

      {open && (
        <div className="social-popover" style={{ right: 0, left: 'auto', width: 'min(360px, calc(100vw - 32px))', top: 'calc(100% + 8px)' }}>
          <div className="flex items-center justify-between px-1 pb-2 border-b border-border mb-1">
            <span className="font-medium text-primary">Notificações</span>
            {unread > 0 && (
              <button type="button" className="text-sm text-accent hover:underline" onClick={async () => sync(await api.notifications.read())}>
                Marcar tudo como lido
              </button>
            )}
          </div>
          <div className="max-h-[420px] overflow-y-auto">
            {!list && <p className="text-sm text-muted p-3">Carregando…</p>}
            {list && !list.items.length && <p className="text-sm text-muted p-3">Nada por aqui ainda.</p>}
            {list?.items.map(n => (
              <button key={n.id} type="button" onClick={() => go(n)}
                className={`w-full flex gap-3 items-start text-left rounded-lg px-2 py-2.5 hover:bg-card ${n.read ? '' : 'bg-accent-bg'}`}>
                <Avatar name={n.actor?.display_name ?? '?'} url={n.actor?.avatar_url} id={n.actor?.id ?? 0} size={34} />
                <span className="min-w-0 flex-1">
                  <span className="block text-primary" style={{ fontSize: 15 }}>
                    <b>{n.actor?.display_name ?? 'Alguém'}</b> {describe(n)}
                  </span>
                  {n.snippet && <span className="block text-sm text-muted truncate">“{n.snippet}”</span>}
                  <span className="block text-xs text-muted">{timeAgo(n.created_at)}</span>
                </span>
                {!n.read && <span className="w-2 h-2 rounded-full bg-accent mt-2 flex-shrink-0" aria-label="não lida" />}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
