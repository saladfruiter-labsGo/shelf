import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { imageUrl } from '../lib/images'
import {
  GAME_STATUSES, GAME_STATUS_LABEL, GAME_STATUS_STYLE, gameStatusOf, formatDate, formatPlaytime, fmtRating,
} from '../lib/utils'
import { StarRating } from '../components/StarRating'
import { SourceBadge } from '../components/SourceBadge'
import { PricePanel } from '../components/PricePanel'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { AddToListDropdown } from '../components/AddToListDropdown'
import { isGameCompletion } from '../lib/diary'
import type { MediaItem, SteamStorePage } from '../types'

const label = 'text-xs text-muted uppercase tracking-wide'

/** Galeria de screenshots com visualização ampliada (Esc fecha). */
function Screenshots({ shots, title }: { shots: SteamStorePage['screenshots']; title: string }) {
  const [open, setOpen] = useState<number | null>(null)
  useEffect(() => {
    if (open == null) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(null)
      if (e.key === 'ArrowRight') setOpen(i => (i == null ? i : (i + 1) % shots.length))
      if (e.key === 'ArrowLeft') setOpen(i => (i == null ? i : (i - 1 + shots.length) % shots.length))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, shots.length])

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))', gap: 8 }}>
        {shots.map((shot, i) => (
          <button key={shot.full} type="button" onClick={() => setOpen(i)} aria-label={`Ampliar screenshot ${i + 1} de ${title}`}
            className="rounded-lg overflow-hidden border border-border hover:border-border-strong transition-colors"
            style={{ aspectRatio: '16/9', padding: 0, background: 'var(--card)', cursor: 'zoom-in' }}>
            <img src={imageUrl(shot.thumb, 320)!} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
          </button>
        ))}
      </div>
      {open != null && (
        <div role="dialog" aria-modal="true" aria-label={`Screenshot ${open + 1} de ${shots.length}`}
          className="fixed inset-0 z-[300] flex items-center justify-center p-4"
          style={{ background: 'rgba(0,0,0,.85)' }} onClick={() => setOpen(null)}>
          <img src={imageUrl(shots[open].full, 1024)!} alt={`Screenshot ${open + 1} de ${title}`}
            style={{ maxWidth: '100%', maxHeight: '90vh', borderRadius: 8 }} />
          <button type="button" onClick={() => setOpen(null)} aria-label="Fechar"
            style={{ position: 'absolute', top: 16, right: 16, width: 40, height: 40, borderRadius: '50%', background: 'rgba(0,0,0,.6)', color: '#fff', border: '1px solid rgba(255,255,255,.3)', fontSize: 22, cursor: 'pointer' }}>
            ×
          </button>
        </div>
      )}
    </>
  )
}

/**
 * Trailer: MP4/WebM toca na página. A Steam hoje entrega a maioria só em
 * DASH/HLS, que o navegador não toca sem biblioteca extra — nesse caso a capa
 * leva ao trailer na própria loja.
 */
function Trailer({ movie, poster, storeUrl }: { movie: SteamStorePage['movies'][number]; poster: string | null; storeUrl: string }) {
  const image = imageUrl(poster ?? movie.thumbnail, 1024)
  if (movie.mp4 || movie.webm) {
    return (
      <figure style={{ margin: 0 }}>
        <video controls preload="none" poster={image ?? undefined}
          style={{ width: '100%', borderRadius: 10, background: '#000', aspectRatio: '16/9' }}>
          {movie.mp4 && <source src={movie.mp4} type="video/mp4" />}
          {movie.webm && <source src={movie.webm} type="video/webm" />}
        </video>
        <figcaption className="text-sm text-muted mt-2">{movie.name}</figcaption>
      </figure>
    )
  }
  return (
    <a href={storeUrl} target="_blank" rel="noopener noreferrer" aria-label={`Assistir ${movie.name} na Steam`}
      className="block rounded-xl overflow-hidden border border-border hover:border-border-strong transition-colors"
      style={{ position: 'relative', aspectRatio: '16/9', background: '#000' }}>
      {image && <img src={image} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.75 }} />}
      <span aria-hidden="true" style={{
        position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
        width: 64, height: 64, borderRadius: '50%', background: 'rgba(0,0,0,.65)', color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, border: '1px solid rgba(255,255,255,.4)',
      }}>▶</span>
      <span style={{ position: 'absolute', left: 12, bottom: 10, right: 12, color: '#fff', fontSize: 14, fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,.8)' }}>
        {movie.name} · assistir na Steam ↗
      </span>
    </a>
  )
}

