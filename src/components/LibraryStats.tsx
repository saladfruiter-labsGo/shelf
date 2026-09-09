/**
 * Contadores clicáveis do cabeçalho das bibliotecas (Total / estados).
 * Clicar num contador filtra o grid pelo estado; clicar de novo no mesmo
 * contador (ou em "Total") limpa o filtro. Layout vem de `.lib-stats` no
 * index.css, compartilhado por todas as páginas de biblioteca.
 */
export interface LibraryStat<K extends string> {
  /** `null` = "Total" (sem filtro). */
  key:   K | null
  n:     number
  label: string
  color: string
}

interface Props<K extends string> {
  stats:    LibraryStat<K>[]
  active:   K | null
  onChange: (key: K | null) => void
}

export function LibraryStats<K extends string>({ stats, active, onChange }: Props<K>) {
  return (
    <div className="lib-stats">
      {stats.map(s => {
        const isActive = active === s.key
        return (
          <button
            key={s.label}
            onClick={() => onChange(s.key && isActive ? null : s.key)}
            title={s.key ? `Filtrar por ${s.label}` : 'Mostrar todos'}
            style={{
              textAlign: 'right', background: 'none', border: 'none', cursor: 'pointer', padding: '0 0 4px',
              borderBottom: `2px solid ${isActive ? s.color : 'transparent'}`, opacity: isActive ? 1 : 0.55,
              transition: 'opacity .15s',
            }}
          >
            <p className="lib-stat-n" style={{ fontFamily: 'Space Grotesk, sans-serif', fontWeight: 800, color: s.color, lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.n}</p>
            <p style={{ fontSize: 11, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '1px' }}>{s.label}</p>
          </button>
        )
      })}
    </div>
  )
}
