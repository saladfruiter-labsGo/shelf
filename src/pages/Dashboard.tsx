import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { CATEGORIES } from '../lib/categories'
import { imageUrl } from '../lib/images'
import { TYPE_LABEL, TYPE_COLOR, GAME_STATUS_LABEL, gameStatusOf, formatPlaytime, formatRuntime, fmtRating, formatMoney, timeAgo, toISODate, todayISODate, daysUntil } from '../lib/utils'
import type { MediaItem, MediaType, TrendingItem, DiaryEntry, GamePriceSummary, UnratedSeason } from '../types'
import { MediaPreviewTrigger, useMediaPreview } from '../components/MediaSummaryModal'
import { StarRating } from '../components/StarRating'

const TYPE_EMOJI: Record<MediaType, string> = { movie: '🎬', series: '📺', game: '🎮', book: '📚', music: '🎵' }
const hue = (t: MediaType) => `var(--${TYPE_COLOR[t]})`
const coverBg = (t: MediaType) => `linear-gradient(160deg, ${hue(t)}, color-mix(in srgb, ${hue(t)} 28%, #0b0b16))`

const byRecent = (a: MediaItem, b: MediaItem) =>
  new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime()

function relTime(iso: string): string {
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (d <= 0) return 'hoje'
  if (d === 1) return 'ontem'
  if (d < 7) return `há ${d} dias`
  const w = Math.floor(d / 7)
  if (w < 5) return `há ${w} semana${w > 1 ? 's' : ''}`
  const mo = Math.floor(d / 30)
  if (mo < 12) return `há ${mo} ${mo > 1 ? 'meses' : 'mês'}`
  const y = Math.floor(d / 365)
  return `há ${y} ano${y > 1 ? 's' : ''}`
}

/** Capa da mídia com fallback (gradiente + emoji da categoria). */
function Cover({ url, type, w, h, radius = 8, font = 22 }: { url: string | null; type: MediaType; w: number; h: number; radius?: number; font?: number }) {
  const [broken, setBroken] = useState(false)
  const base = { width: w, height: h, borderRadius: radius, flexShrink: 0 } as const
  if (url && !broken)
    return <img src={imageUrl(url, Math.max(160, w * 2))!} alt="" onError={() => setBroken(true)} style={{ ...base, objectFit: 'cover', display: 'block' }} />
  return <div style={{ ...base, display: 'grid', placeItems: 'center', color: '#fff', fontSize: font, background: coverBg(type) }}>{TYPE_EMOJI[type]}</div>
}

/** Barra de progresso de um item "em andamento" (varia por tipo). */
function contMeta(item: MediaItem): { pct: number | null; left: string; right: string } {
  if (item.type === 'book') {
    const pct = item.pages_total ? (item.pages_read ?? 0) / item.pages_total : (item.progress ?? 0)
    return { pct, left: item.pages_total ? `${item.pages_read ?? 0} / ${item.pages_total} págs` : 'lendo', right: `${Math.round(pct * 100)}%` }
  }
  if (item.type === 'series') {
    const pct = item.progress ?? 0
    return { pct, left: 'em andamento', right: `${Math.round(pct * 100)}%` }
  }
  if (item.type === 'game') {
    return { pct: null, left: formatPlaytime(item.playtime_seconds ?? 0), right: GAME_STATUS_LABEL[gameStatusOf(item)] }
  }
  const pct = item.progress ?? 0
  return { pct, left: 'em andamento', right: `${Math.round(pct * 100)}%` }
}

function SectionHead({ title, extra, action, onAction }: { title: React.ReactNode; extra?: React.ReactNode; action?: string; onAction?: () => void }) {
  return (
    <div className="sec-head">
      <h2>{title}{extra}</h2>
      {action && <button className="seeall" onClick={onAction}>{action}</button>}
    </div>
  )
}

const Empty = ({ children }: { children: React.ReactNode }) => (
  <p style={{ color: 'var(--text-muted)', fontSize: 14, padding: '8px 0' }}>{children}</p>
)

/* ─── Banner "Favoritos" ─── */

/** Capa em pôster (2:3) que preenche a largura do card, com o mesmo fallback do Cover. */
function Poster({ url, type }: { url: string | null; type: MediaType }) {
  const [broken, setBroken] = useState(false)
  if (url && !broken) return <img className="art" src={imageUrl(url, 640)!} alt="" onError={() => setBroken(true)} />
  return <div className="art fb" style={{ background: coverBg(type) }}>{TYPE_EMOJI[type]}</div>
}

/** Rodapé do pôster: tempo (jogo ou duração) à esquerda, sua nota à direita. */
function favMeta(it: MediaItem): { time: string | null; rating: string | null } {
  const time = it.type === 'game'
    ? ((it.playtime_seconds ?? 0) > 0 ? formatPlaytime(it.playtime_seconds!) : null)
    : (it.runtime ? formatRuntime(it.runtime) : null)
  return { time, rating: it.rating > 0 ? fmtRating(it.rating) : null }
}

/** Vagas de favorito por categoria — o mesmo limite que o servidor aplica. */
const FAV_MAX = 5
/** Qual colocação ocupa cada vaga: o destaque no centro, os seguintes alternando os lados. */
const FAV_LAYOUT = [3, 1, 0, 2, 4]
/** `favorite = 2` é o destaque escolhido à mão — a capa coroada do centro. */
const FAV_TOP = 2

/**
 * Uma faixa horizontal com as cinco vagas de favoritos. O destaque — escolhido
 * na coroa de cada capa, ou, enquanto ninguém escolheu, o de maior nota — ganha
 * moldura dourada e um pôster maior no centro. Vaga vazia é o botão de
 * adicionar; o × de cada pôster tira dali.
 */
function FavRow({ label, type, items, busy, onAdd, onRemove, onCrown, onSeeAll }: {
  label: string; type: MediaType; items: MediaItem[]; busy: boolean
  onAdd: () => void; onRemove: (item: MediaItem) => void; onCrown: (item: MediaItem) => void; onSeeAll: () => void
}) {
  // O #1 ocupa a vaga do meio e os outros se abrem para os lados, em ordem de
  // nota: a coroa fica no centro da faixa, não na ponta.
  const slots = FAV_LAYOUT.map(rank => items[rank] ?? null)
  const noun = type === 'movie' ? 'filme' : 'jogo'
  return (
    <section className="favrow" style={{ ['--fav' as string]: hue(type) }}>
      <div className="fav-head">
        <i />
        <h2>{label}</h2>
        <span className="n">{items.length}/{FAV_MAX}</span>
        <button className="seeall" onClick={onSeeAll}>Ver biblioteca →</button>
      </div>
      <div className="fav-strip">
        {slots.map((it, i) => it ? (
          <MediaPreviewTrigger media={it} label={`Abrir resumo de ${it.title}`} className={`fav-card${FAV_LAYOUT[i] === 0 ? ' top' : ''}`} key={it.id}>
            {FAV_LAYOUT[i] === 0 && <span className="crown" aria-hidden>👑</span>}
            <div className="shot">
              <Poster url={it.cover_url} type={it.type} />
              <div className="acts">
                {FAV_LAYOUT[i] !== 0 && (
                  <button
                    className="mk"
                    disabled={busy}
                    aria-label={`Definir ${it.title} como destaque`}
                    title="Definir como destaque"
                    onClick={e => { e.stopPropagation(); onCrown(it) }}
                  >👑</button>
                )}
                <button
                  className="rm"
                  disabled={busy}
                  aria-label={`Remover ${it.title} dos favoritos`}
                  title="Remover dos favoritos"
                  onClick={e => { e.stopPropagation(); onRemove(it) }}
                >×</button>
              </div>
              {(() => {
                const m = favMeta(it)
                return (m.time || m.rating) && (
                  <div className="foot">
                    {m.time && <span>🕘 {m.time}</span>}
                    {m.rating && <span className="rt">★ {m.rating}</span>}
                  </div>
                )
              })()}
            </div>
            <div className="ttl">{it.title}</div>
          </MediaPreviewTrigger>
        ) : (
          <button className="fav-card fav-add" key={`empty-${i}`} onClick={onAdd} disabled={busy} aria-label={`Escolher ${noun} favorito`}>
            <div className="shot"><span className="plus">+</span><span className="lb">Adicionar</span></div>
            <div className="ttl" />
          </button>
        ))}
      </div>
    </section>
  )
}

