import { Link, useParams } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { imageUrl } from '../lib/images'
import { formatDate } from '../lib/utils'
import { Avatar } from '../components/Avatar'
import { CategoryTag } from '../components/CategoryTag'
import { useMediaPreview } from '../components/MediaSummaryModal'
import { PostList } from './Feed'

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="social-card" style={{ padding: 14 }}>
      <p className="font-display font-bold text-primary" style={{ fontSize: 24, lineHeight: 1 }}>{value}</p>
      <p className="text-sm text-secondary mt-1.5">{label}</p>
    </div>
  )
}

const MODE_LABEL: Record<string, string> = { tier: 'Tier list', ranking: 'Ranking', list: 'Lista' }

/** Perfil de uma pessoa da instância: números, favoritos, listas compartilhadas e posts. */
export function UserProfile() {
  const { username = '' } = useParams()
  const { openMedia } = useMediaPreview()
  const { data, error, isLoading } = useQuery({ queryKey: ['social-user', username], queryFn: () => api.social.user(username) })

  if (isLoading) return <p className="text-muted text-center py-16">Carregando…</p>
  if (error || !data) return <p className="text-muted text-center py-16" style={{ fontSize: 16 }}>Pessoa não encontrada.</p>

  const { profile, shared_lists: lists, is_me: isMe } = data
  const u = profile.user

  return (
    <div className="px-4 sm:px-6 py-8 max-w-3xl mx-auto">
      <header className="flex items-center gap-5 flex-wrap mb-8">
        <Avatar name={u.display_name} url={u.avatar_url} id={u.id ?? 0} size={96} />
        <div className="min-w-0 flex-1">
          <h1 className="font-display font-extrabold text-primary" style={{ fontSize: 'clamp(30px,4vw,44px)', lineHeight: 1.05, letterSpacing: '-1px' }}>
            {u.display_name}
          </h1>
          {u.bio && <p className="text-secondary mt-2" style={{ fontSize: 16 }}>{u.bio}</p>}
          <p className="text-sm text-muted mt-2">
            @{u.username} · No Shelf desde {formatDate(u.member_since)}
            {profile.accounts.steam && (
              <> · <a href={profile.accounts.steam.profile_url} target="_blank" rel="noopener noreferrer" className="hover:underline">Steam: {profile.accounts.steam.persona}</a></>
            )}
          </p>
          {isMe
            ? <Link to="/account" className="inline-block text-sm text-accent hover:underline mt-2">✎ Editar meu perfil</Link>
            : <Link to={`/messages/${u.username}`} className="inline-flex items-center gap-2 mt-3 px-4 py-2 rounded-lg border border-border-strong text-primary hover:border-accent">✉️ Mandar mensagem</Link>}
        </div>
      </header>

      <div className="grid gap-3 mb-10" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))' }}>
        <Stat value={profile.totals.library} label="na biblioteca" />
        <Stat value={profile.totals.diary} label="registros no diário" />
        <Stat value={profile.totals.rated} label="com nota" />
        <Stat value={`${profile.games.played_hours}h`} label="de jogo" />
        <Stat value={profile.games.completed_total} label="jogos zerados" />
        {profile.games.achievements_unlocked > 0 && <Stat value={profile.games.achievements_unlocked} label="conquistas" />}
      </div>

      {profile.favorites.length > 0 && (
        <section className="mb-10" aria-labelledby="u-favs">
          <h2 id="u-favs" className="font-display text-xl font-bold text-primary mb-3">Favoritos</h2>
          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(104px, 1fr))' }}>
            {profile.favorites.map(f => (
              <button key={f.id} type="button" className="text-left"
                onClick={() => openMedia({ type: f.type as never, title: f.title, cover_url: f.cover_url })}>
                <span className="block relative rounded-lg overflow-hidden bg-card mb-1.5" style={{ aspectRatio: '2/3', border: `1px solid ${f.favorite === 2 ? 'var(--gold)' : 'var(--border)'}` }}>
                  {f.cover_url && <img src={imageUrl(f.cover_url, 240) ?? ''} alt="" loading="lazy" className="w-full h-full object-cover" />}
                  <span className="absolute top-1.5 left-1.5"><CategoryTag type={f.type as never} size="sm" /></span>
                  {f.favorite === 2 && <span className="absolute top-1.5 right-1.5" aria-label="Destaque">👑</span>}
                </span>
                <span className="block text-sm text-primary leading-tight">{f.title}</span>
              </button>
            ))}
          </div>
        </section>
      )}

      {lists.length > 0 && (
        <section className="mb-10" aria-labelledby="u-lists">
          <h2 id="u-lists" className="font-display text-xl font-bold text-primary mb-3">Listas compartilhadas</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {lists.map(l => (
              <li key={l.list_id}>
                <Link to={`/u/${u.username}/lists/${l.list_id}`} className="social-card flex items-center justify-between gap-3 hover:border-accent" style={{ padding: 14 }}>
                  <span className="text-primary font-medium truncate" style={{ fontSize: 16 }}>{l.name}</span>
                  <span className="text-xs text-muted whitespace-nowrap">{MODE_LABEL[l.mode] ?? 'Lista'} · {l.item_count}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="u-posts">
        <h2 id="u-posts" className="font-display text-xl font-bold text-primary mb-3">Atividade</h2>
        <PostList author={u.username ?? username} emptyText={isMe ? 'Você ainda não tem nada no feed.' : `${u.display_name} ainda não tem nada no feed.`} />
      </section>
    </div>
  )
}
