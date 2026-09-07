import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { AutoCarousel } from '../components/AutoCarousel'
import { HeroCarousel } from '../components/HeroCarousel'
import { CATEGORIES } from '../lib/categories'
import type { MediaItem, MediaType } from '../types'

const byCompleted = (a: MediaItem, b: MediaItem) =>
  new Date(b.completed_at ?? b.updated_at).getTime() - new Date(a.completed_at ?? a.updated_at).getTime()

const byRecent = (a: MediaItem, b: MediaItem) =>
  new Date(b.added_at).getTime() - new Date(a.added_at).getTime()

/** Smooth ease-in-out used for the block-to-block transition. */
const BLOCK_EASE = 'transform .9s cubic-bezier(.65, 0, .35, 1)'

/**
 * Ambient background art for a category block: a heavily-blurred version of the
 * category's newest cover plus a soft glow in the category's colour, faded back
 * into the app background at the top and bottom edges.
 */
function BlockBg({ colorVar, art }: { colorVar: string; art?: string }) {
  return (
    <>
      {art && (
        <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: `url(${art})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(80px) saturate(1.5) brightness(.7)', opacity: 0.3, transform: 'scale(1.3)' }} />
      )}
      <div aria-hidden style={{ position: 'absolute', top: '-25%', right: '-5%', width: '65%', height: '150%', background: `radial-gradient(circle at 65% 45%, var(${colorVar}) 0%, transparent 60%)`, opacity: 0.12, pointerEvents: 'none' }} />
      <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to bottom, var(--bg) 0%, transparent 22%, transparent 78%, var(--bg) 100%)' }} />
    </>
  )
}

export function Dashboard() {
  const navigate = useNavigate()

  const { data: allItems = [] } = useQuery({
    queryKey: ['media-all'],
    queryFn: () => api.media.list({ limit: 1000 }),
  })

  /* ─── derive data ─── */
  const recentByType = useMemo(() => {
    const map = {} as Record<MediaType, MediaItem[]>
    for (const c of CATEGORIES) map[c.key] = []
    for (const item of allItems) (map[item.type] ??= []).push(item)
    for (const k of Object.keys(map) as MediaType[]) map[k].sort(byRecent)
    return map
  }, [allItems])

  /** Counters always count only completed items — for every library. */
  const completedCount = (type: MediaType) =>
    allItems.reduce((n, i) => n + (i.type === type && i.status === 'completed' ? 1 : 0), 0)

  /** Hero cycles through the diary (completed items, newest-first); featured
   *  slides need cover art and exclude music, but the diary order is kept. */
  const heroSlides = useMemo(() => {
    const diary = allItems
      .filter(i => i.status === 'completed' && i.cover_url && i.type !== 'music')
      .sort(byCompleted)
    if (diary.length) return diary
    return [...allItems].filter(i => i.type !== 'music').sort(byRecent).slice(0, 1)
  }, [allItems])

  /** Categories that actually have something to show, in canonical order. */
  const activeCats = CATEGORIES.filter(c => (recentByType[c.key]?.length ?? 0) > 0)

  /* ─── sections: hero + one block per active category ─── */
  const sectionCount = 1 + activeCats.length

  const [index, setIndex] = useState(0)
  const indexRef = useRef(0)
  const animatingRef = useRef(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const touchY = useRef<number | null>(null)

  const goTo = (next: number) => {
    next = Math.min(sectionCount - 1, Math.max(0, next))
    if (next === indexRef.current) return
    indexRef.current = next
    setIndex(next)
    // Block re-triggers until the smooth transition settles.
    animatingRef.current = true
    window.setTimeout(() => { animatingRef.current = false }, 900)
  }
  const go = (dir: 1 | -1) => goTo(indexRef.current + dir)

  // keep refs valid if section count shrinks (e.g. data loads)
  useEffect(() => {
    if (indexRef.current > sectionCount - 1) {
      indexRef.current = sectionCount - 1
      setIndex(sectionCount - 1)
    }
  }, [sectionCount])

  /* ─── scrolljacking: one block per gesture, vertically ─── */
  useEffect(() => {
    const el = containerRef.current
    if (!el) return

    const onWheel = (e: WheelEvent) => {
      // let horizontal intent flow to the carousels
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return
      e.preventDefault()
      if (animatingRef.current || Math.abs(e.deltaY) < 8) return
      go(e.deltaY > 0 ? 1 : -1)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowDown' || e.key === 'PageDown') { e.preventDefault(); go(1) }
      if (e.key === 'ArrowUp'   || e.key === 'PageUp')   { e.preventDefault(); go(-1) }
    }
    const onTouchStart = (e: TouchEvent) => { touchY.current = e.touches[0].clientY }
    const onTouchMove  = (e: TouchEvent) => { if (touchY.current !== null) e.preventDefault() }
    const onTouchEnd   = (e: TouchEvent) => {
      if (touchY.current === null) return
      const dy = touchY.current - e.changedTouches[0].clientY
      touchY.current = null
      if (!animatingRef.current && Math.abs(dy) > 45) go(dy > 0 ? 1 : -1)
    }

    el.addEventListener('wheel', onWheel, { passive: false })
    el.addEventListener('touchstart', onTouchStart, { passive: true })
    el.addEventListener('touchmove', onTouchMove, { passive: false })
    el.addEventListener('touchend', onTouchEnd, { passive: true })
    window.addEventListener('keydown', onKey)
    return () => {
      el.removeEventListener('wheel', onWheel)
      el.removeEventListener('touchstart', onTouchStart)
      el.removeEventListener('touchmove', onTouchMove)
      el.removeEventListener('touchend', onTouchEnd)
      window.removeEventListener('keydown', onKey)
    }
  }, [sectionCount])

  /* ─── empty state ─── */
  if (allItems.length === 0) {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--border)' }}>Vazio</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Pressione ⌘K para adicionar algo</p>
      </div>
    )
  }

  const HERO_H = 'calc(100vh - var(--nav-h) - var(--npbar-h, 0px) - var(--bottomnav-h))'

  return (
    <div
      ref={containerRef}
      style={{ height: HERO_H, overflow: 'hidden', position: 'relative', background: 'var(--bg)' }}
    >
      {/* Section track */}
      <div
        style={{
          height: '100%',
          transform: `translateY(-${index * 100}%)`,
          transition: BLOCK_EASE,
        }}
      >
        {/* ── Hero: diary carousel (completed items, newest-first) ── */}
        <section style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
          <HeroCarousel items={heroSlides} />

          {/* scroll hint */}
          {sectionCount > 1 && (
            <button
              onClick={() => go(1)}
              style={{ position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)', zIndex: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase' }}
            >
              Role para explorar
              <span className="scroll-hint-chevron" style={{ fontSize: 20, lineHeight: 1 }}>⌄</span>
            </button>
          )}
        </section>

        {/* ── One block per category: recent covers in an auto-carousel ── */}
        {activeCats.map(cat => {
          const items = recentByType[cat.key]
          const artCover = items.find(i => i.cover_url)?.cover_url ?? undefined
          return (
            <section
              key={cat.key}
              style={{ height: '100%', position: 'relative', overflow: 'hidden', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
            >
              <BlockBg colorVar={cat.colorVar} art={artCover} />

              <div style={{ position: 'relative', maxWidth: 1400, width: '100%', margin: '0 auto', padding: '0 var(--page-x)' }}>
                <div style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', marginBottom: 28, gap: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: 16, flexWrap: 'wrap' }}>
                    <h2 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(28px,3.4vw,44px)', fontWeight: 800, letterSpacing: '-1.5px', color: 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 14 }}>
                      <span style={{ fontSize: '0.9em' }}>{cat.emoji}</span>
                      {cat.label}
                    </h2>
                    <span
                      title="Itens concluídos"
                      style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 15, fontWeight: 600, color: `var(${cat.colorVar})`, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 9999, padding: '4px 14px', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {completedCount(cat.key)} concluído{completedCount(cat.key) === 1 ? '' : 's'}
                    </span>
                  </div>
                  <button
                    onClick={() => navigate(cat.path)}
                    className="link-accent"
                    style={{ fontSize: 14, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', whiteSpace: 'nowrap' }}
                  >
                    Ver todos →
                  </button>
                </div>

                <AutoCarousel items={items} />
              </div>
            </section>
          )
        })}
      </div>

      {/* ── Section dots ── */}
      {sectionCount > 1 && (
        <div style={{ position: 'absolute', right: 22, top: '50%', transform: 'translateY(-50%)', display: 'flex', flexDirection: 'column', gap: 12, zIndex: 5 }}>
          {Array.from({ length: sectionCount }).map((_, i) => (
            <button
              key={i}
              onClick={() => { if (!animatingRef.current) goTo(i) }}
              aria-label={`Ir para bloco ${i + 1}`}
              style={{
                width: 9, height: 9, borderRadius: '50%', border: 'none', cursor: 'pointer', padding: 0,
                background: i === index ? 'var(--accent)' : 'var(--border-strong)',
                transform: i === index ? 'scale(1.35)' : 'scale(1)',
                transition: 'background .25s, transform .25s',
              }}
            />
          ))}
        </div>
      )}

      {/* ── Back to top ── */}
      {sectionCount > 1 && (
        <button
          onClick={() => goTo(0)}
          aria-label="Voltar ao topo"
          className="back-to-top"
          style={{
            position: 'absolute', bottom: 28, right: 28, zIndex: 6,
            display: 'flex', alignItems: 'center', gap: 8,
            padding: '10px 18px 10px 14px', borderRadius: 9999,
            background: 'var(--surface)', border: '1px solid var(--border-strong)',
            color: 'var(--text-primary)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
            boxShadow: 'var(--shadow-lg)',
            opacity: index > 0 ? 1 : 0,
            transform: index > 0 ? 'translateY(0)' : 'translateY(12px)',
            pointerEvents: index > 0 ? 'auto' : 'none',
          }}
        >
          <span style={{ fontSize: 16, lineHeight: 1 }}>↑</span>
          Topo
        </button>
      )}
    </div>
  )
}
