import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { CATEGORIES } from '../lib/categories'
import { TYPE_LABEL, TYPE_COLOR, GAME_STATUS_LABEL, gameStatusOf, formatPlaytime, fmtRating, toISODate, todayISODate, daysUntil } from '../lib/utils'
import type { MediaItem, MediaType, TrendingItem, DiaryEntry } from '../types'

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
    return <img src={url} alt="" onError={() => setBroken(true)} style={{ ...base, objectFit: 'cover', display: 'block' }} />
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

/* ─── Carrossel "Em alta no público" ─── */
function TrendingCarousel({ items }: { items: TrendingItem[] }) {
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
        {items.map((t, k) => (
          <div className="hc-slide" key={k}>
            <div className="hc-glow" style={{ background: `radial-gradient(circle at 80% 30%, color-mix(in srgb, ${hue(t.type)} 55%, transparent), transparent 55%), linear-gradient(115deg, color-mix(in srgb, ${hue(t.type)} 22%, #0b0b16), #0b0b16 65%)${t.cover_url ? `, url(${t.cover_url})` : ''}`, backgroundSize: 'cover', backgroundPosition: 'center' }} />
            <div className="hc-inner">
              <span className="hc-flag" style={{ color: hue(t.type) }}>{TYPE_EMOJI[t.type]} Em alta · {TYPE_LABEL[t.type]}</span>
              <h3>{t.title}</h3>
              <div className="hc-metrics">
                <div><div className="hc-n" style={{ color: hue(t.type) }}>{t.metric}</div><div className="hc-l">{t.metric_label}</div></div>
                {t.subtitle && <div><div className="hc-n">{t.subtitle}</div><div className="hc-l">{t.type === 'music' ? 'artista' : 'ano'}</div></div>}
              </div>
            </div>
          </div>
        ))}
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
  const now = new Date()

  const { data: allItems = [] } = useQuery({ queryKey: ['media-all'], queryFn: () => api.media.list({ limit: 1000 }) })
  const { data: diary = [] } = useQuery({ queryKey: ['diary-all'], queryFn: () => api.diary.list() })
  const { data: upcoming } = useQuery({ queryKey: ['media-upcoming'], queryFn: () => api.media.upcoming() })
  const { data: musicStats } = useQuery({ queryKey: ['music-stats'], queryFn: api.integrations.musicStats })
  const { data: lists = [] } = useQuery({ queryKey: ['lists'], queryFn: api.lists.list })
  const { data: trending = [] } = useQuery({ queryKey: ['trending'], queryFn: api.integrations.trending, staleTime: 3_600_000 })
  const { data: wrap } = useQuery({ queryKey: ['wrap-month', now.getFullYear(), now.getMonth() + 1], queryFn: () => api.wrap({ period: 'monthly', year: now.getFullYear(), month: now.getMonth() + 1 }) })

  /* ─── derivações ─── */
  // Contador da biblioteca por categoria: tudo que já foi consumido — concluído,
  // em andamento ou abandonado. Só a wishlist fica de fora (ela mora em /wishlist).
  const libraryCount = (t: MediaType) => allItems.reduce((n, i) => n + (i.type === t && i.status !== 'wishlist' ? 1 : 0), 0)

  const continueItems = useMemo(
    () => allItems.filter(i => i.status === 'in_progress').sort(byRecent).slice(0, 4),
    [allItems],
  )
  const droppedItems = useMemo(
    () => allItems.filter(i => i.status === 'dropped').sort(byRecent).slice(0, 4),
    [allItems],
  )

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

      {/* ── Continuar | Em breve ── */}
      <div className="band"><div className="two-col">
        <div className="quad quad-continue">
          <SectionHead title="Continuar de onde parou" action="Ver diário →" onAction={() => navigate('/diary')} />
          {continueItems.length ? (
            <div className="continue">
              {continueItems.map(it => {
                const m = contMeta(it)
                return (
                  <Link to={`/media/${it.id}`} className="cont-card" key={it.id}>
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
                  </Link>
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
                  <Link to={`/media/${it.id}`} className="soon-card" key={it.id}>
                    <Cover url={it.cover_url} type={it.type} w={48} h={72} font={22} />
                    <div className="body">
                      <span className="kind" style={{ color: hue(it.type) }}>{TYPE_LABEL[it.type]}{it.hype ? <span className="hype"> · ★ hype</span> : ''}</span>
                      <div className="name">{it.title}</div>
                      <div className="cd">{cd}</div>
                      <div className="when">{when}</div>
                    </div>
                  </Link>
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
              <Link to={`/media/${d.media_item_id}`} className="dlog-card" key={d.id}>
                <Cover url={d.cover_url} type={d.type} w={48} h={72} font={22} />
                <div className="body">
                  <span className="kind" style={{ color: hue(d.type) }}>{TYPE_LABEL[d.type]}</span>
                  <div className="name">{d.title}{d.season_number != null ? ` · S${d.season_number}E${d.episode_number}` : ''}</div>
                  <div className="when">{relTime(d.watched_at)}</div>
                  <div className="st">{d.rating != null && d.rating > 0 ? '★'.repeat(Math.round(d.rating)) : <span style={{ color: 'var(--text-muted)' }}>sem nota</span>}</div>
                </div>
              </Link>
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
            <div className="months">{heat.months.map((m, k) => <span key={k}>{m}</span>)}</div>
            <div className="grid">{heat.cells.map((lv, k) => <span key={k} className="cell" style={{ background: HEAT_LV[lv] }} />)}</div>
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
                  <Link to={`/media/${d.media_item_id}`} className="memo" key={d.id}>
                    <Cover url={d.cover_url} type={d.type} w={44} h={64} radius={6} font={20} />
                    <div>
                      <div className="ago">há {Math.max(1, now.getFullYear() - new Date(d.watched_at).getFullYear())} ano(s)</div>
                      <div className="nm">{d.title}</div>
                      <div className="sub">{d.rating != null && d.rating > 0 ? `você deu ${'★'.repeat(Math.round(d.rating))}` : 'registrado neste dia'}</div>
                    </div>
                  </Link>
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
                  <Link to={`/media/${it.id}`} className="drop-card" key={it.id}>
                    <Cover url={it.cover_url} type={it.type} w={44} h={64} radius={8} font={20} />
                    <div className="body">
                      <span className="kind">{TYPE_LABEL[it.type]}</span>
                      <div className="name">{it.title}</div>
                      <div className="sub">{m.left}</div>
                      {m.pct != null && <div className="prog" style={{ marginTop: 8 }}><div className="track"><i style={{ width: `${Math.round(m.pct * 100)}%`, background: hue(it.type) }} /></div></div>}
                    </div>
                  </Link>
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

.home .two-col{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:stretch}
.home .two-col>.quad,.home .two-col>.col-stack{display:flex;flex-direction:column;min-width:0}

/* Bloco colorido: --a fundo profundo, --b cor viva, --c brilho do canto. */
.home .quad{--tint:var(--b);position:relative;margin-top:40px;padding:24px 24px 28px;border-radius:20px;overflow:hidden;border:1px solid color-mix(in srgb,var(--b) 45%,transparent);background:radial-gradient(120% 110% at 100% 0%,color-mix(in srgb,var(--c) 42%,transparent),transparent 62%),linear-gradient(125deg,var(--a) 0%,color-mix(in srgb,var(--b) 70%,var(--a)) 68%,var(--b) 100%)}
/* No claro o mesmo gradiente é lavado com branco para o texto escuro continuar legível. */
html:not(.dark) .home .quad{background:radial-gradient(120% 110% at 100% 0%,color-mix(in srgb,var(--c) 60%,transparent),transparent 62%),linear-gradient(125deg,color-mix(in srgb,var(--a) 16%,#fff) 0%,color-mix(in srgb,var(--b) 58%,#fff) 100%)}
.home .quad .sec-head{margin-top:0}
.home .quad .seeall{color:color-mix(in srgb,var(--text-primary) 75%,transparent)}
.home .quad .seeall:hover{color:var(--text-primary)}
.home .quad-continue{--a:#07331F;--b:#12A85C;--c:var(--accent)}
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
.home .ghmap .gh-top{display:flex;justify-content:space-between;align-items:center;font-size:12px;color:var(--text-muted);text-transform:uppercase;letter-spacing:.6px}
.home .ghmap .gh-legend{display:flex;align-items:center;gap:4px;text-transform:none;letter-spacing:0}
.home .ghmap .gh-legend i{width:11px;height:11px;border-radius:3px}
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

@media(max-width:900px){
  .home .two-col{grid-template-columns:1fr;gap:0}
  .home .quad+.quad{margin-top:24px}
  .home .cats{grid-template-columns:repeat(3,1fr)}
}
@media(max-width:560px){
  .home .continue,.home .soon{grid-template-columns:1fr}
  .home .cats{grid-template-columns:repeat(2,1fr)}
}
`
