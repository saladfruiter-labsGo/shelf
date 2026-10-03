import { useEffect } from 'react'
import { Link, useLocation, useParams } from 'react-router-dom'
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Avatar } from '../components/Avatar'
import { Composer } from '../components/social/Composer'
import { PostCard } from '../components/social/PostCard'
import type { FeedPage } from '../types'

/** Fileira de pessoas da instância, com atalho para o perfil de cada uma. */
function People() {
  const { user } = useAuth()
  const { data: people = [] } = useQuery({ queryKey: ['users'], queryFn: api.users.list, staleTime: 5 * 60_000 })
  const others = people.filter(p => p.id !== user.id)
  if (!others.length) return null
  return (
    <nav aria-label="Pessoas" className="flex gap-4 overflow-x-auto pb-2 mb-6">
      {others.map(p => (
        <Link key={p.id} to={`/u/${p.username}`} className="flex flex-col items-center gap-1.5 flex-shrink-0 w-16 group">
          <Avatar name={p.display_name} url={p.avatar_url} id={p.id} size={52} />
          <span className="text-xs text-secondary truncate w-full text-center group-hover:text-primary">{p.display_name.split(' ')[0]}</span>
        </Link>
      ))}
    </nav>
  )
}

/** Lista paginada de posts (feed geral ou de uma pessoa). */
export function PostList({ author, emptyText }: { author?: string; emptyText: string }) {
  const { user } = useAuth()
  const query = useInfiniteQuery({
    queryKey: ['feed', author ?? 'all'],
    queryFn: ({ pageParam }) => api.feed.list({ before: pageParam, author }),
    initialPageParam: null as string | null,
    getNextPageParam: (last: FeedPage) => last.next,
    refetchInterval: 60_000,
  })
  const posts = query.data?.pages.flatMap(p => p.posts) ?? []

  if (query.isLoading) return <p className="text-muted text-center py-10">Carregando…</p>
  if (query.error) return <p className="text-movies text-center py-10">{(query.error as Error).message}</p>
  if (!posts.length) return <p className="text-muted text-center py-10" style={{ fontSize: 16 }}>{emptyText}</p>

  return (
    <div className="space-y-4">
      {posts.map(post => <PostCard key={post.id} post={post} me={user.id} />)}
      {query.hasNextPage && (
        <button type="button" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}
          className="w-full py-3 rounded-xl border border-border text-secondary hover:text-primary hover:border-accent">
          {query.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
        </button>
      )}
    </div>
  )
}

export function Feed() {
  const qc = useQueryClient()
  return (
    <div className="px-4 sm:px-6 py-8 max-w-2xl mx-auto">
      <header className="mb-6">
        <h1 className="font-display text-3xl font-bold text-primary mb-1">Feed</h1>
        <p className="text-muted" style={{ fontSize: 16 }}>O que a turma anda vendo, jogando, lendo — e falando sobre isso.</p>
      </header>
      <People />
      <div className="social-card mb-6">
        <Composer
          allowImages
          placeholder="Compartilhe algo… (@ marca alguém, 🎬 marca uma mídia)"
          onSubmit={async (value) => {
            await api.feed.create(value)
            await qc.invalidateQueries({ queryKey: ['feed'] })
          }}
        />
      </div>
      <PostList emptyText="Ainda não há nada por aqui. Registre algo no diário ou escreva o primeiro post!" />
    </div>
  )
}

/** Um post só, com os comentários abertos (destino das notificações). */
export function FeedPostPage() {
  const { id } = useParams()
  const { user } = useAuth()
  const location = useLocation()
  const { data, error, isLoading } = useQuery({ queryKey: ['feed-post', id], queryFn: () => api.feed.get(Number(id)) })
  const qc = useQueryClient()

  useEffect(() => {
    if (data) qc.setQueryData(['feed-comments', data.post.id], data.comments)
  }, [data, qc])

  useEffect(() => {
    if (!data || !location.hash) return
    requestAnimationFrame(() => document.getElementById(location.hash.slice(1))?.scrollIntoView({ block: 'center' }))
  }, [data, location.hash])

  return (
    <div className="px-4 sm:px-6 py-8 max-w-2xl mx-auto">
      <Link to="/feed" className="text-sm text-muted hover:text-primary">← Voltar ao feed</Link>
      <div className="mt-4">
        {isLoading && <p className="text-muted">Carregando…</p>}
        {error && <p className="text-muted" style={{ fontSize: 16 }}>Esse post não existe mais.</p>}
        {data && <PostCard post={data.post} me={user.id} defaultOpenComments onDeleted={() => history.back()} />}
      </div>
    </div>
  )
}
