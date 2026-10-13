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
  const box = useRef<HTMLDivElement>(null)
  // Touch/pen select by pressing and dragging; the commit happens on release.
  const drag = useRef<{ start: number; moved: boolean } | null>(null)
  const lastType = useRef<string>('mouse')

  const px = size === 'sm' ? 16 : size === 'lg' ? 28 : 22
  const display = hover ?? value
  // Perfect score → golden stars.
  const fullColor = display >= 5 ? 'var(--gold)' : 'var(--accent)'

  // Maps a horizontal position to 0.5..5 in half-star steps.
  const valueAt = (clientX: number) => {
    const stars = box.current?.querySelectorAll('button')
    if (!stars?.length) return value
    let result = 0.5
    stars.forEach((el, i) => {
      const r = el.getBoundingClientRect()
      if (clientX >= r.left) result = clientX < r.left + r.width / 2 ? i + 0.5 : i + 1
    })
    return result
  }

  const interactive = !readonly && !!onChange

  return (
    <div
      ref={box}
      className="flex items-center"
      style={{ gap: 2, touchAction: interactive ? 'pan-y' : undefined }}
      onMouseLeave={() => !readonly && setHover(null)}
      onPointerDown={e => {
        lastType.current = e.pointerType
        if (!interactive || e.pointerType === 'mouse') return
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { start: valueAt(e.clientX), moved: false }
        setHover(drag.current.start)
      }}
      onPointerMove={e => {
        if (!interactive) return
        if (e.pointerType === 'mouse') { setHover(valueAt(e.clientX)); return }
        if (!drag.current) return
        const v = valueAt(e.clientX)
        if (v !== drag.current.start) drag.current.moved = true
        setHover(v)
      }}
      onPointerUp={e => {
        if (!interactive || e.pointerType === 'mouse' || !drag.current) return
        const v = valueAt(e.clientX)
        const tap = !drag.current.moved && v === value
        drag.current = null
        setHover(null)
        onChange!(tap ? 0 : v)
      }}
      onPointerCancel={() => { drag.current = null; setHover(null) }}
      onClick={e => {
        if (!interactive || lastType.current !== 'mouse') return
        // Keyboard activation (detail 0) has no pointer position: use the focused star.
        const kb = e.detail === 0 ? (e.target as HTMLElement).closest('button')?.dataset.star : undefined
        const v = kb ? Number(kb) : valueAt(e.clientX)
        onChange!(v === value ? 0 : v)
        setHover(null)
      }}
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
            data-star={star}
            type="button"
            disabled={readonly}
            aria-label={`${star} ${star === 1 ? 'estrela' : 'estrelas'}`}
            style={{ width: px, height: px, padding: 0, background: 'none', border: 'none' }}
            className={`flex-shrink-0 ${readonly ? 'cursor-default' : 'cursor-pointer'}`}
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