/** Escolha de um item da biblioteca para ocupar uma vaga do banner. */
function FavPicker({ type, items, busy, onPick, onClose }: {
  type: MediaType; items: MediaItem[]; busy: boolean
  onPick: (item: MediaItem) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const term = q.trim().toLowerCase()
  const shown = items.filter(i => !term || i.title.toLowerCase().includes(term)).slice(0, 60)

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="relative w-full max-w-2xl bg-surface border border-border rounded-2xl shadow-2xl animate-scale-in p-6">
        <h2 className="text-lg font-bold text-primary mb-1">
          Escolher {type === 'movie' ? 'filme' : 'jogo'} favorito
        </h2>
        <p className="text-sm text-muted mb-4">Da sua biblioteca. São {FAV_MAX} vagas por categoria.</p>
        <input
          autoFocus
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Buscar pelo título..."
          className="w-full bg-card border border-border rounded-lg px-3 py-2 text-sm text-primary outline-none focus:border-accent mb-4"
        />
        <div className="fav-pick-grid">
          {shown.map(it => (
            <button className="fav-pick" key={it.id} disabled={busy} onClick={() => onPick(it)}>
              <Poster url={it.cover_url} type={it.type} />
              <span className="nm">{it.title}</span>
            </button>
          ))}
          {shown.length === 0 && (
            <p className="text-sm text-muted col-span-full">
              {items.length ? 'Nenhum título com esse nome.' : 'Nada disponível na biblioteca ainda.'}
            </p>
          )}
        </div>
        <div className="flex justify-end mt-5">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:text-primary border border-border hover:border-border-strong transition-colors">
            Fechar
          </button>
        </div>
      </div>
    </div>
  )
}

/* ─── Carrossel "Em alta no público" ─── */
function TrendingCarousel({ items }: { items: TrendingItem[] }) {
  const { openMedia } = useMediaPreview()
  const [i, setI] = useState(0)
  const n = items.length
  const go = (k: number) => setI(((k % n) + n) % n)
  useEffect(() => {
    if (n < 2) return
    const t = setInterval(() => setI(p => (p + 1) % n), 5000)
    return () => clearInterval(t)
  }, [n])
  if (!n) return null
  return (
    <section className="hc-carousel" onMouseEnter={e => (e.currentTarget.dataset.pause = '1')}>
      <div className="hc-track" style={{ transform: `translateX(-${i * 100}%)` }}>
        {items.map((t, k) => {
          const cover = imageUrl(t.cover_url, 1024)
          return (
          <div
            className="hc-slide media-preview-card"
            key={k}
            role="button"
            tabIndex={0}
            aria-label={`Abrir resumo de ${t.title}`}
            onClick={() => openMedia({
              type: t.type,
              title: t.title,
              subtitle: t.subtitle,
              cover_url: t.cover_url,
              statusLabel: `${t.metric} ${t.metric_label}`,
            })}
            onKeyDown={event => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault()
                openMedia({
                  type: t.type,
                  title: t.title,
                  subtitle: t.subtitle,
                  cover_url: t.cover_url,
                  statusLabel: `${t.metric} ${t.metric_label}`,
                })
              }
            }}
          >
            <div className="hc-glow" style={{ background: `radial-gradient(circle at 80% 30%, color-mix(in srgb, ${hue(t.type)} 55%, transparent), transparent 55%), linear-gradient(115deg, color-mix(in srgb, ${hue(t.type)} 22%, #0b0b16), #0b0b16 65%)${cover ? `, url(${cover})` : ''}`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            <div className="hc-inner">
              <span className="hc-flag" style={{ color: hue(t.type) }}>{TYPE_EMOJI[t.type]} Em alta · {TYPE_LABEL[t.type]}</span>
              <h3>{t.title}</h3>
              <div className="hc-metrics">
                <div><div className="hc-n" style={{ color: hue(t.type) }}>{t.metric}</div><div className="hc-l">{t.metric_label}</div></div>
                {t.subtitle && <div><div className="hc-n">{t.subtitle}</div><div className="hc-l">{t.type === 'music' ? 'artista' : 'ano'}</div></div>}
              </div>
            </div>
          </div>
          )
        })}
      </div>
      {n > 1 && <>
        <button className="hc-btn prev" aria-label="Anterior" onClick={() => go(i - 1)}>‹</button>
        <button className="hc-btn next" aria-label="Próximo" onClick={() => go(i + 1)}>›</button>
        <div className="hc-dots">{items.map((_, k) => <button key={k} className={k === i ? 'on' : ''} aria-label={`Slide ${k + 1}`} onClick={() => go(k)} />)}</div>
      </>}
    </section>
  )
}

