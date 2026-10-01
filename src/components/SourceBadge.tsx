import type { GameDataSource } from '../types'

const TITLE = 'Verificado pela Steam: informação vinda direto da sua conta Steam'

/** Ícone de "verificado": selo com ✓, desenhado aqui (não é o logo da Steam). */
function VerifiedIcon({ size }: { size: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M8 .8l1.7 1.3 2.1-.2.8 2 1.9 1-.4 2.1L15.2 8l-1.1 1.8.4 2.1-1.9 1-.8 2-2.1-.2L8 15.2l-1.7-1.3-2.1.2-.8-2-1.9-1 .4-2.1L.8 8l1.1-1.8L1.5 4.1l1.9-1 .8-2 2.1.2z" />
      <path fill="none" stroke="var(--steam-solid)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" d="M5 8.2l2 2 4-4.3" />
    </svg>
  )
}

interface Props {
  source: GameDataSource | null | undefined
}

/**
 * Selo de procedência no estilo "verificado": só aparece para dado que veio
 * direto da Steam. O que foi gerado ou editado no Shelf fica sem selo.
 */
export function SourceBadge({ source }: Props) {
  if (source !== 'steam') return null
  return (
    <span
      title={TITLE}
      aria-label={TITLE}
      role="img"
      className="inline-flex items-center gap-1 rounded-full align-middle normal-case tracking-normal"
      style={{
        background: 'var(--steam-solid)', color: '#fff', fontSize: 10, fontWeight: 700,
        padding: '2px 7px 2px 4px', lineHeight: 1.3, boxShadow: '0 0 0 1px rgba(255,255,255,.12), 0 2px 8px var(--steam-glow)',
        whiteSpace: 'nowrap',
      }}
    >
      <VerifiedIcon size={12} />
      Steam
    </span>
  )
}

/**
 * Marca de jogo verificado pela Steam, para capas e títulos.
 * - `cover`: pílula no canto da capa;
 * - `title`: "Verificado pela Steam" ao lado do nome do jogo.
 */
export function SteamVerifiedMark({ variant }: { variant: 'cover' | 'title' }) {
  const label = variant === 'title' ? 'Verificado pela Steam' : 'Steam'
  return (
    <span
      title={TITLE}
      aria-label={TITLE}
      role="img"
      className="inline-flex items-center rounded-full normal-case tracking-normal"
      style={{
        background: 'var(--steam-solid)', color: '#fff', fontWeight: 700, whiteSpace: 'nowrap',
        gap: variant === 'title' ? 6 : 4,
        fontSize: variant === 'title' ? 13 : 11,
        padding: variant === 'title' ? '4px 12px 4px 6px' : '3px 9px 3px 5px',
        boxShadow: '0 0 0 1px rgba(255,255,255,.18), 0 4px 14px var(--steam-glow)',
        // Canto esquerdo: o direito costuma ter botão (fechar, favorito).
        ...(variant === 'cover' ? { position: 'absolute' as const, top: 8, left: 8, zIndex: 2 } : {}),
      }}
    >
      <VerifiedIcon size={variant === 'title' ? 16 : 14} />
      {label}
    </span>
  )
}
