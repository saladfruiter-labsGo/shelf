import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { CATEGORIES } from '../lib/categories'
import { fmtRating, formatDate } from '../lib/utils'
import { StarRating } from './StarRating'
import type { MediaItem } from '../types'

interface Props {
  /** Diary items (completed), already ordered newest-first. */
  items: MediaItem[]
}

/**
 * Full-screen hero that cycles through the diary (completed items) in order,
 * auto-advancing with a horizontal slide. Blurred cover as ambient art +
 * a sharp poster so it reads well for any category.
 */
export function HeroCarousel({ items }: Props) {
  const navigate = useNavigate()
  const slides = items.slice(0, 8)
  const [i, setI] = useState(0)
  const pausedRef = useRef(false)

  const n = slides.length

  // auto-advance to the right
  useEffect(() => {
    if (n <= 1) return
    const id = window.setInterval(() => {
      if (!pausedRef.current) setI(prev => (prev + 1) % n)
    }, 5500)
    return () => window.clearInterval(id)
  }, [n])

  useEffect(() => { if (i > n - 1) setI(0) }, [i, n])

  if (n === 0) return null

  return (
    <div
      style={{ position: 'absolute', inset: 0, overflow: 'hidden' }}
      onMouseEnter={() => { pausedRef.current = true }}
      onMouseLeave={() => { pausedRef.current = false }}
    >
      {/* slides track */}
      <div style={{ display: 'flex', height: '100%', width: '100%', transform: `translateX(-${i * 100}%)`, transition: 'transform .8s cubic-bezier(.65,0,.35,1)' }}>
        {slides.map(item => {
          const cat = CATEGORIES.find(c => c.key === item.type)
          const when = item.completed_at ?? item.updated_at
          return (
            <div key={item.id} style={{ flex: '0 0 100%', position: 'relative', height: '100%', overflow: 'hidden' }}>
              {/* ambient blurred cover */}
              {item.cover_url && (
                <div aria-hidden style={{ position: 'absolute', inset: 0, backgroundImage: `url(${item.cover_url})`, backgroundSize: 'cover', backgroundPosition: 'center', filter: 'blur(24px) brightness(.5)', transform: 'scale(1.15)' }} />
              )}
              <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to top, var(--bg) 1%, rgba(0,0,0,.15) 40%, rgba(0,0,0,.35) 100%)' }} />
              <div aria-hidden style={{ position: 'absolute', inset: 0, background: 'linear-gradient(to right, rgba(0,0,0,.75) 0%, rgba(0,0,0,.35) 45%, transparent 70%)' }} />

              <div style={{ position: 'relative', height: '100%', maxWidth: 1200, margin: '0 auto', padding: '0 var(--page-x)', display: 'flex', alignItems: 'center', gap: 56 }}>
                {/* text column */}
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: '#fff', opacity: .8, marginBottom: 20 }}>
                    Do diário · concluído em {formatDate(when)}
                  </p>
                  <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(44px,6vw,84px)', fontWeight: 800, lineHeight: 1.02, letterSpacing: '-2.5px', color: '#fff', maxWidth: 760, marginBottom: 24, textShadow: '0 2px 30px rgba(0,0,0,.5)' }}>
                    {item.title}
                  </h1>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 40, color: 'rgba(255,255,255,.85)', fontSize: 14 }}>
                    <span className={`cat-badge cat-${item.type}`}>{cat?.label}</span>
                    <span>{item.year ?? '—'}</span>
                    <span style={{ opacity: .5 }}>·</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: 8, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.6))' }}>
                      <StarRating value={item.rating} readonly size="sm" />
                      <span style={{ fontWeight: 700, color: item.rating >= 5 ? 'var(--gold)' : '#fff' }}>{fmtRating(item.rating)}</span>
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 12 }}>
                    <button
                      onClick={() => navigate(`/media/${item.id}`)}
                      className="btn-accent"
                      style={{ padding: '12px 28px', background: 'var(--accent)', border: 'none', borderRadius: 9999, color: '#000', fontSize: 14, fontWeight: 700, cursor: 'pointer' }}
                    >
                      Ver detalhes →
                    </button>
                    <button
                      onClick={() => navigate('/diary')}
                      style={{ padding: '12px 28px', background: 'rgba(255,255,255,.12)', border: '1px solid rgba(255,255,255,.28)', borderRadius: 9999, color: '#fff', fontSize: 14, fontWeight: 600, cursor: 'pointer', backdropFilter: 'blur(8px)' }}
                    >
                      Ver diário
                    </button>
                  </div>
                </div>

                {/* sharp poster */}
                <div
                  onClick={() => navigate(`/media/${item.id}`)}
                  className="hero-poster"
                  style={{ flex: '0 0 auto', width: 'clamp(200px, 22vw, 320px)', aspectRatio: '2 / 3', borderRadius: 16, overflow: 'hidden', cursor: 'pointer', boxShadow: '0 30px 70px rgba(0,0,0,.6)', border: '1px solid rgba(255,255,255,.14)', background: 'var(--card)' }}
                >
                  {item.cover_url ? (
                    <img src={item.cover_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover', objectPosition: 'center', display: 'block' }} />
                  ) : (
                    <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <span style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '5rem', fontWeight: 900, color: 'var(--dim)', textTransform: 'uppercase' }}>{item.title[0]}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>

      {/* progress indicators */}
      {n > 1 && (
        <div style={{ position: 'absolute', bottom: 84, left: '50%', transform: 'translateX(-50%)', display: 'flex', gap: 8, zIndex: 4 }}>
          {slides.map((_, k) => (
            <button
              key={k}
              onClick={() => setI(k)}
              aria-label={`Item ${k + 1} do diário`}
              style={{ width: k === i ? 26 : 8, height: 8, borderRadius: 9999, border: 'none', cursor: 'pointer', padding: 0, background: k === i ? 'var(--accent)' : 'rgba(255,255,255,.4)', transition: 'width .3s, background .3s' }}
            />
          ))}
        </div>
      )}
    </div>
  )
}