export function Dashboard() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const now = new Date()
  const [picking, setPicking] = useState<MediaType | null>(null)

  const { data: allItems = [] } = useQuery({ queryKey: ['media-library'], queryFn: () => api.media.listAll({ library: true }) })
  const { data: diary = [] } = useQuery({ queryKey: ['diary-all'], queryFn: () => api.diary.list() })
  const { data: unratedSeasons = [] } = useQuery({ queryKey: ['series-unrated'], queryFn: api.series.unrated })
  const { data: upcoming } = useQuery({ queryKey: ['media-upcoming'], queryFn: () => api.media.upcoming() })
  const { data: musicStats } = useQuery({ queryKey: ['music-stats'], queryFn: api.integrations.musicStats })
  const { data: lists = [] } = useQuery({ queryKey: ['lists'], queryFn: api.lists.list })
  const { data: trending = [] } = useQuery({ queryKey: ['trending'], queryFn: api.integrations.trending, staleTime: 3_600_000 })
  const { data: wrap } = useQuery({ queryKey: ['wrap-month', now.getFullYear(), now.getMonth() + 1], queryFn: () => api.wrap({ period: 'monthly', year: now.getFullYear(), month: now.getMonth() + 1 }) })
  const { data: prices } = useQuery({ queryKey: ['prices', 'backlog'], queryFn: api.prices.backlog, staleTime: 60_000 })

  /* ─── derivações ─── */
  // Contador da biblioteca por categoria: tudo que já foi consumido — concluído,
  // em andamento ou abandonado. Só a wishlist fica de fora (ela mora em /wishlist).
  const libraryCount = (t: MediaType) => allItems.reduce((n, i) => n + (i.type === t ? 1 : 0), 0)

  /**
   * Favoritos marcados à mão (coluna `favorite`). O destaque coroado vem sempre
   * primeiro; enquanto ninguém escolheu um, a maior nota assume o centro. O
   * tempo jogado desempata jogos com a mesma nota; o resto cai na atualização.
   */
  const favorites = useMemo(() => {
    const pick = (t: MediaType) => allItems
      .filter(i => i.type === t && (i.favorite ?? 0) > 0)
      .sort((a, b) =>
        (b.favorite ?? 0) - (a.favorite ?? 0) ||
        b.rating - a.rating ||
        (b.playtime_seconds ?? 0) - (a.playtime_seconds ?? 0) ||
        byRecent(a, b))
      .slice(0, FAV_MAX)
    return { movie: pick('movie'), game: pick('game') }
  }, [allItems])

  const favMutation = useMutation({
    mutationFn: ({ id, favorite }: { id: number; favorite: 0 | 1 | 2 }) => api.media.update(id, { favorite }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['media-library'] }),
  })

  /** Candidatos do seletor: a biblioteca daquele tipo que ainda não é favorita. */
  const pickable = useMemo(() => {
    if (!picking) return []
    return allItems
      .filter(i => i.type === picking && !i.favorite)
      .sort((a, b) => b.rating - a.rating || a.title.localeCompare(b.title, 'pt-BR'))
  }, [allItems, picking])

  const continueItems = useMemo(
    () => allItems.filter(i => i.status === 'in_progress').sort(byRecent).slice(0, 4),
    [allItems],
  )
  const droppedItems = useMemo(
    () => allItems.filter(i => i.status === 'dropped').sort(byRecent).slice(0, 4),
    [allItems],
  )
  const seasonRatingMutation = useMutation({
    mutationFn: ({ mediaItemId, seasonNumber, rating }: { mediaItemId: number; seasonNumber: number; rating: number }) =>
      api.series.quickRate(mediaItemId, seasonNumber, rating),
    onSuccess: (_updated, rated) => {
      qc.setQueryData<UnratedSeason[]>(['series-unrated'], current =>
        current?.filter(season => season.media_item_id !== rated.mediaItemId || season.season_number !== rated.seasonNumber) ?? [])
      qc.invalidateQueries({ queryKey: ['diary'] })
      qc.invalidateQueries({ queryKey: ['diary-all'] })
      qc.invalidateQueries({ queryKey: ['series', rated.mediaItemId] })
      qc.invalidateQueries({ queryKey: ['wrap'] })
    },
  })

  const emBreve = useMemo(() => {
    const today = todayISODate()
    const seen = new Set<number>()
    const pool = [...(upcoming?.hype ?? []), ...(upcoming?.wishlist ?? [])]
      .filter(it => it.release_date && toISODate(it.release_date) > today)
    const out: MediaItem[] = []
    for (const it of pool) { if (seen.has(it.id)) continue; seen.add(it.id); out.push(it) }
    out.sort((a, b) => new Date(a.release_date!).getTime() - new Date(b.release_date!).getTime())
    return out.slice(0, 4)
  }, [upcoming])

  /**
   * Ofertas ativas dos jogos do backlog. Menor histórico primeiro, depois maior
   * desconto — é o que faz alguém largar tudo e ir comprar.
   */
  const deals = useMemo(() => {
    if (!prices?.enabled) return []          // integração desligada não mostra preço velho
    const byId = new Map(allItems.map(i => [i.id, i]))
    return (prices?.items ?? [])
      .filter((p): p is GamePriceSummary & { best: NonNullable<GamePriceSummary['best']> } => !!p.best)
      .map(p => ({ price: p, item: byId.get(p.media_item_id) }))
      .filter((d): d is { price: typeof d.price; item: MediaItem } => !!d.item)
      .sort((a, b) =>
        Number(b.price.is_history_low) - Number(a.price.is_history_low) ||
        b.price.best.discount_percent - a.price.best.discount_percent ||
        a.price.best.price_minor - b.price.best.price_minor)
      .slice(0, 4)
  }, [prices, allItems])

  const dealCount = (prices?.items ?? []).filter(p => p.best && p.best.discount_percent > 0).length

  const recentDiary = useMemo(
    () => [...diary].sort((a, b) => new Date(b.watched_at).getTime() - new Date(a.watched_at).getTime()).slice(0, 6),
    [diary],
  )

  const nesteDia = useMemo(() => {
    const md = `${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
    const y = now.getFullYear()
    return diary
      .filter(d => toISODate(d.watched_at).slice(5) === md && new Date(d.watched_at).getFullYear() < y)
      .sort((a, b) => new Date(b.watched_at).getTime() - new Date(a.watched_at).getTime())
      .slice(0, 4)
  }, [diary, now])

  /* Heatmap estilo GitHub + streak, derivados do diário. */
  const heat = useMemo(() => {
    const counts = new Map<string, number>()
    for (const d of diary) { const k = toISODate(d.watched_at); counts.set(k, (counts.get(k) ?? 0) + 1) }
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const start = new Date(today); start.setDate(start.getDate() - 364); start.setDate(start.getDate() - start.getDay())
    const cells: number[] = []
    let active = 0
    for (const d = new Date(start); d <= today; d.setDate(d.getDate() + 1)) {
      const c = counts.get(toISODate(d.toISOString())) ?? 0
      cells.push(c === 0 ? 0 : c === 1 ? 1 : c === 2 ? 2 : c <= 4 ? 3 : 4)
      if (c > 0) active++
    }
    // streak atual (até hoje) e melhor sequência do período
    let streak = 0
    for (const cur = new Date(today); (counts.get(toISODate(cur.toISOString())) ?? 0) > 0; cur.setDate(cur.getDate() - 1)) streak++
    let best = 0, run = 0
    for (const lv of cells) { run = lv > 0 ? run + 1 : 0; if (run > best) best = run }
    const months: string[] = []
    const mN = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
    for (let k = 11; k >= 0; k--) months.push(mN[new Date(now.getFullYear(), now.getMonth() - k, 1).getMonth()])
    return { cells, active, streak, best, months }
  }, [diary])

  const HEAT_LV = ['var(--border)', 'color-mix(in srgb,var(--accent) 30%,var(--border))', 'color-mix(in srgb,var(--accent) 55%,var(--border))', 'color-mix(in srgb,var(--accent) 78%,var(--border))', 'var(--accent)']

  const topArtists = musicStats?.top_artists ?? []
  const artistMax = topArtists[0]?.n ?? 1
  const pulsoMonth = now.toLocaleDateString('pt-BR', { month: 'long' })

  return (
    <div className="home">
      <style>{HOME_CSS}</style>

      {/* ── Atalhos de categoria ── */}
      <div className="band">
        <div className="cats">
          {CATEGORIES.map(cat => (
            <Link key={cat.key} to={cat.path} className="cat-chip">
              <span className="dot" style={{ background: `var(${cat.colorVar})` }} />
              <span className="e">{cat.emoji}</span>
              <span className="lb">{cat.label}</span>
              <span className="ct">{cat.key === 'music' ? (musicStats?.plays ?? 0).toLocaleString('pt-BR') : libraryCount(cat.key)}</span>
            </Link>
          ))}
        </div>
      </div>

      {unratedSeasons.length > 0 && (
        <div className="band">
          <section className="quick-rate">
            <div className="quick-rate-head">
              <div>
                <span className="eyebrow">Temporadas concluídas sem avaliação</span>
                <h2>O que você achou da temporada?</h2>
              </div>
              <span className="count">{unratedSeasons.length} para avaliar</span>
            </div>
            <div className="quick-rate-list">
              {unratedSeasons.slice(0, 4).map(season => (
                <div className="quick-rate-item" key={`${season.media_item_id}-${season.season_number}`}>
                  <button
                    type="button"
                    onClick={() => navigate(`/media/${season.media_item_id}`)}
                    aria-label={`Abrir ${season.title}`}
                    className="quick-rate-media"
                    style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', cursor: 'pointer' }}
                  >
                    <Cover url={season.cover_url} type="series" w={42} h={62} radius={7} font={20} />
                    <div>
                      <span className="kind" style={{ color: hue('series') }}>
                        {season.season_title || `Temporada ${season.season_number}`}
                      </span>
                      <strong>{season.title}</strong>
                      <small>{season.completed_at ? relTime(season.completed_at) : 'concluída'}</small>
                    </div>
                  </button>
                  <StarRating
                    value={0}
                    size="md"
                    onChange={rating => rating > 0 && seasonRatingMutation.mutate({
                      mediaItemId: season.media_item_id,
                      seasonNumber: season.season_number,
                      rating,
                    })}
                  />
                </div>
              ))}
            </div>
          </section>
        </div>
      )}

      {/* ── Favoritos: o destaque da home, e o único lugar onde se edita a lista ── */}
      {(libraryCount('movie') > 0 || libraryCount('game') > 0) && (
        <div className="favband">
          {(favorites.movie.length > 0 || libraryCount('movie') > 0) && (
            <FavRow
              label="Filmes Favoritos" type="movie" items={favorites.movie} busy={favMutation.isPending}
              onAdd={() => setPicking('movie')}
              onRemove={it => favMutation.mutate({ id: it.id, favorite: 0 })}
              onCrown={it => favMutation.mutate({ id: it.id, favorite: FAV_TOP })}
              onSeeAll={() => navigate('/library/films')}
            />
          )}
          {(favorites.game.length > 0 || libraryCount('game') > 0) && (
            <FavRow
              label="Jogos Favoritos" type="game" items={favorites.game} busy={favMutation.isPending}
              onAdd={() => setPicking('game')}
              onRemove={it => favMutation.mutate({ id: it.id, favorite: 0 })}
              onCrown={it => favMutation.mutate({ id: it.id, favorite: FAV_TOP })}
              onSeeAll={() => navigate('/library/games')}
            />
          )}
        </div>
      )}

      {picking && (
        <FavPicker
          type={picking}
          items={pickable}
          busy={favMutation.isPending}
          onClose={() => setPicking(null)}
          onPick={it => favMutation.mutate({ id: it.id, favorite: 1 }, { onSuccess: () => setPicking(null) })}
        />
      )}

      {/* ── Promoções no backlog ── */}
      {deals.length > 0 && (
        <div className="band">
          <div className="quad quad-deals">
            <SectionHead
              title={<>🏷️ Promoções no seu backlog</>}
              extra={dealCount > 0 ? <span className="count" style={{ color: 'var(--gold)' }}>{dealCount} em promoção</span> : undefined}
              action="Ver backlog →"
              onAction={() => navigate('/wishlist')}
            />
            <div className="deals">
              {deals.map(({ price, item }) => (
                <MediaPreviewTrigger media={item} label={`Abrir resumo de ${item.title}`} className="deal-card" key={item.id}>
                  <Cover url={item.cover_url} type={item.type} w={64} h={96} font={28} />
                  <div className="body">
                    <span className="nm">{item.title}</span>
                    <span className="shop">{price.best.shop_name}</span>
                    <div className="price">
                      <span className="now">{formatMoney(price.best.price_minor, price.currency ?? price.best.currency)}</span>
                      {price.best.discount_percent > 0 && (
                        <>
                          <span className="was">{formatMoney(price.best.regular_minor, price.currency ?? price.best.currency)}</span>
                          <span className="cut">−{price.best.discount_percent}%</span>
                        </>
                      )}
                    </div>
                    <div className="foot">
                      {price.is_history_low && <span className="low">menor histórico</span>}
                      {price.best.url && (
                        <a
                          href={price.best.url}
                          target="_blank"
                          rel="noopener noreferrer sponsored"
                          onClick={e => e.stopPropagation()}
                          className="buy"
                        >
                          Ver oferta ↗
                        </a>
                      )}
                      {price.last_synced_at && <span className="ago">há {timeAgo(price.last_synced_at)}</span>}
                    </div>
                  </div>
                </MediaPreviewTrigger>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* ── Continuar | Em breve ── */}
      <div className="band"><div className="two-col">
        <div className="quad quad-continue">
          <SectionHead title="Continuar de onde parou" action="Ver diário →" onAction={() => navigate('/diary')} />
          {continueItems.length ? (
            <div className="continue">
              {continueItems.map(it => {
                const m = contMeta(it)
                return (
                  <MediaPreviewTrigger media={it} label={`Abrir resumo de ${it.title}`} className="cont-card" key={it.id}>
                    <Cover url={it.cover_url} type={it.type} w={64} h={96} font={28} />
                    <div className="body">
                      <span className="kind" style={{ color: hue(it.type) }}>{TYPE_LABEL[it.type]}</span>
                      <span className="name">{it.title}</span>
                      <span className="sub">{it.type === 'game' ? (it.library ?? 'jogando') : it.creators ?? it.author ?? ''}</span>
                      <div className="prog">
                        {m.pct != null && <div className="track"><i style={{ width: `${Math.round(m.pct * 100)}%`, background: hue(it.type) }} /></div>}
                        <div className="lbl"><span>{m.left}</span><span>{m.right}</span></div>
                      </div>
                    </div>
                  </MediaPreviewTrigger>
                )
              })}
            </div>
          ) : <Empty>Nada em andamento agora.</Empty>}
        </div>
        <div className="quad quad-soon">
          <SectionHead title="Em breve" extra={emBreve.length ? <span className="count" style={{ color: 'var(--gold)' }}>{emBreve.length} chegando</span> : undefined} action="Ver backlog →" onAction={() => navigate('/wishlist')} />
          {emBreve.length ? (
            <div className="soon">
              {emBreve.map(it => {
                const days = it.release_date ? daysUntil(it.release_date) : null
                const cd = days == null ? 'sem data' : days <= 0 ? 'disponível' : `em ${days} dia${days > 1 ? 's' : ''}`
                const when = it.hype ? 'marcado como hype' : it.release_date ? new Date(it.release_date).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }) : 'no backlog'
                return (
                  <MediaPreviewTrigger media={it} label={`Abrir resumo de ${it.title}`} className="soon-card" key={it.id}>
                    <Cover url={it.cover_url} type={it.type} w={48} h={72} font={22} />
                    <div className="body">
                      <span className="kind" style={{ color: hue(it.type) }}>{TYPE_LABEL[it.type]}{it.hype ? <span className="hype"> · ★ hype</span> : ''}</span>
                      <div className="name">{it.title}</div>
                      <div className="cd">{cd}</div>
                      <div className="when">{when}</div>
                    </div>
                  </MediaPreviewTrigger>
                )
              })}
            </div>
          ) : <Empty>Nada agendado no backlog.</Empty>}
        </div>
      </div></div>

      {/* ── Em alta no público ── */}
      {trending.length > 0 && (
        <>
          <div className="band"><SectionHead title={<>🔥 Em alta no público</>} /></div>
          <TrendingCarousel items={trending} />
        </>
      )}

      {/* ── Adicionados ao diário ── */}
      {recentDiary.length > 0 && (
        <div className="band">
          <SectionHead title="Adicionados ao diário" action="Ver diário →" onAction={() => navigate('/diary')} />
          <div className="dlog">
            {recentDiary.map((d: DiaryEntry) => (
              <MediaPreviewTrigger media={d.media_item_id} label={`Abrir resumo de ${d.title}`} className="dlog-card" key={d.id}>
                <Cover url={d.cover_url} type={d.type} w={48} h={72} font={22} />
                <div className="body">
                  <span className="kind" style={{ color: hue(d.type) }}>{TYPE_LABEL[d.type]}</span>
                  <div className="name">
                    {d.title}{d.season_number != null ? ` · T${d.season_number}${d.episode_number != null ? `E${d.episode_number}` : ''}` : ''}
                  </div>
                  <div className="when">{relTime(d.watched_at)}</div>
                  <div className="st">{d.rating != null && d.rating > 0 ? '★'.repeat(Math.round(d.rating)) : <span style={{ color: 'var(--text-muted)' }}>sem nota</span>}</div>
                </div>
              </MediaPreviewTrigger>
            ))}
          </div>
        </div>
      )}

      {/* ── Pulso + Consistência ── */}
      <div className="band">
        <div className="pulsebar">
          <span className="lead">{pulsoMonth[0].toUpperCase() + pulsoMonth.slice(1)} até agora</span>
          <div className="stat"><span className="n">{wrap?.total ?? 0}</span><span className="l">concluídos</span></div>
          <div className="stat"><span className="n">{Math.round((wrap?.totalRuntimeMinutes ?? 0) / 60)}</span><span className="l">horas</span></div>
          {wrap?.dominantGenre && <div className="stat"><span className="n" style={{ color: 'var(--movies)' }}>{wrap.dominantGenre}</span><span className="l">gênero dominante</span></div>}
          <button className="go" onClick={() => navigate('/wrap')}>Ver seu Wrap →</button>
        </div>
        <div className="consist">
          <div className="streak">
            <span className="big">{heat.streak}</span>
            <span className="lbl">dias seguidos com registro</span>
            <span className="best">Melhor sequência: {heat.best} dias</span>
          </div>
          <div className="ghmap">
            <div className="gh-top">
              <span>Atividade · {heat.active} dias no último ano</span>
              <span className="gh-legend">Menos{HEAT_LV.map((c, k) => <i key={k} style={{ background: c }} />)}Mais</span>
            </div>
            {/* Quando não cabe, a grade rola dentro de si — a página nunca rola de lado. */}
            <div className="gh-scroll">
              <div className="months">{heat.months.map((m, k) => <span key={k}>{m}</span>)}</div>
              <div className="grid">{heat.cells.map((lv, k) => <span key={k} className="cell" style={{ background: HEAT_LV[lv] }} />)}</div>
            </div>
          </div>
        </div>
      </div>

      {/* ── Neste dia + Suas listas | Ficou pela metade ── */}
      <div className="band"><div className="two-col">
        <div className="col-stack">
          <section>
            <SectionHead title="Neste dia" extra={<span className="eyebrow" style={{ marginLeft: 12 }}>memórias do diário</span>} />
            {nesteDia.length ? (
              <div className="grid-cards">
                {nesteDia.map(d => (
                  <MediaPreviewTrigger media={d.media_item_id} label={`Abrir resumo de ${d.title}`} className="memo" key={d.id}>
                    <Cover url={d.cover_url} type={d.type} w={44} h={64} radius={6} font={20} />
                    <div>
                      <div className="ago">há {Math.max(1, now.getFullYear() - new Date(d.watched_at).getFullYear())} ano(s)</div>
                      <div className="nm">{d.title}</div>
                      <div className="sub">{d.rating != null && d.rating > 0 ? `você deu ${'★'.repeat(Math.round(d.rating))}` : 'registrado neste dia'}</div>
                    </div>
                  </MediaPreviewTrigger>
                ))}
              </div>
            ) : <Empty>Nenhum registro neste dia em anos anteriores.</Empty>}
          </section>
          <section>
            <SectionHead title="Suas listas" action="Ver todas →" onAction={() => navigate('/lists')} />
            {lists.length ? (
              <div className="lists">
                {lists.slice(0, 6).map((l, idx) => {
                  const cs: MediaType[] = [['movie', 'series', 'book'], ['game', 'music', 'movie'], ['series', 'book', 'game']][idx % 3] as MediaType[]
                  return (
                    <Link to={`/lists/${l.id}`} className="list-card" key={l.id}>
                      <div className="stack">{cs.map((t, j) => <i key={j} style={{ background: coverBg(t) }} />)}</div>
                      <div className="nm">{l.name}</div>
                      <div className="meta">{l.item_count ?? 0} {(l.item_count ?? 0) === 1 ? 'item' : 'itens'}</div>
                    </Link>
                  )
                })}
              </div>
            ) : <Empty>Você ainda não criou listas.</Empty>}
          </section>
        </div>
        <section>
          <SectionHead title="Ficou pela metade" extra={<span className="eyebrow" style={{ marginLeft: 12 }}>retomar ou arquivar</span>} />
          {droppedItems.length ? (
            <div className="droplist">
              {droppedItems.map(it => {
                const m = contMeta(it)
                return (
                  <MediaPreviewTrigger media={it} label={`Abrir resumo de ${it.title}`} className="drop-card" key={it.id}>
                    <Cover url={it.cover_url} type={it.type} w={44} h={64} radius={8} font={20} />
                    <div className="body">
                      <span className="kind">{TYPE_LABEL[it.type]}</span>
                      <div className="name">{it.title}</div>
                      <div className="sub">{m.left}</div>
                      {m.pct != null && <div className="prog" style={{ marginTop: 8 }}><div className="track"><i style={{ width: `${Math.round(m.pct * 100)}%`, background: hue(it.type) }} /></div></div>}
                    </div>
                  </MediaPreviewTrigger>
                )
              })}
            </div>
          ) : <Empty>Nada largado no momento.</Empty>}
        </section>
      </div></div>

      {/* ── Seus artistas do momento ── */}
      {topArtists.length > 0 && (
        <div className="band">
          <SectionHead title="🎵 Seus artistas do momento" extra={<span className="eyebrow" style={{ marginLeft: 12 }}>Last.fm</span>} />
          <div className="artists">
            {topArtists.map((a, i) => (
              <div className="artist" key={a.artist}>
                <span className="r">{i + 1}</span>
                <div className="who">
                  <div className="nm">{a.artist}</div>
                  <div className="track"><i style={{ width: `${(a.n / artistMax) * 100}%` }} /></div>
                </div>
                <span className="pl">{a.n}</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}

/* ─── CSS específico da home ─── */
const HOME_CSS = `
.home{padding-bottom:80px}
.home .band{padding:0 var(--page-x)}
.home .sec-head{display:flex;align-items:flex-end;justify-content:space-between;gap:16px;margin:40px 0 16px}
.home .sec-head h2{font-size:clamp(20px,2vw,26px);font-weight:700;letter-spacing:-.02em;display:flex;align-items:center;gap:12px;margin:0}
.home .count{font-size:13px;font-weight:600;border:1px solid var(--border);background:var(--surface);border-radius:9999px;padding:4px 12px;font-variant-numeric:tabular-nums}
.home .seeall{font-size:14px;color:var(--text-muted);background:none;border:none;cursor:pointer}
.home .seeall:hover{color:var(--accent)}
.home .eyebrow{font-size:12px;font-weight:600;text-transform:uppercase;letter-spacing:1.2px;color:var(--text-muted)}
.home a{text-decoration:none;color:inherit}

.home .cats{display:grid;grid-template-columns:repeat(5,1fr);gap:16px;margin-top:24px}
.home .cat-chip{display:flex;align-items:center;justify-content:center;gap:10px;padding:14px 16px;background:var(--surface);border:1px solid var(--border);border-radius:12px;transition:border-color .2s,transform .2s}
.home .cat-chip:hover{border-color:var(--border-strong);transform:translateY(-2px)}
.home .cat-chip .dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.home .cat-chip .e{font-size:18px}
.home .cat-chip .lb{font-weight:600;font-size:14px}
.home .cat-chip .ct{font-size:13px;font-weight:600;color:var(--text-secondary);font-variant-numeric:tabular-nums;background:var(--card);border-radius:9999px;padding:2px 10px}

.home .quick-rate{margin-top:24px;padding:20px;border:1px solid color-mix(in srgb,var(--accent) 35%,var(--border));border-radius:16px;background:linear-gradient(120deg,color-mix(in srgb,var(--accent) 10%,var(--surface)),var(--surface))}
.home .quick-rate-head{display:flex;align-items:end;justify-content:space-between;gap:16px;margin-bottom:14px}
.home .quick-rate-head h2{font-size:20px;margin:3px 0 0}
.home .quick-rate-list{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.home .quick-rate-item{display:flex;align-items:center;justify-content:space-between;gap:12px;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:12px;min-width:0}
.home .quick-rate-media{display:flex;align-items:center;gap:10px;min-width:0;flex:1}
.home .quick-rate-media>div:last-child{display:flex;flex-direction:column;min-width:0}
.home .quick-rate-media .kind{font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.7px}
.home .quick-rate-media strong{font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.home .quick-rate-media small{font-size:11px;color:var(--text-muted)}

/* Banner de favoritos: faixa larga, pôsteres grandes, #1 com coroa e moldura dourada. */
.home .favband{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:start;margin-top:28px;padding:20px var(--page-x) 24px;border-block:1px solid var(--border);background:radial-gradient(70% 130% at 8% 0%,color-mix(in srgb,var(--movies) 14%,transparent),transparent 62%),radial-gradient(70% 130% at 92% 100%,color-mix(in srgb,var(--games) 14%,transparent),transparent 62%),var(--surface)}
.home .favrow{min-width:0}
.home .fav-head{display:flex;align-items:center;gap:12px}
.home .fav-head i{width:4px;height:21px;border-radius:2px;background:var(--fav);flex-shrink:0}
.home .fav-head h2{margin:0;font-size:clamp(17px,1.5vw,21px);font-weight:700;letter-spacing:-.02em}
.home .fav-head .n{font-size:12px;font-weight:700;color:var(--text-secondary);background:var(--card);border:1px solid var(--border);border-radius:9999px;padding:2px 9px;font-variant-numeric:tabular-nums}
.home .fav-head .seeall{margin-left:auto}
/* padding no topo: a coroa do #1 escapa do pôster e não pode ser cortada pelo scroll. */
/* As cinco vagas dividem a largura da coluna — sem rolagem lateral. */
.home .fav-strip{display:flex;align-items:flex-end;gap:10px;padding:22px 0 2px}
.home .fav-card{position:relative;flex:1 1 0;min-width:0;cursor:pointer;transition:transform .25s var(--ease)}
.home .fav-card:hover{transform:translateY(-4px)}
.home .fav-card .shot{position:relative;border-radius:12px;overflow:hidden;box-shadow:0 10px 26px rgba(0,0,0,.38)}
.home .fav-card .art{display:block;width:100%;aspect-ratio:2/3;object-fit:cover}
.home .fav-card .art.fb{display:grid;place-items:center;font-size:30px;color:#fff}
.home .fav-card.top{flex:1.24 1 0}
.home .fav-card.top .shot{outline:3px solid var(--gold);outline-offset:-1px;box-shadow:0 0 0 6px color-mix(in srgb,var(--gold) 18%,transparent),0 14px 34px color-mix(in srgb,var(--gold) 30%,transparent)}
.home .fav-card .crown{position:absolute;top:-18px;left:50%;transform:translateX(-50%);font-size:17px;line-height:1;z-index:2;filter:drop-shadow(0 2px 5px rgba(0,0,0,.55))}
.home .fav-card .foot{position:absolute;left:0;right:0;bottom:0;display:flex;justify-content:center;gap:8px;padding:18px 4px 6px;font-size:10px;font-weight:600;color:#fff;font-variant-numeric:tabular-nums;background:linear-gradient(transparent,rgba(0,0,0,.88))}
.home .fav-card .foot .rt{color:var(--gold)}
/* Altura fixa de duas linhas + strip alinhado embaixo: os pôsteres encostam na
   mesma linha de base, então o #1 cresce só para cima, como na referência. */
.home .fav-card .ttl{margin-top:8px;height:30px;font-size:12px;font-weight:600;line-height:1.3;color:var(--text-secondary);display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.home .fav-card.top .ttl{color:var(--text-primary)}
/* Ações do pôster (coroar, remover): discretas até o card receber mouse ou foco. */
.home .fav-card .acts{position:absolute;top:5px;right:5px;z-index:3;display:flex;gap:5px;opacity:0;transition:opacity .18s}
.home .fav-card:hover .acts,.home .fav-card:focus-within .acts{opacity:1}
@media(hover:none){.home .fav-card .acts{opacity:1}}
.home .fav-card .acts button{width:24px;height:24px;padding:0;border-radius:50%;border:1px solid rgba(255,255,255,.24);background:rgba(10,10,20,.72);color:#fff;font-size:12px;line-height:1;display:grid;place-items:center;cursor:pointer;backdrop-filter:blur(4px);transition:background .18s,border-color .18s}
.home .fav-card .acts button:disabled{cursor:default;opacity:.4}
.home .fav-card .mk:hover{background:var(--gold);border-color:var(--gold)}
.home .fav-card .rm{font-size:14px}
.home .fav-card .rm:hover{background:#e0245e;border-color:#e0245e}

/* Vaga vazia: o único jeito de entrar no banner é por aqui. */
.home .fav-add{background:none;border:none;padding:0;font:inherit;text-align:left;color:inherit}
.home .fav-add .shot{display:grid;place-items:center;align-content:center;gap:6px;aspect-ratio:2/3;border:2px dashed var(--border-strong);background:color-mix(in srgb,var(--card) 55%,transparent);color:var(--text-muted);box-shadow:none;transition:border-color .2s,color .2s}
.home .fav-add:hover .shot{border-color:var(--fav);color:var(--fav)}
.home .fav-add .plus{font-size:24px;line-height:1;font-weight:300}
.home .fav-add .lb{font-size:10px;font-weight:600;letter-spacing:.4px}
.home .fav-add:disabled{opacity:.5}

/* Seletor da vaga (modal) */
.fav-pick-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(104px,1fr));gap:12px;max-height:46vh;overflow-y:auto;padding-right:4px}
.fav-pick{background:none;border:none;padding:0;text-align:left;cursor:pointer;color:inherit}
.fav-pick .art{display:block;width:100%;aspect-ratio:2/3;object-fit:cover;border-radius:8px;border:1px solid var(--border);transition:border-color .2s,transform .2s}
.fav-pick .art.fb{display:grid;place-items:center;font-size:26px;color:#fff}
.fav-pick:hover .art{border-color:var(--accent);transform:translateY(-3px)}
.fav-pick .nm{display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;margin-top:6px;font-size:12px;font-weight:600;line-height:1.25;color:var(--text-secondary)}
.fav-pick:disabled{opacity:.5;cursor:default}

.home .two-col{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:stretch}
.home .two-col>.quad,.home .two-col>.col-stack{display:flex;flex-direction:column;min-width:0}

@media(max-width:800px){.home .quick-rate-list{grid-template-columns:1fr}.home .quick-rate-item{align-items:flex-start;flex-direction:column}.home .quick-rate-item>div:last-child{align-self:flex-end}}

/* Bloco colorido: --a fundo profundo, --b cor viva, --c brilho do canto. */
.home .quad{--tint:var(--b);position:relative;margin-top:40px;padding:24px 24px 28px;border-radius:20px;overflow:hidden;border:1px solid color-mix(in srgb,var(--b) 45%,transparent);background:radial-gradient(120% 110% at 100% 0%,color-mix(in srgb,var(--c) 42%,transparent),transparent 62%),linear-gradient(125deg,var(--a) 0%,color-mix(in srgb,var(--b) 70%,var(--a)) 68%,var(--b) 100%)}
/* No claro o mesmo gradiente é lavado com branco para o texto escuro continuar legível. */
html:not(.dark) .home .quad{background:radial-gradient(120% 110% at 100% 0%,color-mix(in srgb,var(--c) 60%,transparent),transparent 62%),linear-gradient(125deg,color-mix(in srgb,var(--a) 16%,#fff) 0%,color-mix(in srgb,var(--b) 58%,#fff) 100%)}
.home .quad .sec-head{margin-top:0}
.home .quad .seeall{color:color-mix(in srgb,var(--text-primary) 75%,transparent)}
.home .quad .seeall:hover{color:var(--text-primary)}
.home .quad-continue{--a:#07331F;--b:#12A85C;--c:var(--accent)}
.home .quad-deals{--a:#38071F;--b:#D11E6E;--c:#FF74B8}
.home .quad-soon{--a:#3D1B06;--b:#D9791B;--c:var(--gold)}

.home .continue,.home .soon{display:grid;grid-template-columns:repeat(2,1fr);gap:16px;flex:1;grid-auto-rows:1fr;min-height:0}
.home .cont-card{display:flex;gap:16px;padding:16px;background:color-mix(in srgb,var(--card) 92%,transparent);border:1px solid rgba(0,0,0,.28);border-radius:16px;backdrop-filter:blur(2px);transition:border-color .2s,transform .2s}
.home .cont-card:hover{border-color:color-mix(in srgb,var(--tint) 55%,#fff);transform:translateY(-4px)}
.home .cont-card .body{display:flex;flex-direction:column;min-width:0;flex:1;gap:8px}
.home .cont-card .kind{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.6px}
.home .cont-card .name{font-weight:600;line-height:1.25}
.home .cont-card .sub{font-size:13px;color:var(--text-muted);margin-top:-4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.home .prog{margin-top:auto}
.home .prog .track{height:8px;border-radius:8px;background:var(--border)}
.home .prog .track>i{display:block;height:100%;border-radius:8px}
.home .prog .lbl{display:flex;justify-content:space-between;font-size:12px;color:var(--text-muted);margin-top:8px;font-variant-numeric:tabular-nums}

.home .soon-card{display:flex;gap:16px;padding:16px;background:color-mix(in srgb,var(--card) 92%,transparent);border:1px solid rgba(0,0,0,.28);border-radius:16px;align-items:center;backdrop-filter:blur(2px);transition:border-color .2s,transform .2s}
.home .soon-card:hover{border-color:color-mix(in srgb,var(--tint) 55%,#fff);transform:translateY(-4px)}
.home .soon-card .body{min-width:0;flex:1}
.home .soon-card .kind{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.6px}
.home .soon-card .name{font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.home .soon-card .cd{font-size:16px;font-weight:700;margin-top:8px;color:var(--gold)}
.home .soon-card .when{font-size:12px;color:var(--text-muted)}
.home .hype{color:var(--gold)}

.home .hc-carousel{position:relative;overflow:hidden;border-block:1px solid var(--border);background:#0b0b16;margin-top:4px}
.home .hc-track{display:flex;transition:transform .55s var(--ease)}
.home .hc-slide{flex:0 0 100%;min-height:230px;position:relative;display:flex;align-items:flex-end;padding:28px var(--page-x)}
.home .hc-glow{position:absolute;inset:0}
.home .hc-inner{position:relative;max-width:640px}
.home .hc-flag{display:inline-flex;align-items:center;gap:8px;font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}
.home .hc-slide h3{font-size:clamp(26px,3.4vw,40px);line-height:1.04;font-weight:700;letter-spacing:-.02em;margin:0;color:var(--text-primary)}
.home .hc-metrics{display:flex;gap:24px;margin-top:16px;flex-wrap:wrap}
.home .hc-n{font-size:20px;font-weight:700;font-variant-numeric:tabular-nums;color:var(--text-primary)}
.home .hc-l{font-size:12px;color:var(--text-secondary)}
.home .hc-btn{position:absolute;top:50%;transform:translateY(-50%);z-index:3;width:44px;height:44px;border-radius:50%;background:color-mix(in srgb,var(--bg) 55%,transparent);border:1px solid var(--border-strong);color:var(--text-primary);font-size:20px;cursor:pointer;display:grid;place-items:center;backdrop-filter:blur(8px)}
.home .hc-btn.prev{left:16px}.home .hc-btn.next{right:16px}
.home .hc-dots{position:absolute;bottom:20px;right:var(--page-x);z-index:3;display:flex;gap:8px}
.home .hc-dots button{width:8px;height:8px;border-radius:50%;border:none;padding:0;background:var(--border-strong);cursor:pointer}
.home .hc-dots button.on{background:var(--accent);width:24px;border-radius:8px}

.home .dlog{display:grid;grid-template-columns:repeat(auto-fill,minmax(260px,1fr));gap:16px}
.home .dlog-card{display:flex;gap:16px;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:16px;align-items:center;transition:border-color .2s,transform .2s}
.home .dlog-card:hover{border-color:var(--border-strong);transform:translateY(-4px)}
.home .dlog-card .body{min-width:0;flex:1}
.home .dlog-card .kind{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.6px}
.home .dlog-card .name{font-weight:600;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.home .dlog-card .when{font-size:12px;color:var(--text-muted)}
.home .dlog-card .st{color:var(--gold);font-size:12px;margin-top:4px}

.home .pulsebar{display:flex;flex-wrap:wrap;align-items:center;gap:16px 40px;margin-top:40px;padding:24px;background:var(--surface);border:1px solid var(--border);border-radius:16px}
.home .pulsebar .lead{font-weight:600;font-size:14px;color:var(--text-secondary);margin-right:8px}
.home .stat{display:flex;align-items:baseline;gap:8px}
.home .stat .n{font-size:24px;font-weight:700;font-variant-numeric:tabular-nums}
.home .stat .l{font-size:13px;color:var(--text-muted)}
.home .pulsebar .go{margin-left:auto;font-size:14px;font-weight:600;color:var(--accent);background:none;border:none;cursor:pointer}
.home .consist{display:flex;gap:40px;align-items:center;margin-top:16px;padding:24px;background:var(--surface);border:1px solid var(--border);border-radius:16px;flex-wrap:wrap}
.home .streak{display:flex;flex-direction:column;justify-content:center;gap:4px;flex-shrink:0}
.home .streak .big{font-size:44px;font-weight:700;color:var(--accent);line-height:1;font-variant-numeric:tabular-nums}
.home .streak .lbl{font-size:13px;color:var(--text-muted)}
.home .streak .best{font-size:12px;color:var(--text-muted);margin-top:8px}
.home .ghmap{flex:1;min-width:0;display:flex;flex-direction:column;gap:6px}
.home .ghmap .gh-top{display:flex;flex-wrap:wrap;justify-content:space-between;align-items:center;gap:4px 12px;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px}
.home .ghmap .gh-legend{display:flex;align-items:center;gap:4px;text-transform:none;letter-spacing:0}
.home .ghmap .gh-legend i{width:11px;height:11px;border-radius:3px}
.home .ghmap .gh-scroll{display:flex;flex-direction:column;gap:6px;overflow-x:auto}
/* Largura mínima igual nos dois para os meses continuarem alinhados às colunas. */
.home .ghmap .months,.home .ghmap .grid{min-width:520px}
.home .ghmap .months{display:flex;justify-content:space-between;font-size:10px;color:var(--text-muted);padding:0 2px}
.home .ghmap .grid{display:grid;grid-template-rows:repeat(7,1fr);grid-auto-flow:column;grid-auto-columns:1fr;gap:3px;height:120px}
.home .ghmap .cell{border-radius:3px;background:var(--border)}

.home .col-stack{display:flex;flex-direction:column}
.home .grid-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:16px}
.home .memo{display:flex;gap:16px;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:16px;align-items:center;transition:border-color .2s,transform .2s}
.home .memo:hover{border-color:var(--border-strong);transform:translateY(-4px)}
.home .memo .ago{font-size:11px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;color:var(--gold)}
.home .memo .nm{font-weight:600;line-height:1.2;margin-top:2px}
.home .memo .sub{font-size:12px;color:var(--text-muted)}

.home .droplist{display:grid;grid-auto-rows:1fr;gap:12px;flex:1;min-height:0}
.home .drop-card{display:flex;align-items:center;gap:16px;padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:16px;transition:border-color .2s,transform .2s}
.home .drop-card:hover{border-color:var(--border-strong);transform:translateY(-2px)}
.home .drop-card .body{min-width:0;flex:1}
.home .drop-card .kind{font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.6px;color:var(--text-muted)}
.home .drop-card .name{font-weight:600;line-height:1.2}
.home .drop-card .sub{font-size:12px;color:var(--text-muted);margin-top:2px}

.home .lists{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:16px}
.home .list-card{padding:16px;background:var(--surface);border:1px solid var(--border);border-radius:16px;transition:border-color .2s,transform .2s}
.home .list-card:hover{border-color:var(--border-strong);transform:translateY(-4px)}
.home .list-card .stack{display:flex;margin-bottom:16px}
.home .list-card .stack i{width:40px;height:56px;border-radius:6px;margin-left:-12px;border:2px solid var(--surface);box-shadow:0 2px 8px rgba(0,0,0,.3)}
.home .list-card .stack i:first-child{margin-left:0}
.home .list-card .nm{font-weight:600}
.home .list-card .meta{font-size:12px;color:var(--text-muted);margin-top:4px}

.home .artists{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px}
.home .artist{display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--surface);border:1px solid var(--border);border-radius:12px}
.home .artist .r{font-size:13px;font-weight:700;color:var(--music);width:20px;font-variant-numeric:tabular-nums}
.home .artist .who{flex:1;min-width:0}
.home .artist .nm{font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.home .artist .track{height:6px;border-radius:6px;background:var(--border);margin-top:6px;overflow:hidden}
.home .artist .track>i{display:block;height:100%;background:var(--music)}
.home .artist .pl{font-size:12px;color:var(--text-muted);font-variant-numeric:tabular-nums;flex-shrink:0}

.home .deals{display:grid;grid-template-columns:repeat(auto-fill,minmax(272px,1fr));gap:16px;grid-auto-rows:1fr}
.home .deal-card{display:flex;gap:14px;padding:16px;background:color-mix(in srgb,var(--card) 92%,transparent);border:1px solid rgba(0,0,0,.28);border-radius:16px;backdrop-filter:blur(2px);transition:border-color .2s,transform .2s}
.home .deal-card:hover{border-color:color-mix(in srgb,var(--tint) 55%,#fff);transform:translateY(-4px)}
.home .deal-card .body{display:flex;flex-direction:column;min-width:0;flex:1;gap:4px}
.home .deal-card .nm{font-weight:600;line-height:1.2;font-size:14px;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden}
.home .deal-card .shop{font-size:11px;color:var(--text-muted)}
.home .deal-card .price{display:flex;align-items:baseline;gap:6px;flex-wrap:wrap;margin-top:auto}
.home .deal-card .now{font-size:20px;font-weight:800;letter-spacing:-.02em;font-variant-numeric:tabular-nums}
.home .deal-card .was{font-size:12px;color:var(--text-muted);text-decoration:line-through}
.home .deal-card .cut{font-size:11px;font-weight:700;color:#fff;background:var(--b);border-radius:6px;padding:1px 5px}
.home .deal-card .foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap;font-size:11px}
.home .deal-card .low{font-weight:700;text-transform:uppercase;letter-spacing:.5px;font-size:10px;color:var(--gold);border:1px solid var(--gold);border-radius:9999px;padding:0 6px}
.home .deal-card .buy{color:var(--accent);font-weight:600}
.home .deal-card .buy:hover{text-decoration:underline}
.home .deal-card .ago{color:var(--text-muted)}

/* Estreito demais para cinco pôsteres em meia largura: volta a empilhar. */
@media(max-width:1080px){
  .home .favband{grid-template-columns:1fr;gap:0}
  .home .favrow+.favrow{margin-top:22px;padding-top:22px;border-top:1px solid var(--border)}
  /* Empilhado, a tira não estica: os pôsteres continuam do tamanho de meia largura. */
  .home .fav-strip{max-width:640px}
}
/* Estreito de verdade: a tira volta a rolar de lado — pôster miúdo fica ilegível. */
@media(max-width:700px){
  .home .fav-strip{max-width:none;overflow-x:auto;padding:22px 2px 8px;scrollbar-width:thin}
  .home .fav-card{flex:0 0 118px}
  .home .fav-card.top{flex:0 0 140px}
}
@media(max-width:900px){
  .home .two-col{grid-template-columns:1fr;gap:0}
  .home .quad+.quad{margin-top:24px}
  .home .cats{grid-template-columns:repeat(3,1fr)}
}
@media(max-width:560px){
  .home .fav-strip{gap:8px}
  .home .fav-card .ttl{height:28px}
  .home .continue,.home .soon{grid-template-columns:1fr}
  .home .cats{grid-template-columns:repeat(2,1fr)}
  .home .deals{grid-template-columns:1fr;grid-auto-rows:auto}
  /* Empilha streak e heatmap. O nowrap é essencial: numa coluna que embrulha,
     a linha do flex ganha a largura do maior item e o heatmap estoura o card. */
  .home .consist{flex-direction:column;flex-wrap:nowrap;align-items:stretch;gap:20px}
  /* Título longo + selo + "ver backlog" não cabem numa linha só no celular. */
  .home .quad-deals .sec-head,.home .quad-deals .sec-head h2{flex-wrap:wrap}
  .home .quad-deals .seeall{margin-left:auto}
}
`