function ProgressStat({ title, value, source, color }: { title: string; value: string; source?: MediaItem['playtime_source']; color?: string }) {
  return (
    <div>
      <p className={`${label} mb-1 flex flex-wrap items-center gap-x-2 gap-y-1`}>
        <span className="whitespace-nowrap">{title}</span> {source !== undefined && <SourceBadge source={source} />}
      </p>
      <p className="font-display text-lg font-bold" style={{ color: color ?? 'var(--text-primary)' }}>{value}</p>
    </div>
  )
}

export function GameDetail() {
  const { id } = useParams<{ id: string }>()
  const mediaId = Number(id)
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [editRelease, setEditRelease] = useState(false)
  const [releaseInput, setReleaseInput] = useState('')

  const { data: item, isLoading } = useQuery({
    queryKey: ['media', id],
    queryFn: () => api.media.get(mediaId),
    enabled: Number.isInteger(mediaId) && mediaId > 0,
  })
  const { data: history = [] } = useQuery({
    queryKey: ['diary', 'media', id],
    queryFn: () => api.diary.list({ media_item_id: mediaId }),
    enabled: !!item,
  })
  const { data: store, isLoading: loadingStore } = useQuery({
    queryKey: ['game-steam', id],
    queryFn: async () => {
      const result = await api.games.steam(mediaId)
      // A primeira visita completa sinopse/gênero/empresas no card: recarrega a mídia.
      if (result.filled) qc.invalidateQueries({ queryKey: ['media', id] })
      return result
    },
    enabled: !!item?.steam_appid,
    staleTime: 60 * 60_000,
  })
  const page = store?.available ? store.page : null

  const update = useMutation({
    mutationFn: (data: Parameters<typeof api.media.update>[1]) => api.media.update(mediaId, data),
    onSuccess: updated => {
      qc.setQueryData(['media', id], (current: MediaItem | undefined) => ({ ...current, ...updated }))
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
      qc.invalidateQueries({ queryKey: ['profile'] })
    },
  })
  const remove = useMutation({
    mutationFn: () => api.media.remove(mediaId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      qc.invalidateQueries({ queryKey: ['diary'] })
      navigate(-1)
    },
  })

  // Se alguém abrir /games/:id de algo que não é jogo, manda para o detalhe genérico.
  useEffect(() => {
    if (item && item.type !== 'game') navigate(`/media/${item.id}`, { replace: true })
  }, [item, navigate])

  if (isLoading) {
    return (
      <div className="px-6 py-8 animate-pulse" style={{ maxWidth: 1280, margin: '0 auto' }}>
        <div className="h-64 bg-card rounded-xl mb-6" />
        <div className="h-4 bg-card rounded w-1/2" />
      </div>
    )
  }
  if (!item || item.type !== 'game') return <div className="px-6 py-8 text-muted">Jogo não encontrado.</div>

  const status = gameStatusOf(item)
  const finished = status === 'zerado' || status === 'platinado'
  const inWishlist = item.status === 'wishlist' && status !== 'backlog'
  const backdrop = imageUrl(page?.background ?? page?.screenshots[0]?.full ?? null, 1024)
  const genres = page?.genres.length ? page.genres.join(', ') : item.genre
  const synopsis = item.synopsis ?? page?.short_description ?? null
  const completions = history.filter(isGameCompletion)

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh', color: 'var(--text-primary)' }}>
      {/* Hero */}
      <div style={{ position: 'relative', overflow: 'hidden', borderBottom: '1px solid var(--border)' }}>
        {backdrop && (
          <img src={backdrop} alt="" aria-hidden="true"
            style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', filter: 'blur(2px)', opacity: 0.35, transform: 'scale(1.03)' }} />
        )}
        <div style={{ position: 'absolute', inset: 0, background: 'linear-gradient(180deg, color-mix(in srgb, var(--bg) 30%, transparent) 0%, var(--bg) 100%)' }} />

        <div style={{ position: 'relative', maxWidth: 1280, margin: '0 auto', padding: '32px var(--page-x) 40px' }}>
          <button onClick={() => navigate(-1)} className="text-muted hover:text-primary text-sm mb-6 transition-colors"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            ← Voltar
          </button>
          <div style={{ display: 'flex', gap: 28, flexWrap: 'wrap', alignItems: 'flex-end' }}>
            <div style={{ width: 'min(200px, 40vw)', aspectRatio: '2/3', borderRadius: 12, overflow: 'hidden', background: 'var(--card)', border: '1px solid var(--border-strong)', flexShrink: 0, boxShadow: 'var(--shadow-lg)' }}>
              {item.cover_url
                ? <img src={imageUrl(item.cover_url, 640)!} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 48 }}>🎮</div>}
            </div>
            <div style={{ flex: '1 1 300px', minWidth: 0 }}>
              <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '3px', textTransform: 'uppercase', color: 'var(--games)', marginBottom: 12 }}>Jogo</p>
              <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(32px,5vw,60px)', fontWeight: 800, lineHeight: 1.05, letterSpacing: '-1.5px', overflowWrap: 'anywhere' }}>
                {item.title}
              </h1>
              <p className="text-secondary" style={{ fontSize: 16, marginTop: 10 }}>
                {[item.year ?? page?.year, genres].filter(Boolean).join(' · ')}
              </p>
              {(item.creators || item.publisher) && (
                <p className="text-muted" style={{ fontSize: 14, marginTop: 4 }}>
                  {[item.creators, item.publisher && item.publisher !== item.creators ? item.publisher : null].filter(Boolean).join(' · ')}
                </p>
              )}
              <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center', marginTop: 16 }}>
                <span style={{ fontSize: 12, fontWeight: 600, borderRadius: 9999, padding: '4px 12px', color: GAME_STATUS_STYLE[status].color, background: GAME_STATUS_STYLE[status].bg }}>
                  {GAME_STATUS_LABEL[status]}
                </span>
                {item.rating > 0 && <span style={{ color: 'var(--gold)', fontWeight: 700 }}>★ {fmtRating(item.rating)}</span>}
                {page?.metacritic && (
                  <span title="Nota no Metacritic" style={{ fontSize: 12, fontWeight: 700, borderRadius: 6, padding: '3px 8px', border: '1px solid var(--border-strong)' }}>
                    Metacritic {page.metacritic.score}
                  </span>
                )}
                {page && (
                  <a href={page.store_url} target="_blank" rel="noopener noreferrer" className="text-sm text-secondary hover:text-primary">
                    Ver na Steam ↗
                  </a>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Corpo */}
      <div className="game-body" style={{ maxWidth: 1280, margin: '0 auto', padding: '32px var(--page-x) 80px' }}>
        {/* Coluna principal */}
        <div style={{ minWidth: 0 }}>
          {(synopsis || loadingStore) && (
            <section aria-labelledby="game-sobre" className="mb-8">
              <h2 id="game-sobre" className={`${label} mb-2`}>Sobre</h2>
              {synopsis
                ? <p className="text-secondary" style={{ fontSize: 16, lineHeight: 1.6 }}>{synopsis}</p>
                : <div className="h-4 bg-card rounded w-3/4 animate-pulse" />}
            </section>
          )}

          {page && page.movies.length > 0 && (
            <section aria-labelledby="game-trailer" className="mb-8">
              <h2 id="game-trailer" className={`${label} mb-3`}>Trailer</h2>
              <Trailer movie={page.movies.find(m => m.mp4 || m.webm) ?? page.movies[0]}
                poster={page.screenshots[0]?.full ?? null} storeUrl={page.store_url} />
            </section>
          )}

          {page && page.screenshots.length > 0 && (
            <section aria-labelledby="game-screens" className="mb-8">
              <h2 id="game-screens" className={`${label} mb-3`}>Screenshots</h2>
              <Screenshots shots={page.screenshots} title={item.title} />
            </section>
          )}

          {inWishlist && <PricePanel mediaItemId={item.id} title={item.title} />}

          <section aria-labelledby="game-diario" className="mb-8">
            <h2 id="game-diario" className={`${label} mb-2`}>Histórico no diário · {history.length}</h2>
            {history.length === 0 ? (
              <p className="text-sm text-muted">Nenhuma sessão registrada ainda.</p>
            ) : (
              <ul className="border-t border-border">
                {history.map(entry => (
                  <li key={entry.id} className="flex gap-4 py-3 border-b border-border">
                    <span className="font-display text-xs text-muted whitespace-nowrap pt-0.5 w-24 flex-shrink-0">{formatDate(entry.watched_at)}</span>
                    <div className="min-w-0 flex-1 text-sm flex flex-wrap items-center gap-x-2 gap-y-1">
                      {isGameCompletion(entry)
                        ? <span className="font-semibold" style={{ color: 'var(--series)' }}>Zerado</span>
                        : entry.progress_value != null
                          ? <span className="text-secondary">Jogou · {formatPlaytime(entry.progress_value)} no total</span>
                          : <span className="text-secondary">Registrado</span>}
                      {entry.rating != null && entry.rating > 0 && <span style={{ color: 'var(--accent)' }}>★ {fmtRating(entry.rating)}</span>}
                      {entry.source === 'steam' && <SourceBadge source="steam" />}
                      {entry.comment && <p className="w-full text-secondary italic">“{entry.comment}”</p>}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>

        {/* Lateral: o seu jogo */}
        <aside aria-label="Seu jogo" className="game-side bg-surface border border-border rounded-xl p-5" style={{ minWidth: 0 }}>
          <div className="mb-5">
            <p className={`${label} mb-2 flex items-center gap-2`}>Status <SourceBadge source={item.game_status_source} /></p>
            <div className="flex flex-wrap gap-1.5">
              {GAME_STATUSES.map(s => (
                <button key={s} type="button" onClick={() => update.mutate({ game_status: s })} aria-pressed={status === s}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    status === s ? 'bg-accent text-bg' : 'bg-card text-muted hover:text-primary border border-border'
                  }`}>
                  {GAME_STATUS_LABEL[s]}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted mt-2">Escolher aqui vira status manual: a Steam não muda mais por cima.</p>
          </div>

          <div className="mb-5">
            <p className={`${label} mb-1`}>Sua nota</p>
            <StarRating value={item.rating} size="lg" onChange={v => update.mutate({ rating: v })} />
          </div>

          {((item.playtime_seconds ?? 0) > 0 || item.last_played_at || (finished && item.completed_at)) && (
            <div className="mb-5 grid grid-cols-2 gap-4">
              {(item.playtime_seconds ?? 0) > 0 && (
                <ProgressStat title="Tempo de jogo" value={formatPlaytime(item.playtime_seconds!)} source={item.playtime_source} color="var(--games)" />
              )}
              {item.last_played_at && <ProgressStat title="Última vez" value={formatDate(item.last_played_at)} source={item.playtime_source} />}
              {finished && item.completed_at && (
                <ProgressStat title={status === 'platinado' ? 'Platinado em' : 'Zerado em'} value={formatDate(item.completed_at)} />
              )}
              {completions.length > 1 && <ProgressStat title="Vezes zerado" value={String(completions.length)} />}
            </div>
          )}

          <dl className="mb-5 text-sm" style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 12px' }}>
            {item.creators && <><dt className="text-muted">Desenvolvedor</dt><dd className="text-secondary">{item.creators}</dd></>}
            {item.publisher && <><dt className="text-muted">Distribuidora</dt><dd className="text-secondary">{item.publisher}</dd></>}
            {page?.release_date && <><dt className="text-muted">Lançamento</dt><dd className="text-secondary">{page.release_date}</dd></>}
            {item.library && <><dt className="text-muted">Loja</dt><dd className="text-secondary">{item.library}</dd></>}
          </dl>

          {inWishlist && (
            <div className="mb-5 flex flex-wrap items-center gap-3">
              <button type="button" onClick={() => update.mutate({ hype: item.hype ? 0 : 1 })} aria-pressed={!!item.hype}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                  item.hype ? 'bg-accent-bg border-accent text-accent' : 'bg-card border-border text-muted hover:text-primary'
                }`}>
                🔥 Hype
              </button>
              {editRelease ? (
                <span className="flex items-center gap-2">
                  <input type="date" value={releaseInput} onChange={e => setReleaseInput(e.target.value)} aria-label="Data de lançamento"
                    className="bg-card border border-border rounded px-2 py-1 text-xs text-primary outline-none focus:border-accent" />
                  <button type="button" className="text-xs text-accent hover:underline"
                    onClick={() => { update.mutate({ release_date: releaseInput || (null as any) }); setEditRelease(false) }}>Salvar</button>
                  <button type="button" className="text-xs text-muted hover:text-primary" onClick={() => setEditRelease(false)} aria-label="Cancelar">×</button>
                </span>
              ) : (
                <button type="button" onClick={() => { setReleaseInput(item.release_date ?? ''); setEditRelease(true) }}
                  className="text-xs text-muted hover:text-primary transition-colors">
                  {item.release_date ? `📅 ${formatDate(item.release_date)}` : '+ Data de lançamento'}
                </button>
              )}
            </div>
          )}

          <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-border">
            <AddToListDropdown itemId={item.id} />
            <button type="button" onClick={() => setConfirmRemove(true)} disabled={remove.isPending}
              className="ml-auto text-xs text-muted hover:text-red-400 transition-colors">
              Remover
            </button>
          </div>
        </aside>
      </div>

      <style>{`
        .game-body { display: grid; grid-template-columns: minmax(0, 2fr) minmax(300px, 1fr); gap: 32px; align-items: start; }
        @media (max-width: 900px) {
          .game-body { grid-template-columns: minmax(0, 1fr); }
          .game-side { order: -1; }
        }
      `}</style>

      <ConfirmDialog
        open={confirmRemove}
        title="Remover jogo"
        message={`Remover "${item.title}" e todos os seus registros do diário? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        danger
        busy={remove.isPending}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => remove.mutate()}
      />
    </div>
  )
}
