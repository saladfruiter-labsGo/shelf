import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { imageUrl } from '../lib/images'
import { useMediaPreview } from './MediaSummaryModal'

export interface MusicTile {
  /** Stable key for the tile (external_ref or title|artist). */
  key:       string
  title:     string
  artist:    string | null
  cover_url: string | null
}

interface Props {
  tiles: MusicTile[]
  /** Album-cover side length as a CSS length (square). */
  coverSize?: string
  /** Auto-scroll speed in px per frame (~60fps). */
  speed?: number
}

/** A single square album cover; the whole shelf links to the music library. */
function Cover({ tile }: { tile: MusicTile }) {
  const [broken, setBroken] = useState(false)
  const { openMedia } = useMediaPreview()
  const showImg = tile.cover_url && !broken

  return (
    <button
      type="button"
      onClick={() => openMedia({ type: 'music', title: tile.title, subtitle: tile.artist, cover_url: tile.cover_url })}
      aria-label={`Abrir resumo de ${tile.title}`}
      className="group"
      draggable={false}
      style={{ flex: '0 0 auto', width: 'var(--cs)', border: 0, padding: 0, background: 'transparent', textAlign: 'left', cursor: 'pointer' }}
    >
      <div
        className="poster-frame"
        style={{
          position: 'relative',
          width: '100%',
          height: 'var(--cs)',
          borderRadius: 16,
          overflow: 'hidden',
          background: 'var(--card)',
          border: '1px solid var(--border)',
          transition: 'border-color .25s, transform .35s var(--spring), box-shadow .35s',
        }}
      >
        {showImg ? (
          <img
            src={imageUrl(tile.cover_url, 640)!}
            alt={tile.title}
            loading="lazy"
            draggable={false}
            onError={() => setBroken(true)}
            style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }}
          />
        ) : (
          <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--card)' }}>
            <span style={{ fontSize: '3.5rem', lineHeight: 1, userSelect: 'none' }}>🎵</span>
          </div>
        )}

        {/* bottom gradient: track title + artist */}
        <div
          style={{
            position: 'absolute', inset: 0,
            display: 'flex', flexDirection: 'column', justifyContent: 'flex-end',
            padding: 14,
            background: 'linear-gradient(to top, rgba(0,0,0,.9) 0%, rgba(0,0,0,.35) 32%, transparent 60%)',
            pointerEvents: 'none',
          }}
        >
          <p
            style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, color: '#fff', lineHeight: 1.25, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
          >
            {tile.title}
          </p>
          {tile.artist && (
            <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 13, fontWeight: 600, color: 'rgba(255,255,255,.7)', marginTop: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {tile.artist}
            </p>
          )}
        </div>
      </div>
    </button>
  )
}

/**
 * Horizontal shelf of square album covers that auto-scrolls and loops
 * seamlessly (transform-driven, like AutoCarousel). Pauses on hover.
 */
export function MusicCarousel({ tiles, coverSize = 'clamp(240px, 44vh, 440px)', speed = 0.8 }: Props) {
  const trackRef = useRef<HTMLDivElement>(null)
  const pausedRef = useRef(false)
  const offsetRef = useRef(0)
  const rafRef = useRef<number>()

  // A single cover has nothing to loop. With ≥2 we repeat to fill the row,
  // then duplicate the whole block so we can wrap seamlessly.
  const looping = tiles.length >= 2
  const filled: MusicTile[] = (() => {
    if (tiles.length === 0) return []
    if (!looping) return tiles
    let base = tiles
    while (base.length < 8) base = base.concat(tiles)
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
  }, [speed, tiles, looping])

  if (tiles.length === 0) return null

  return (
    <div
      className="scrollbar-hide"
      style={{ ['--cs' as string]: coverSize, overflow: 'hidden', width: '100%' } as CSSProperties}
      onMouseEnter={() => { pausedRef.current = true }}
      onMouseLeave={() => { pausedRef.current = false }}
    >
      <div ref={trackRef} style={{ display: 'flex', gap: 24, width: 'max-content', willChange: 'transform' }}>
        {filled.map((tile, i) => (
          <Cover key={`${tile.key}-${i}`} tile={tile} />
        ))}
      </div>
    </div>
  )
}
