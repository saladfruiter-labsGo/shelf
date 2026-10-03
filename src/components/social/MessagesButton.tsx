import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'

function MailIcon() {
  return (
    <svg width="17" height="17" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 7l9 6 9-6"/>
    </svg>
  )
}

/** Atalho para as mensagens diretas, com as não lidas (atualiza a cada 30 s). */
export function MessagesButton() {
  const { data } = useQuery({ queryKey: ['dm-unread'], queryFn: api.messages.unread, refetchInterval: 30_000 })
  const unread = data?.unread ?? 0
  return (
    <Link
      to="/messages"
      aria-label={unread ? `Mensagens: ${unread} não lidas` : 'Mensagens'}
      className="icon-btn"
      style={{
        width: 36, height: 36, borderRadius: '50%', position: 'relative',
        border: '1px solid var(--border-strong)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted)',
      }}
    >
      <MailIcon />
      {unread > 0 && (
        <span aria-hidden style={{
          position: 'absolute', top: -4, right: -4, minWidth: 18, height: 18, padding: '0 5px', borderRadius: 9,
          background: 'var(--accent)', color: '#000', fontSize: 11, fontWeight: 700, lineHeight: '18px', textAlign: 'center',
        }}>{unread > 99 ? '99+' : unread}</span>
      )}
    </Link>
  )
}
