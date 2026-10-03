import { useEffect, useRef, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { timeAgo } from '../lib/utils'
import { Avatar } from '../components/Avatar'
import { Composer } from '../components/social/Composer'
import { RichText } from '../components/social/RichText'
import { LibraryPicker, SharedItemCard } from '../components/social/SharedItem'
import type { ConversationThread, DirectMessage, MediaItem } from '../types'

function Conversations({ active }: { active?: string }) {
  const navigate = useNavigate()
  const { user } = useAuth()
  const [picking, setPicking] = useState(false)
  const { data: conversations = [], isLoading } = useQuery({ queryKey: ['dm-conversations'], queryFn: api.messages.conversations, refetchInterval: 30_000 })
  const { data: people = [] } = useQuery({ queryKey: ['users'], queryFn: api.users.list, staleTime: 5 * 60_000 })
  const others = people.filter(p => p.id !== user.id)

  return (
    <aside className="social-card p-0 overflow-hidden" aria-label="Conversas">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h2 className="font-medium text-primary">Conversas</h2>
        <button type="button" onClick={() => setPicking(p => !p)} aria-expanded={picking} className="text-sm text-accent hover:underline">
          + Nova
        </button>
      </div>
      {picking && (
        <div className="px-3 py-2 border-b border-border">
          {others.length === 0 && <p className="text-sm text-muted p-2">Ainda não há outras pessoas no Shelf.</p>}
          {others.map(p => (
            <button key={p.id} type="button" onClick={() => { setPicking(false); navigate(`/messages/${p.username}`) }}
              className="w-full flex items-center gap-2 px-2 py-2 rounded-lg hover:bg-card text-left">
              <Avatar name={p.display_name} url={p.avatar_url} id={p.id} size={30} />
              <span className="text-primary" style={{ fontSize: 15 }}>{p.display_name}</span>
              <span className="text-muted text-sm">@{p.username}</span>
            </button>
          ))}
        </div>
      )}
      <ul className="max-h-[60vh] overflow-y-auto">
        {isLoading && <li className="text-sm text-muted p-4">Carregando…</li>}
        {!isLoading && conversations.length === 0 && (
          <li className="text-sm text-muted p-4">Nenhuma conversa ainda. Comece uma em "+ Nova" ou use "Enviar para um amigo" na página de uma mídia.</li>
        )}
        {conversations.map(c => (
          <li key={c.id}>
            <Link to={`/messages/${c.other.username}`} aria-current={active === c.other.username ? 'page' : undefined}
              className={`flex items-center gap-3 px-4 py-3 hover:bg-card ${active === c.other.username ? 'bg-card' : ''}`}>
              <Avatar name={c.other.display_name} url={c.other.avatar_url} id={c.other.id} size={40} />
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline justify-between gap-2">
                  <span className={`truncate ${c.unread ? 'text-primary font-semibold' : 'text-primary'}`} style={{ fontSize: 15 }}>{c.other.display_name}</span>
                  <span className="text-xs text-muted flex-shrink-0">{timeAgo(c.last_message_at)}</span>
                </span>
                <span className={`block text-sm truncate ${c.unread ? 'text-secondary' : 'text-muted'}`}>
                  {c.last ? `${c.last.mine ? 'Você: ' : ''}${c.last.text}` : ''}
                </span>
              </span>
              {c.unread > 0 && (
                <span className="min-w-[20px] h-5 px-1.5 rounded-full bg-accent text-bg text-xs font-bold flex items-center justify-center" aria-label={`${c.unread} não lidas`}>
                  {c.unread}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
    </aside>
  )
}

function Bubble({ message, otherName, onDelete }: { message: DirectMessage; otherName: string; onDelete: () => void }) {
  if (message.deleted) {
    return (
      <div className={`flex ${message.mine ? 'justify-end' : 'justify-start'}`}>
        <p className="text-sm text-muted italic px-3 py-1">Mensagem apagada</p>
      </div>
    )
  }
  return (
    <div className={`group flex flex-col gap-1.5 ${message.mine ? 'items-end' : 'items-start'}`}>
      {message.media && <SharedItemCard item={message.media} senderName={otherName} mine={message.mine} />}
      {message.body && (
        <div className={`rounded-2xl px-3.5 py-2 max-w-[85%] ${message.mine ? 'bg-accent-bg border border-border-strong' : 'bg-card'}`}>
          <RichText body={message.body} refs={message.refs} className="text-primary" />
        </div>
      )}
      <span className="text-xs text-muted flex items-center gap-2">
        {timeAgo(message.created_at)}
        {message.mine && (
          <button type="button" onClick={onDelete} className="opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-movies">Apagar</button>
        )}
      </span>
    </div>
  )
}

function Thread({ username }: { username: string }) {
  const qc = useQueryClient()
  const [older, setOlder] = useState<DirectMessage[]>([])
  const [hasMoreOlder, setHasMoreOlder] = useState<boolean | null>(null)
  const [attach, setAttach] = useState<MediaItem | null>(null)
  const [picking, setPicking] = useState(false)
  const endRef = useRef<HTMLDivElement>(null)
  const { data, error, isLoading } = useQuery({
    queryKey: ['dm-thread', username],
    queryFn: () => api.messages.thread(username),
    refetchInterval: 8_000,
  })

  useEffect(() => { setOlder([]); setHasMoreOlder(null); setAttach(null) }, [username])

  // Abrir a conversa marca como lida: atualiza a lista e o contador da barra.
  const lastId = data?.messages[data.messages.length - 1]?.id
  useEffect(() => {
    if (!data) return
    qc.invalidateQueries({ queryKey: ['dm-conversations'] })
    qc.invalidateQueries({ queryKey: ['dm-unread'] })
    endRef.current?.scrollIntoView({ block: 'end' })
  }, [lastId, qc, data])

  if (isLoading) return <div className="social-card text-muted">Carregando…</div>
  if (error || !data) return <div className="social-card text-muted" style={{ fontSize: 16 }}>Pessoa não encontrada.</div>

  const messages = [...older, ...data.messages]
  const moreAvailable = hasMoreOlder ?? data.has_more

  const loadOlder = async () => {
    const first = messages[0]
    if (!first) return
    const page = await api.messages.thread(username, first.id)
    setOlder(prev => [...page.messages, ...prev])
    setHasMoreOlder(page.has_more)
  }

  const remove = async (id: number) => {
    const updated = await api.messages.remove(id)
    setOlder(prev => prev.map(m => m.id === id ? updated : m))
    qc.setQueryData<ConversationThread>(['dm-thread', username], prev => prev && { ...prev, messages: prev.messages.map(m => m.id === id ? updated : m) })
  }

  return (
    <section className="social-card p-0 flex flex-col" style={{ minHeight: '60vh' }} aria-label={`Conversa com ${data.other.display_name}`}>
      <header className="flex items-center gap-3 px-4 py-3 border-b border-border">
        <Link to="/messages" className="md:hidden text-muted hover:text-primary pr-1" aria-label="Voltar às conversas">←</Link>
        <Link to={`/u/${data.other.username}`} className="flex items-center gap-3 hover:underline">
          <Avatar name={data.other.display_name} url={data.other.avatar_url} id={data.other.id} size={36} />
          <span>
            <span className="block text-primary font-medium" style={{ fontSize: 16 }}>{data.other.display_name}</span>
            <span className="block text-xs text-muted">@{data.other.username}</span>
          </span>
        </Link>
      </header>

      <div className="flex-1 overflow-y-auto px-4 py-4 space-y-4" style={{ maxHeight: '60vh' }}>
        {moreAvailable && (
          <div className="text-center">
            <button type="button" onClick={loadOlder} className="text-sm text-accent hover:underline">Carregar anteriores</button>
          </div>
        )}
        {messages.length === 0 && (
          <p className="text-muted text-center py-10" style={{ fontSize: 16 }}>
            Comece a conversa — ou mande um item da sua biblioteca pelo botão 📚.
          </p>
        )}
        {messages.map(m => <Bubble key={m.id} message={m} otherName={data.other.display_name} onDelete={() => remove(m.id)} />)}
        <div ref={endRef} />
      </div>

      <div className="border-t border-border px-4 py-3 relative">
        {attach && (
          <div className="flex items-center gap-2 mb-2">
            <span className="social-chip">📚 {attach.title}</span>
            <button type="button" className="text-sm text-muted hover:text-primary" onClick={() => setAttach(null)} aria-label="Tirar item anexado">×</button>
          </div>
        )}
        {picking && <LibraryPicker onClose={() => setPicking(false)} onPick={item => { setAttach(item); setPicking(false) }} />}
        <Composer
          compact
          allowEmpty={!!attach}
          placeholder={attach ? 'Diga por que recomenda (opcional)…' : `Mensagem para ${data.other.display_name}…`}
          submitLabel="Enviar"
          extraActions={(
            <button type="button" className="social-action" onClick={() => setPicking(p => !p)} aria-expanded={picking}>
              <span aria-hidden>📚</span><span>Da biblioteca</span>
            </button>
          )}
          onSubmit={async ({ body, refs }) => {
            const sent = await api.messages.send(username, { body, refs, media_item_id: attach?.id })
            setAttach(null)
            qc.setQueryData<ConversationThread>(['dm-thread', username], prev => prev && { ...prev, messages: [...prev.messages, sent] })
            qc.invalidateQueries({ queryKey: ['dm-conversations'] })
          }}
        />
      </div>
    </section>
  )
}

/** Mensagens diretas: lista de conversas e a conversa aberta. */
export function Messages() {
  const { username } = useParams()
  return (
    <div className="px-4 sm:px-6 py-8 max-w-5xl mx-auto">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold text-primary mb-1">Mensagens</h1>
        <p className="text-muted" style={{ fontSize: 16 }}>Conversas a dois — e um jeito rápido de recomendar algo da sua biblioteca.</p>
      </header>
      <div className="grid gap-4 md:grid-cols-[320px_1fr]">
        <div className={username ? 'hidden md:block' : ''}><Conversations active={username} /></div>
        <div className={username ? '' : 'hidden md:block'}>
          {username
            ? <Thread username={username} />
            : <div className="social-card text-muted text-center py-16" style={{ fontSize: 16 }}>Escolha uma conversa.</div>}
        </div>
      </div>
    </div>
  )
}
