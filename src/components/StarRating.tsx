import { useState, useId, useRef } from 'react'

interface Props {
  value: number
  onChange?: (v: number) => void
  readonly?: boolean
  size?: 'sm' | 'md' | 'lg'
}

const PATH = 'M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z'

export function StarRating({ value, onChange, readonly = false, size = 'md' }: Props) {
  const [hover, setHover] = useState<number | null>(null)
  const uid = useId()
  // Track how the last interaction started. Touch pointers can't reliably hit
  // the left/right half of a small star, so we snap taps to whole stars.
  const lastPointer = useRef<string>('mouse')

  const px = size === 'sm' ? 16 : size === 'lg' ? 28 : 22
  const display = hover ?? value
  // Perfect score → golden stars.
  const fullColor = display >= 5 ? 'var(--gold)' : 'var(--accent)'

  return (
    <div
      className="flex items-center"
      style={{ gap: 2 }}
      onMouseLeave={() => !readonly && setHover(null)}
    >
      {/* Hidden SVG defs for half-star gradients */}
      <svg width={0} height={0} style={{ position: 'absolute', pointerEvents: 'none' }}>
        <defs>
          {[1, 2, 3, 4, 5].map(n => (
            <linearGradient key={n} id={`${uid}-h${n}`} x1="0" x2="1" y1="0" y2="0">
              <stop offset="50%" stopColor="var(--accent)" />
              <stop offset="50%" stopColor="var(--border-strong)" />
            </linearGradient>
          ))}
        </defs>
      </svg>

      {[1, 2, 3, 4, 5].map(star => {
        const filled = display >= star
        const half   = !filled && display >= star - 0.5

        return (
          <button
            key={star}
            type="button"
            disabled={readonly}
            style={{ width: px, height: px, padding: 0, background: 'none', border: 'none' }}
            className={`flex-shrink-0 transition-transform ${readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'}`}
            onPointerDown={e => { lastPointer.current = e.pointerType }}
            onPointerMove={e => {
              // Only fine pointers (mouse/pen) get half-star hover preview.
              if (readonly || e.pointerType === 'touch') return
              const rect = e.currentTarget.getBoundingClientRect()
              setHover(e.clientX < rect.left + rect.width / 2 ? star - 0.5 : star)
            }}
            onClick={() => {
              if (readonly || !onChange) return
              // Touch taps select the whole star; mouse/pen use the hovered half.
              const next = lastPointer.current === 'touch' ? star : (hover ?? star)
              onChange(next === value ? 0 : next)
              setHover(null)
            }}
          >
            <svg width={px} height={px} viewBox="0 0 24 24" style={{ display: 'block' }}>
              <path d={PATH} fill="var(--border-strong)" />
              {(filled || half) && (
                <path
                  d={PATH}
                  fill={half ? `url(#${uid}-h${star})` : fullColor}
                />
              )}
            </svg>
          </button>
        )
      })}
    </div>
  )
}
