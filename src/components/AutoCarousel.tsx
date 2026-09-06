import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { MediaItem } from '../types'
import { STATUS_LABEL } from '../lib/utils'

interface Props {
  items: MediaItem[]
  /** Poster width in px — every card follows the same standard. */
  cardWidth?: number
  /** Auto-scroll speed in px per frame (~60fps). Keep it low. */
  speed?: number
}

/** A single uniform poster: cover always fills the frame (object-cover). */
function Poster({ item, width }: { item: MediaItem; width: number }) {
  const [broken, setBroken] = useState(false)
  const showImg = item.cover_url && !broken

  return (
    <Link
      to={`/media/${item.id}`}
      className="group"
      style={{ width, flex: `0 0 ${width}px`, textDecoration: 'none' }}
      draggable={false}
    >
      <div
        style={{
          position: 'relative',
          width: '100%',
          aspectRatio: '2 / 3',
          borderRadius: 12,
          overflow: 'hidden',
          background: 'var(--card)',
          border: '1px solid var(--border)',
          transition: 'border-color .25s, transform .35s var(--spring), box-shadow .35s',
        }}
        className="poster-frame"
      >
        {showImg ? (
          <img
            src={item.cover_url!}
            alt={item.title}
            loading="lazy"
            draggable={false}
            onError={() => setBroken(true)}
            style={{
              width: '100%',
              height: '100%',
              objectFit: 'cover',
              objectPosition: 'center',
              display: 'block',
            }}
          />
        ) : (
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--card)',
            }}
          >
            <span
              style={{
                fontFamily: 'Space Grotesk, sans-serif',
                fontSize: '4.5rem',
                fontWeight: 900,
                lineHeight: 1,
                color: 'var(--dim)',
                textTransform: 'uppercase',
                userSelect: 'none',
              }}
            >
              {item.title[0]}
            </span>
          </div>
        )}

        {/* bottom gradient + title on hover */}
        <div
          className="poster-overlay"
          style={{
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
            padding: 12,
            background: 'linear-gradient(to top, rgba(0,0,0,.82) 0%, rgba(0,0,0,.15) 45%, transparent 70%)',
            opacity: 0,
            transition: 'opacity .25s',
          }}
        >
          <p
            style={{
              fontFamily: 'Space Grotesk, sans-serif',
              fontSize: 13,
              fontWeight: 700,
              color: '#fff',
              lineHeight: 1.25,
              display: '-webkit-box',
              WebkitLineClamp: 2,
              WebkitBoxOrient: 'vertical',
              overflow: 'hidden',
            }}
          >
            {item.title}
          </p>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,.7)', marginTop: 4 }}>
            {item.year ?? '—'} · {STATUS_LABEL[item.status]}
          </span>
        </div>
      </div>
    </Link>
  )
}

/**
 * Horizontal carousel that scrolls on its own at a low speed and loops
 * seamlessly. Pauses while hovered so the user can read/click a poster.
 */
export function AutoCarousel({ items, cardWidth = 190, speed = 0.35 }: Props) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(false)
  const rafRef = useRef<number>()

  // A single item has nothing to scroll — show it as-is. With ≥2 items we
  // repeat the list to fill the row, then duplicate the whole block once more
  // so we can loop back seamlessly at the halfway point.
  const looping = items.length >= 2
  const filled: MediaItem[] = (() => {
    if (items.length === 0) return []
    if (!looping) return items
    let base = items
    while (base.length < 8) base = base.concat(items)
    return base.concat(base)
  })()

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return

    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    if (reduce || !looping) return

    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      if (!pausedRef.current) {
        el.scrollLeft += speed * (dt / 16.67)
        const half = el.scrollWidth / 2
        if (half > 0 && el.scrollLeft >= half) el.scrollLeft -= half
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [speed, items.length])

  if (items.length === 0) return null

  return (
    <div
      ref={scrollRef}
      className="scrollbar-hide"
      onMouseEnter={() => { pausedRef.current = true }}
      onMouseLeave={() => { pausedRef.current = false }}
      style={{
        display: 'flex',
        gap: 20,
        overflowX: 'auto',
        overflowY: 'hidden',
        paddingBottom: 4,
        scrollbarWidth: 'none',
        msOverflowStyle: 'none',
        WebkitOverflowScrolling: 'touch',
      }}
    >
      {filled.map((item, i) => (
        <Poster key={`${item.id}-${i}`} item={item} width={cardWidth} />
      ))}
    </div>
  )
}
