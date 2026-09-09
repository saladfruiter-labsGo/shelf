import { formatMoney, timeAgo } from '../lib/utils'
import type { GamePriceSummary } from '../types'

/**
 * Resumo de preço no card do backlog.
 * O link da oferta é independente do card: clicar nele não navega para a página
 * interna do jogo.
 */
export function PriceBadge({ summary }: { summary: GamePriceSummary | undefined }) {
  const label = (text: string, color = 'var(--text-muted)') => (
    <p style={{ fontSize: 12, color, marginBottom: 8 }}>{text}</p>
  )

  if (!summary) return label('—')
  if (summary.match_status === 'ambiguous')  return label('Correspondência necessária', 'var(--movies)')
  if (summary.match_status === 'not_found')  return label('Sem correspondência')
  if (summary.match_status === 'pending')    return label('Buscando preço…')
  if (!summary.best)                         return label('Sem oferta na região')

  const { best } = summary
  const currency = summary.currency ?? best.currency

  return (
    <div style={{ marginBottom: 8 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 6, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 13, color: 'var(--text-muted)' }}>A partir de</span>
        <span style={{
          fontFamily: 'Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700,
          color: summary.is_history_low ? 'var(--games)' : 'var(--text-primary)',
        }}>
          {formatMoney(best.price_minor, currency)}
        </span>
        {best.discount_percent > 0 && (
          <span style={{
            fontSize: 11, fontWeight: 700, color: 'var(--games)', background: 'var(--games-bg)',
            borderRadius: 6, padding: '1px 5px',
          }}>
            −{best.discount_percent}%
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap', marginTop: 2 }}>
        <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{best.shop_name}</span>
        {summary.is_history_low && (
          <span style={{
            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.5px',
            color: 'var(--games)', border: '1px solid var(--games)', borderRadius: 999, padding: '0 5px',
          }}>
            menor histórico
          </span>
        )}
        {summary.stale && (
          <span style={{ fontSize: 10, color: 'var(--movies)' }} title="O provedor não respondeu na última tentativa">
            dados desatualizados
          </span>
        )}
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
        {best.url && (
          <a
            href={best.url}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={e => e.stopPropagation()}
            className="link-accent"
            style={{ fontSize: 11, color: 'var(--accent)', textDecoration: 'none' }}
          >
            Ver oferta ↗
          </a>
        )}
        {summary.last_synced_at && (
          <span style={{ fontSize: 10, color: 'var(--dim)' }}>atualizado há {timeAgo(summary.last_synced_at)}</span>
        )}
      </div>
    </div>
  )
}
