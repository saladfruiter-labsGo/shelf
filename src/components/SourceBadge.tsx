import type { GameDataSource } from '../types'

const LABEL: Partial<Record<GameDataSource, { text: string; title: string }>> = {
  steam: { text: 'Steam', title: 'Dado vindo direto da Steam' },
}

interface Props {
  source: GameDataSource | null | undefined
}

/**
 * Selo de procedência. Só aparece para dado que veio direto de um provedor
 * (hoje, a Steam); o que foi gerado ou editado no Shelf fica sem selo.
 */
export function SourceBadge({ source }: Props) {
  const label = source ? LABEL[source] : undefined
  if (!label) return null
  return (
    <span
      title={label.title}
      aria-label={label.title}
      className="inline-flex items-center gap-1 rounded-full border border-border px-1.5 py-px align-middle text-[10px] font-semibold normal-case tracking-normal text-muted"
    >
      <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="10.5" cy="5.5" r="3" />
        <circle cx="5" cy="11" r="2.2" />
        <path d="M8.2 7.6 6.6 9.4" />
      </svg>
      {label.text}
    </span>
  )
}
