import { useState, useId } from 'react'

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

  const px = size === 'sm' ? 16 : size === 'lg' ? 28 : 22
  const display = hover ?? value

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
            onMouseMove={e => {
              if (readonly) return
              const rect = e.currentTarget.getBoundingClientRect()
              setHover(e.clientX < rect.left + rect.width / 2 ? star - 0.5 : star)
            }}
            onClick={() => {
              if (readonly || !onChange) return
              const next = hover ?? star
              onChange(next === value ? 0 : next)
            }}
          >
            <svg width={px} height={px} viewBox="0 0 24 24" style={{ display: 'block' }}>
              <path d={PATH} fill="var(--border-strong)" />
              {(filled || half) && (
                <path
                  d={PATH}
                  fill={half ? `url(#${uid}-h${star})` : 'var(--accent)'}
                />
              )}
            </svg>
          </button>
        )
      })}
    </div>
  )
}
