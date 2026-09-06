import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { MediaItem } from '../types'
import { fmtRating } from '../lib/utils'
import { StarRating } from './StarRating'

interface Props {
  items: MediaItem[]
  /** Poster height as a CSS length — width follows the 2:3 ratio. */
  posterHeight?: string
  /** Auto-scroll speed in px per frame (~60fps). */
  speed?: number
}

/** A single uniform poster: cover always fills the frame (object-cover). */
function Poster({ item }: { item: MediaItem }) {
  const [broken, setBroken] = useState(false)
  const showImg = item.cover_url && !broken

  return (
    <Link
      to={`/media/${item.id}`}
      className="group"
      draggable={false}
      style={{ flex: '0 0 auto', width: 'calc(var(--ph) * 2 / 3)', textDecoration: 'none' }}
    >
      <div
        className="poster-frame"
        style={{
          position: 'relative',
          width: '100%',
          height: 'var(--ph)',
          borderRadius: 16,
          overflow: 'hidden',
          background: 'var(--card)',
          border: '1px solid var(--border)',
          transition: 'border-color .25s, transform .35s var(--spring), box-shadow .35s',
        }}
      >
        {showImg ? (
          <img
            src={item.cover_url!}
            alt={item.title}
            loading="lazy"
            draggable={false}
            onError={() => setBroken(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card)' }}>
            <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '6rem', fontWeight: 900, lineHeight: 1, color: 'var(--dim)', textTransform: 'uppercase', userSelect: 'none' }}>
              {item.title[0]}
            </span>
          </div>
        )}

        {/* bottom gradient: title reveals on hover, rating is always visible */}
        <div
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
            padding: 14,
            background: 'linear-gradient(to top, rgba(0,0,0,.9) 0%, rgba(0,0,0,.35) 30%, transparent 58%)',
            pointerEvents: 'none',
          }}
        >
          <p
            className="poster-title-reveal"
            style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, color: '#fff', lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden', opacity: 0, transform: 'translateY(6px)', transition: 'opacity .25s, transform .25s' }}
          >
            {item.title}
          </p>
          {/* rating — always shown: stars + number */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 7, marginTop: 8 }}>
            <StarRating value={item.rating} readonly size="sm" />
            <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 13, fontWeight: 700, color: item.rating >= 5 ? 'var(--gold)' : '#fff' }}>
              {fmtRating(item.rating)}
            </span>
          </div>
        </div>
      </div>
    </Link>
  )
}

/**
 * Horizontal carousel that scrolls on its own at a low speed and loops
 * seamlessly, driven by a transform (reliable sub-pixel motion). Pauses on
 * hover so the user can read/click a poster.
 */
export function AutoCarousel({ items, posterHeight = 'clamp(300px, 56vh, 580px)', speed = 0.8 }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(false)
  const offsetRef = useRef(0)
  const rafRef = useRef<number>()

  // A single item has nothing to loop. With ≥2 items we repeat the list to
  // fill the row, then duplicate the whole block so we can wrap seamlessly.
  const looping = items.length >= 2
  const filled: MediaItem[] = (() => {
    if (items.length === 0) return []
    if (!looping) return items
    let base = items
    while (base.length < 8) base = base.concat(items)
    return base.concat(base)
  })()

  useEffect(() => {
    const track = trackRef.current
    if (!track || !looping) return

    offsetRef.current = 0
    track.style.transform = 'translateX(0px)'

    let last = performance.now()
    const tick = (now: number) => {
      const dt = now - last
      last = now
      if (!pausedRef.current) {
        offsetRef.current += speed * (dt / 16.67)
        const half = track.scrollWidth / 2
        if (half > 0 && offsetRef.current >= half) offsetRef.current -= half
        track.style.transform = `translateX(${-offsetRef.current}px)`
      }
      rafRef.current = requestAnimationFrame(tick)
    }
    rafRef.current = requestAnimationFrame(tick)
    return () => { if (rafRef.current) cancelAnimationFrame(rafRef.current) }
  }, [speed, items, looping])

  if (items.length === 0) return null

  return (
    <div
      className="scrollbar-hide"
      style={{ ['--ph' as string]: posterHeight, overflow: 'hidden', width: '100%' } as CSSProperties}
      onMouseEnter={() => { pausedRef.current = true }}
      onMouseLeave={() => { pausedRef.current = false }}
    >
      <div ref={trackRef} style={{ display: 'flex', gap: 24, width: 'max-content', willChange: 'transform' }}>
        {filled.map((item, i) => (
          <Poster key={`${item.id}-${i}`} item={item} />
        ))}
      </div>
    </div>
  )
}
