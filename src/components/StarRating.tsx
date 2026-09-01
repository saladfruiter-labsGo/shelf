import { useState } from 'react'

interface Props {
  value: number
  onChange?: (v: number) => void
  readonly?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export function StarRating({ value, onChange, readonly = false, size = 'md' }: Props) {
  const [hover, setHover] = useState<number | null>(null)

  const sz = size === 'sm' ? 'text-sm' : size === 'lg' ? 'text-2xl' : 'text-lg'
  const display = hover ?? value

  return (
    <div className={`flex gap-0.5 ${sz}`} onMouseLeave={() => setHover(null)}>
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          disabled={readonly}
          className={`leading-none transition-colors ${
            readonly ? 'cursor-default' : 'cursor-pointer hover:scale-110'
          } ${star <= display ? 'text-accent' : 'text-border-strong'}`}
          onMouseEnter={() => !readonly && setHover(star)}
          onClick={() => {
            if (!readonly && onChange) {
              onChange(star === value ? 0 : star)
            }
          }}
        >
          ★
        </button>
      ))}
    </div>
  )
}
