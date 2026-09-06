import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { AutoCarousel } from '../components/AutoCarousel'
import { CATEGORIES } from '../lib/categories'
import { STATUS_LABEL } from '../lib/utils'
import type { MediaItem, MediaType } from '../types'

const byRecent = (a: MediaItem, b: MediaItem) =>
  new Date(b.added_at).getTime() - new Date(a.added_at).getTime()

/** Tracks the user's reduced-motion preference, reactively. */
function usePrefersReducedMotion() {
  const [reduce, setReduce] = useState(
    () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches,
  )
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const on = () => setReduce(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return reduce
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

  const heroItem = useMemo(() => {
    const sorted = [...allItems].sort(byRecent)
    return sorted.find(i => i.cover_url) ?? sorted[0] ?? null
  }, [allItems])

  /** Categories that actually have something to show, in canonical order. */
  const activeCats = CATEGORIES.filter(c => (recentByType[c.key]?.length ?? 0) > 0)

  /* ─── sections: hero + one block per active category ─── */
  const sectionCount = 1 + activeCats.length

  const reduce = usePrefersReducedMotion()

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
    // Block re-triggers until the (possibly instant) transition settles.
    animatingRef.current = true
    window.setTimeout(() => { animatingRef.current = false }, reduce ? 140 : 820)
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
  }, [sectionCount, reduce])

  /* ─── empty state ─── */
  if (allItems.length === 0) {
    return (
      <div style={{ background: 'var(--bg)', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
        <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, textTransform: 'uppercase', color: 'var(--border)' }}>Vazio</p>
        <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Pressione ⌘K para adicionar algo</p>
      </div>
    )
  }

  const HERO_H = 'calc(100vh - var(--nav-h) - var(--npbar-h, 0px))'

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
          transition: reduce ? 'none' : 'transform .82s cubic-bezier(.16,1,.3,1)',
        }}
      >
        {/* ── Hero: full-screen art of the most recent media ── */}
        <section style={{ height: '100%', position: 'relative', overflow: 'hidden' }}>
          {heroItem?.cover_url && (
            <div
              aria-hidden
              style={{
                position: 'absolute', inset: 0,
                backgroundImage: `url(${heroItem.cover_url})`,
                backgroundSize: 'cover',
                backgroundPosition: 'center',
                filter: 'blur(2px)',
                transform: 'scale(1.06)',
              }}
            />
          )}
          {/* legibility scrims */}
          <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, var(--bg) 2%, rgba(0,0,0,.25) 45%, rgba(0,0,0,.55) 100%)' }} />
          <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(0,0,0,.7) 0%, transparent 55%)' }} />

          <div style={{ position: 'relative', height: '100%', maxWidth: 1200, margin: '0 auto', padding: '0 64px', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: '#fff', opacity: .8, marginBottom: 20 }}>
              Adicionado recentemente
            </p>
            <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(44px,6vw,84px)', fontWeight: 800, lineHeight: 1.02, letterSpacing: '-2.5px', color: '#fff', maxWidth: 760, marginBottom: 24, textShadow: '0 2px 30px rgba(0,0,0,.5)' }}>
              {heroItem?.title}
            </h1>
            {heroItem && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 40, color: 'rgba(255,255,255,.85)', fontSize: 14 }}>
                <span className={`cat-badge cat-${heroItem.type}`}>{CATEGORIES.find(c => c.key === heroItem.type)?.label}</span>
                <span>{heroItem.year ?? '—'}</span>
                <span style={{ opacity: .5 }}>·</span>
                <span>{STATUS_LABEL[heroItem.status]}</span>
              </div>
            )}
            <div style={{ display: 'flex', gap: 12 }}>
              {heroItem && (
                <button
                  onClick={() => navigate(`/media/${heroItem.id}`)}
                  className="btn-accent"
                  style={{ padding: '12px 28px', background: 'var(--accent)', border: 'none', borderRadius: 9999, color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                >
                  Ver detalhes →
                </button>
              )}
              <button
                onClick={() => navigate('/library')}
                style={{ padding: '12px 28px', background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.28)', borderRadius: 9999, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', backdropFilter: 'blur(8px)' }}
              >
                Ver biblioteca
              </button>
            </div>
          </div>

          {/* scroll hint */}
          {sectionCount > 1 && (
            <button
              onClick={() => go(1)}
              style={{ position: 'absolute', bottom: 28, left: '50%', transform: 'translateX(-50%)', background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,.75)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, fontSize: 11, letterSpacing: '1.5px', textTransform: 'uppercase' }}
            >
              Role para explorar
              <span className="scroll-hint-chevron" style={{ fontSize: 20, lineHeight: 1 }}>⌄</span>
            </button>
          )}
        </section>

        {/* ── One block per category: recent covers in an auto-carousel ── */}
        {activeCats.map(cat => {
          const items = recentByType[cat.key]
          return (
            <section
              key={cat.key}
              style={{ height: '100%', display: 'flex', flexDirection: 'column', justifyContent: 'center' }}
            >
              <div style={{ maxWidth: 1400, width: '100%', margin: '0 auto', padding: '0 64px' }}>
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

                <AutoCarousel items={items} cardWidth={200} />
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
    </div>
  )
}
