import { useEffect, useRef, useState } from 'react'
import { api } from '../../lib/api'
import type { ReactionSummary } from '../../types'

export const REACTIONS = ['❤️', '🔥', '😂', '😮', '😢', '👏'] as const

/**
 * Curtir (❤️) com um toque e reagir com o seletor. O estado é otimista: o
 * número muda na hora e é corrigido pela resposta do servidor.
 */
export function Reactions({ targetType, targetId, initial, compact = false }: {
  targetType: 'post' | 'comment'
  targetId: number
  initial: ReactionSummary[]
  compact?: boolean
}) {
  const [reactions, setReactions] = useState(initial)
  const [open, setOpen] = useState(false)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => { setReactions(initial) }, [initial])

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', esc) }
  }, [open])

  const toggle = async (emoji: string) => {
    setOpen(false)
    const before = reactions
    const current = reactions.find(r => r.emoji === emoji)
    const optimistic = current
      ? reactions.map(r => r.emoji === emoji ? { ...r, mine: !r.mine, count: r.count + (r.mine ? -1 : 1) } : r).filter(r => r.count > 0)
      : [...reactions, { emoji, count: 1, mine: true, names: [] }]
    setReactions(optimistic)
    try {
      setReactions((await api.feed.react(targetType, targetId, emoji)).reactions)
    } catch {
      setReactions(before)
    }
  }

  const heart = reactions.find(r => r.emoji === '❤️')
  const size = compact ? 'text-sm' : ''

  return (
    <div ref={boxRef} className="relative flex items-center gap-1.5 flex-wrap">
      <button
        type="button"
        onClick={() => toggle('❤️')}
        aria-pressed={!!heart?.mine}
        aria-label={heart?.mine ? 'Descurtir' : 'Curtir'}
        className={`social-action ${heart?.mine ? 'is-on' : ''} ${size}`}
      >
        <span aria-hidden>{heart?.mine ? '❤️' : '🤍'}</span>
        {!compact && <span>Curtir</span>}
      </button>
      {reactions.map(r => (
        <button
          key={r.emoji}
          type="button"
          onClick={() => toggle(r.emoji)}
          aria-pressed={r.mine}
          title={r.names.join(', ')}
          aria-label={`${r.emoji} ${r.count}: ${r.names.join(', ')}`}
          className={`social-pill ${r.mine ? 'is-mine' : ''} ${size}`}
        >
          <span aria-hidden>{r.emoji}</span> {r.count}
        </button>
      ))}
      <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} aria-label="Reagir"
        className={`social-action ${size}`}>
        <span aria-hidden>😊</span>{!compact && <span>Reagir</span>}
      </button>
      {open && (
        <div role="menu" className="social-picker">
          {REACTIONS.map(emoji => (
            <button key={emoji} type="button" role="menuitem" onClick={() => toggle(emoji)} aria-label={`Reagir com ${emoji}`}>
              {emoji}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
