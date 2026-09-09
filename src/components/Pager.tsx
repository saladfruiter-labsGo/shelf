import { useEffect, useMemo, useRef, useState } from 'react'

/**
 * Paginação da **grade**, não da consulta.
 *
 * As telas de coleção trabalham sobre o conjunto inteiro: o Backlog monta os
 * seletores de gênero, ano, diretor e loja a partir de todos os itens e ordena
 * por preço com uma consulta em lote; as bibliotecas contam status e buscam por
 * nome. Se o servidor mandasse uma página por vez, o seletor de gênero listaria
 * os gêneros daquela página e a busca só acharia o que estivesse nela.
 *
 * Então os dados vêm completos (`api.media.listAll`, que busca em páginas até o
 * servidor devolver uma página curta) e só o que é desenhado é fatiado.
 */
export const PER_PAGE = 48

/** Páginas a mostrar: as pontas, a atual e as vizinhas; o resto vira reticência. */
export function pageWindow(current: number, total: number): (number | '…')[] {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1)
  const near = [current - 1, current, current + 1].filter(n => n > 1 && n < total)
  const out: (number | '…')[] = [1]
  if (near[0] > 2) out.push('…')
  out.push(...near)
  if (near[near.length - 1] < total - 1) out.push('…')
  out.push(total)
  return out
}

const pageBtn = (active: boolean): React.CSSProperties => ({
  background: active ? 'var(--accent)' : 'var(--card)',
  border: `1px solid ${active ? 'var(--accent)' : 'var(--border-strong)'}`,
  color: active ? 'var(--bg)' : 'var(--text-secondary)',
  borderRadius: 9999, padding: '7px 14px', fontSize: 13, fontWeight: active ? 700 : 500,
  cursor: 'pointer', outline: 'none', fontFamily: 'inherit', minWidth: 40,
})

export function Pager({ page, total, count, onGo, label = 'Paginação' }: {
  page: number
  total: number
  /** Total de itens depois dos filtros — para a linha "X–Y de Z". */
  count: number
  onGo: (p: number) => void
  label?: string
}) {
  if (total <= 1) return null
  const first = (page - 1) * PER_PAGE + 1
  const last  = Math.min(page * PER_PAGE, count)

  return (
    <nav
      aria-label={label}
      style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 48 }}
    >
      <button onClick={() => onGo(page - 1)} disabled={page === 1}
        style={{ ...pageBtn(false), opacity: page === 1 ? 0.4 : 1, cursor: page === 1 ? 'default' : 'pointer' }}>
        ← Anterior
      </button>

      {pageWindow(page, total).map((p, i) =>
        p === '…'
          ? <span key={`gap-${i}`} style={{ color: 'var(--text-muted)', padding: '0 4px', fontSize: 13 }}>…</span>
          : <button key={p} onClick={() => onGo(p)} aria-current={p === page ? 'page' : undefined} style={pageBtn(p === page)}>
              {p}
            </button>,
      )}

      <button onClick={() => onGo(page + 1)} disabled={page === total}
        style={{ ...pageBtn(false), opacity: page === total ? 0.4 : 1, cursor: page === total ? 'default' : 'pointer' }}>
        Próxima →
      </button>

      <p style={{ width: '100%', textAlign: 'center', marginTop: 12, fontFamily: 'Space Grotesk, monospace', fontSize: 12, color: 'var(--text-muted)' }}>
        {first}–{last} de {count}
      </p>
    </nav>
  )
}

/**
 * Estado da paginação de uma lista já filtrada.
 *
 * `resetOn` são os valores que, ao mudar, redefinem a página — filtro, busca,
 * ordenação. Sem isso o usuário fica numa página que a nova lista talvez nem
 * tenha. Devolve também a âncora para onde rolar ao trocar de página, para não
 * deixar ninguém no meio da grade anterior.
 */
export function usePagination<T>(items: T[], resetOn: unknown[]) {
  const [page, setPage] = useState(1)
  const anchor = useRef<HTMLDivElement>(null)
  const totalPages = Math.max(1, Math.ceil(items.length / PER_PAGE))

  useEffect(() => {
    setPage(1)
    // Os valores de `resetOn` são a dependência real; o array em si muda a cada
    // render, por isso é espalhado aqui.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, resetOn)

  const safePage = Math.min(page, totalPages)
  const pageItems = useMemo(
    () => items.slice((safePage - 1) * PER_PAGE, safePage * PER_PAGE),
    [items, safePage],
  )

  const goTo = (p: number) => {
    setPage(Math.min(Math.max(1, p), totalPages))
    anchor.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }

  return { page: safePage, totalPages, pageItems, goTo, anchor }
}
