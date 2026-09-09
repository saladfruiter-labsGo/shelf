/**
 * Busca por nome das páginas de biblioteca — filtra o grid instantaneamente
 * (sem submit). O contador de resultados só aparece quando há algum filtro
 * ativo, para não poluir a tela em repouso.
 */
interface Props {
  value:       string
  onChange:    (v: string) => void
  placeholder?: string
  /** Rótulo do campo para leitores de tela, ex.: "Buscar série por nome". */
  ariaLabel:   string
  /** Quantidade exibida no grid — mostrada quando `showCount` é true. */
  count:       number
  showCount:   boolean
  /** Sufixo do contador, ex.: " · Finalizada" (filtro de status ativo). */
  countSuffix?: string
}

export function LibrarySearch({ value, onChange, placeholder = 'Buscar por nome…', ariaLabel, count, showCount, countSuffix }: Props) {
  return (
    <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 var(--page-x) 24px', display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
      <div style={{ position: 'relative', flex: '1 1 280px', maxWidth: 420 }}>
        <input
          value={value}
          onChange={e => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={ariaLabel}
          style={{
            width: '100%', boxSizing: 'border-box', padding: '10px 34px 10px 14px', borderRadius: 10,
            border: '1px solid var(--border)', background: 'var(--card)', color: 'var(--text-primary)', fontSize: 14, outline: 'none',
          }}
        />
        {value && (
          <button onClick={() => onChange('')} title="Limpar" aria-label="Limpar busca"
            style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 18, lineHeight: 1 }}>
            ×
          </button>
        )}
      </div>
      {showCount && (
        <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
          {count} resultado{count === 1 ? '' : 's'}{countSuffix ?? ''}
        </span>
      )}
    </div>
  )
}
