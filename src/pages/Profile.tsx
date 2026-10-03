import { Link } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { imageUrl } from '../lib/images'
import { TYPE_LABEL, fmtRating, formatDate, formatPercent, timeAgoLong } from '../lib/utils'
import { CategoryTag } from '../components/CategoryTag'
import { SourceBadge } from '../components/SourceBadge'
import type { ProfileDataSource, ProfileView } from '../types'

const eyebrow: React.CSSProperties = {
  fontSize: 11, fontWeight: 600, letterSpacing: '2.5px', textTransform: 'uppercase', color: 'var(--text-muted)',
}
const sectionTitle: React.CSSProperties = {
  fontFamily: 'Space Grotesk, sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)',
  display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
}
const card: React.CSSProperties = {
  background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20,
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]!.toUpperCase()).join('') || '?'
}

/** Selo só quando o número inteiro veio da Steam. */
function badge(source: ProfileDataSource) {
  return <SourceBadge source={source === 'steam' ? 'steam' : null} />
}

function Stat({ value, label, source }: { value: number | string; label: string; source?: ProfileDataSource }) {
  return (
    <div style={{ ...card, padding: 16 }}>
      <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 28, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
        {value}
      </p>
      <p style={{ fontSize: 13, color: 'var(--text-secondary)', marginTop: 6, display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
        {label} {source && badge(source)}
      </p>
    </div>
  )
}

function ProfileHeader({ view }: { view: ProfileView }) {
  const { user, accounts } = view
  const avatarUrl = imageUrl(user.avatar_url, 320)

  return (
    <header style={{ display: 'flex', gap: 24, alignItems: 'center', flexWrap: 'wrap', marginBottom: 40 }}>
      <div style={{ position: 'relative', flexShrink: 0 }}>
        {avatarUrl ? (
          <img src={avatarUrl} alt="" width={96} height={96}
            style={{ width: 96, height: 96, borderRadius: '50%', objectFit: 'cover', border: '1px solid var(--border-strong)' }} />
        ) : (
          <div aria-hidden="true" style={{
            width: 96, height: 96, borderRadius: '50%', background: 'var(--accent-bg)', color: 'var(--accent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontFamily: 'Space Grotesk, sans-serif', fontSize: 34, fontWeight: 700,
          }}>
            {initials(user.display_name)}
          </div>
        )}
        {user.avatar_source === 'steam' && (
          <span style={{ position: 'absolute', bottom: -4, left: '50%', transform: 'translateX(-50%)' }}>
            <SourceBadge source="steam" />
          </span>
        )}
      </div>

      <div style={{ flex: '1 1 260px', minWidth: 0 }}>
        <p style={{ ...eyebrow, marginBottom: 8 }}>Perfil</p>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(36px,5vw,60px)', fontWeight: 800, letterSpacing: '-1.5px', lineHeight: 1.05, color: 'var(--text-primary)', overflowWrap: 'anywhere' }}>
          {user.display_name}
        </h1>
        {user.bio && <p style={{ fontSize: 16, color: 'var(--text-secondary)', marginTop: 10, maxWidth: 560 }}>{user.bio}</p>}
        <p style={{ fontSize: 14, color: 'var(--text-muted)', marginTop: 8 }}>
          {user.username ? `@${user.username} · ` : ''}No Shelf desde {formatDate(user.member_since)}
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 12 }}>
          <Link to="/account" className="link-accent" style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
            ✎ Editar perfil e foto
          </Link>
          {accounts.steam && (
            <a href={accounts.steam.profile_url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              {accounts.steam.persona || 'Perfil na Steam'} <SourceBadge source="steam" />
            </a>
          )}
        </div>
      </div>
    </header>
  )
}

export function Profile() {
  const { data: view, isLoading, isError, refetch } = useQuery({ queryKey: ['profile'], queryFn: api.profile.get })

  const page: React.CSSProperties = { maxWidth: 1280, margin: '0 auto', padding: '64px var(--page-x) 80px' }

  if (isLoading) {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
        <div style={page}>
          <div className="animate-pulse" style={{ height: 96, width: 320, maxWidth: '100%', background: 'var(--card)', borderRadius: 12 }} />
        </div>
      </div>
    )
  }
  if (isError || !view) {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
        <div style={page}>
          <p style={{ color: 'var(--text-secondary)', fontSize: 16 }}>Não foi possível carregar o perfil.</p>
          <button type="button" onClick={() => refetch()} className="link-accent"
            style={{ marginTop: 8, background: 'none', border: 'none', padding: 0, cursor: 'pointer', fontSize: 14 }}>
            Tentar de novo
          </button>
        </div>
      </div>
    )
  }

  const { totals, games, shelf_by_year: years } = view
  const currentYear = games.year

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', color: 'var(--text-primary)' }}>
      <div style={page}>
        <ProfileHeader key={`${view.user.display_name}|${view.user.avatar_url}`} view={view} />

        {/* Números gerais */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12, marginBottom: 48 }}>
          <Stat value={totals.library} label="na biblioteca" />
          <Stat value={totals.diary} label="registros no diário" />
          <Stat value={totals.rated} label="com nota" />
          <Stat value={totals.wishlist} label="na wishlist" />
          <Stat value={totals.backlog} label="no backlog" />
        </div>

        {/* Games */}
        <section aria-labelledby="perfil-games" style={{ marginBottom: 48 }}>
          <h2 id="perfil-games" style={sectionTitle}>🎮 Games</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 12 }}>
            <Stat value={`${games.played_hours}h`} label="jogadas" source={games.played_source} />
            <Stat value={games.completed_this_year} label={`zerados em ${currentYear}`} source={games.completed_source} />
            <Stat value={games.platinum_this_year} label={`platinados em ${currentYear}`} source={games.completed_source} />
            <Stat value={games.completed_total} label="zerados no total" source={games.completed_source} />
            <Stat value={games.playing} label="jogando agora" />
            <Stat value={games.backlog} label="no backlog" />
            {games.achievements_unlocked > 0 && <Stat value={games.achievements_unlocked} label="conquistas" source="steam" />}
          </div>
          {games.rarest_achievement && (
            <p style={{ fontSize: 14, color: 'var(--text-secondary)', marginTop: 12, display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center' }}>
              Conquista mais rara: <strong style={{ color: 'var(--text-primary)' }}>{games.rarest_achievement.name}</strong>
              em <Link to={`/games/${games.rarest_achievement.media_item_id}`} style={{ color: 'var(--text-primary)' }}>{games.rarest_achievement.game}</Link>
              <span style={{ color: 'var(--text-muted)' }}>· {formatPercent(games.rarest_achievement.percent)} dos jogadores</span>
              <SourceBadge source="steam" />
            </p>
          )}
        </section>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: 24, marginBottom: 48 }}>
          {/* Prateleira por ano */}
          <section aria-labelledby="perfil-anos" style={card}>
            <h2 id="perfil-anos" style={sectionTitle}>Prateleira por ano</h2>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontVariantNumeric: 'tabular-nums' }}>
              <thead>
                <tr style={{ ...eyebrow, fontSize: 10, letterSpacing: '1.5px' }}>
                  <th scope="col" style={{ textAlign: 'left', paddingBottom: 10, fontWeight: 600 }}>Ano</th>
                  <th scope="col" style={{ textAlign: 'right', paddingBottom: 10, fontWeight: 600 }}>Total</th>
                  <th scope="col" style={{ textAlign: 'right', paddingBottom: 10, fontWeight: 600 }}>Concluídos</th>
                  <th scope="col" style={{ textAlign: 'right', paddingBottom: 10, fontWeight: 600 }}>Em andamento</th>
                </tr>
              </thead>
              <tbody>
                {years.map(y => (
                  <tr key={y.year} style={{ borderTop: '1px solid var(--border)', opacity: y.total === 0 ? 0.4 : 1 }}>
                    <th scope="row" style={{ textAlign: 'left', padding: '12px 0', fontWeight: 500, fontSize: 14, color: y.year === currentYear ? 'var(--accent)' : 'var(--text-secondary)' }}>
                      {y.year}
                    </th>
                    <td style={{ textAlign: 'right', fontFamily: 'Space Grotesk, sans-serif', fontSize: 20, fontWeight: 700 }}>{y.total}</td>
                    <td style={{ textAlign: 'right', fontSize: 15, color: 'var(--accent)' }}>{y.completed}</td>
                    <td style={{ textAlign: 'right', fontSize: 15, color: 'var(--v)' }}>{y.in_progress}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>

          {/* Notas recentes */}
          <section aria-labelledby="perfil-notas" style={card}>
            <h2 id="perfil-notas" style={sectionTitle}>Notas recentes</h2>
            {view.recent_ratings.length === 0 ? (
              <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Nada avaliado ainda.</p>
            ) : (
              <ul style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                {view.recent_ratings.map(r => (
                  <li key={r.id}>
                    <Link to={`/media/${r.media_item_id}`} style={{ display: 'flex', gap: 12, alignItems: 'center', color: 'inherit', textDecoration: 'none' }}>
                      <span style={{ width: 36, height: 54, borderRadius: 6, overflow: 'hidden', background: 'var(--card)', flexShrink: 0 }}>
                        {r.cover_url && <img src={imageUrl(r.cover_url, 160)!} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                      </span>
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <span style={{ display: 'block', fontSize: 15, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.title}</span>
                        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>{TYPE_LABEL[r.type]} · {timeAgoLong(r.watched_at)}</span>
                      </span>
                      <span style={{ color: 'var(--gold)', fontWeight: 700, fontSize: 15 }} aria-label={`Nota ${fmtRating(r.rating)}`}>★ {fmtRating(r.rating)}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Favoritos */}
        <section aria-labelledby="perfil-favoritos" style={{ marginBottom: 48 }}>
          <h2 id="perfil-favoritos" style={sectionTitle}>Favoritos</h2>
          {view.favorites.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Marque favoritos na página de cada mídia para eles aparecerem aqui.</p>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))', gap: 16 }}>
              {view.favorites.map(f => (
                <Link key={f.id} to={`/media/${f.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                  <div style={{ aspectRatio: '2/3', borderRadius: 10, overflow: 'hidden', background: 'var(--card)', border: `1px solid ${f.favorite === 2 ? 'var(--gold)' : 'var(--border)'}`, position: 'relative', marginBottom: 8 }}>
                    {f.cover_url && <img src={imageUrl(f.cover_url, 320)!} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />}
                    <span style={{ position: 'absolute', top: 6, left: 6 }}><CategoryTag type={f.type} size="sm" /></span>
                    {f.favorite === 2 && <span style={{ position: 'absolute', top: 6, right: 6 }} aria-label="Destaque da categoria">👑</span>}
                  </div>
                  <p style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.25 }}>{f.title}</p>
                </Link>
              ))}
            </div>
          )}
        </section>

        {/* Atividade */}
        <section aria-labelledby="perfil-atividade" style={card}>
          <h2 id="perfil-atividade" style={sectionTitle}>Atividade recente</h2>
          {view.activity.length === 0 ? (
            <p style={{ fontSize: 14, color: 'var(--text-muted)' }}>Nada registrado ainda pelas integrações.</p>
          ) : (
            <ul style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {view.activity.map(a => (
                <li key={a.id} style={{ display: 'flex', gap: 10, alignItems: 'baseline', flexWrap: 'wrap', fontSize: 14 }}>
                  <span style={{ fontWeight: 600 }}>{a.title}</span>
                  {a.subtitle && <span style={{ color: 'var(--text-muted)' }}>{a.subtitle}</span>}
                  <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>· {timeAgoLong(a.occurred_at)}</span>
                  {a.source === 'steam' && <SourceBadge source="steam" />}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}
