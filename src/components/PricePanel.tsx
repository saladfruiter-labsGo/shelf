import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { formatMoney, formatDate, timeAgo } from '../lib/utils'
import type { GamePriceDetails, GamePriceOffer, GamePricePoint, GamePriceRange } from '../types'

const RANGES: { value: GamePriceRange; label: string }[] = [
  { value: '30d', label: '30 dias' },
  { value: '90d', label: '3 meses' },
  { value: '1y',  label: '1 ano' },
  { value: 'all', label: 'Tudo' },
]

/* ────────────────────────────────── Gráfico ───────────────────────────────── */

const W = 640, H = 180, PAD_L = 8, PAD_R = 8, PAD_T = 14, PAD_B = 22

/**
 * Linha do menor preço disponível por dia. SVG próprio de propósito: o projeto
 * não usa biblioteca de gráficos e uma linha simples não justifica o bundle.
 * A tabela logo abaixo repete os mesmos dados para leitores de tela.
 */
function PriceChart({ points, currency }: { points: GamePricePoint[]; currency: string }) {
  const [hover, setHover] = useState<number | null>(null)

  if (points.length < 2) {
    return (
      <div className="h-[180px] flex items-center justify-center text-xs text-muted border border-border rounded-lg">
        Histórico ainda insuficiente para o gráfico.
      </div>
    )
  }

  const prices = points.map(p => p.price_minor)
  const min = Math.min(...prices)
  const max = Math.max(...prices)
  const span = max - min || Math.max(max, 1)

  const x = (i: number) => PAD_L + (i / (points.length - 1)) * (W - PAD_L - PAD_R)
  const y = (v: number) => PAD_T + (1 - (v - min) / span) * (H - PAD_T - PAD_B)

  const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(p.price_minor).toFixed(1)}`).join(' ')
  const area = `${line} L${x(points.length - 1).toFixed(1)},${H - PAD_B} L${x(0).toFixed(1)},${H - PAD_B} Z`
  const lowIdx = prices.indexOf(min)
  const active = hover != null ? points[hover] : null

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    const frac = (e.clientX - rect.left) / rect.width
    const i = Math.round(frac * (points.length - 1))
    setHover(Math.max(0, Math.min(points.length - 1, i)))
  }

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={`Menor preço por dia entre ${formatDate(points[0].day)} e ${formatDate(points[points.length - 1].day)}`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        style={{ display: 'block', width: '100%', height: 'auto', cursor: 'crosshair' }}
      >
        <path d={area} fill="var(--accent-bg)" />
        <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.6} strokeLinejoin="round" strokeLinecap="round" />

        {/* Menor preço do período */}
        <circle cx={x(lowIdx)} cy={y(min)} r={3.5} fill="var(--games)" />
        <text
          x={x(lowIdx)}
          y={y(min) - 7}
          // Junto às bordas o rótulo ancora para dentro, para não ser cortado.
          textAnchor={lowIdx < points.length * 0.12 ? 'start' : lowIdx > points.length * 0.88 ? 'end' : 'middle'}
          fontSize={9}
          fill="var(--games)"
          fontWeight={700}
        >
          {formatMoney(min, currency)}
        </text>

        {active && (
          <g>
            <line x1={x(hover!)} y1={PAD_T} x2={x(hover!)} y2={H - PAD_B} stroke="var(--border-strong)" strokeWidth={1} />
            <circle cx={x(hover!)} cy={y(active.price_minor)} r={3} fill="var(--accent)" />
          </g>
        )}

        <text x={PAD_L} y={H - 6} fontSize={9} fill="var(--text-muted)">{formatDate(points[0].day)}</text>
        <text x={W - PAD_R} y={H - 6} fontSize={9} fill="var(--text-muted)" textAnchor="end">
          {formatDate(points[points.length - 1].day)}
        </text>
      </svg>

      {active && (
        <div
          className="absolute top-0 bg-surface border border-border rounded-lg px-2.5 py-1.5 text-[11px] pointer-events-none shadow-xl"
          style={{ left: `${(hover! / (points.length - 1)) * 100}%`, transform: 'translateX(-50%)' }}
        >
          <p className="text-primary font-medium">{formatDate(active.day)}</p>
          <p className="text-muted">{active.shop_name}</p>
          <p className="text-primary">
            {formatMoney(active.price_minor, currency)}
            {active.discount_percent > 0 && (
              <>
                {' '}<span className="line-through text-muted">{formatMoney(active.regular_minor, currency)}</span>
                {' '}<span style={{ color: 'var(--games)' }}>−{active.discount_percent}%</span>
              </>
            )}
          </p>
        </div>
      )}
    </div>
  )
}

/* ─────────────────────────── Correspondência manual ───────────────────────── */

function MatchFinder({ mediaItemId, title, current }: { mediaItemId: number; title: string; current: string | null }) {
  const qc = useQueryClient()
  const [q, setQ] = useState(title)
  const [submitted, setSubmitted] = useState('')

  const { data, isFetching } = useQuery({
    queryKey: ['prices', 'matches', mediaItemId, submitted],
    queryFn: () => api.prices.matches(mediaItemId, submitted),
    enabled: !!submitted,
  })

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['prices', 'game', mediaItemId] })
    qc.invalidateQueries({ queryKey: ['prices', 'backlog'] })
  }

  const confirm = useMutation({
    mutationFn: (c: { id: string; title: string }) =>
      api.prices.setMatch(mediaItemId, { provider_game_id: c.id, title: c.title }),
    onSuccess: invalidate,
  })
  const unlink = useMutation({
    mutationFn: () => api.prices.setMatch(mediaItemId, { clear: true }),
    onSuccess: invalidate,
  })

  return (
    <div className="bg-card border border-border rounded-lg p-4">
      <p className="text-sm text-secondary mb-1">Confirme qual produto corresponde a este jogo</p>
      <p className="text-xs text-muted mb-3">
        Edições diferentes (Deluxe, GOTY, DLC) têm preços diferentes — por isso o Shelf não escolhe sozinho quando fica em dúvida.
      </p>

      <form
        onSubmit={e => { e.preventDefault(); setSubmitted(q.trim()) }}
        className="flex gap-2 mb-3"
      >
        <input
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Pesquisar título…"
          className="flex-1 bg-surface border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-accent"
          spellCheck={false}
        />
        <button type="submit" className="px-3 py-2 bg-accent text-bg rounded-lg text-sm font-medium hover:opacity-90">
          Buscar
        </button>
      </form>

      {isFetching && <p className="text-xs text-muted">Buscando…</p>}
      {!isFetching && submitted && (data?.candidates.length ?? 0) === 0 && (
        <p className="text-xs text-muted">Nenhum candidato encontrado para “{submitted}”.</p>
      )}

      <div className="space-y-1">
        {(data?.candidates ?? []).map(c => (
          <div key={c.id} className="flex items-center gap-3 py-1.5 border-b border-border last:border-0">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-primary truncate">{c.title}</p>
              <p className="text-[11px] text-muted">
                {c.type ?? 'desconhecido'}
                {c.id === current && ' · vinculado atualmente'}
              </p>
            </div>
            <button
              onClick={() => confirm.mutate({ id: c.id, title: c.title })}
              disabled={confirm.isPending || c.id === current}
              className="text-xs px-3 py-1.5 bg-surface border border-border rounded-lg text-primary hover:border-accent transition-colors disabled:opacity-40"
            >
              {c.id === current ? 'Vinculado' : 'Usar este'}
            </button>
          </div>
        ))}
      </div>

      {current && (
        <button
          onClick={() => unlink.mutate()}
          disabled={unlink.isPending}
          className="mt-3 text-xs text-muted hover:text-red-400 transition-colors"
        >
          Desassociar correspondência atual
        </button>
      )}
    </div>
  )
}

/* ──────────────────────────────── Indicadores ─────────────────────────────── */

function Stat({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div>
      <p className="text-[10px] text-muted uppercase tracking-wide mb-0.5">{label}</p>
      <p className="font-display text-lg font-bold" style={{ color: highlight ? 'var(--games)' : 'var(--text-primary)' }}>
        {value}
      </p>
    </div>
  )
}

/* ───────────────────────────────── Ofertas ────────────────────────────────── */

function OfferRow({ offer, currency, best }: { offer: GamePriceOffer; currency: string; best: boolean }) {
  const isShopLow = offer.available && offer.shop_low_minor != null && offer.price_minor <= offer.shop_low_minor

  return (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5 border-b border-border ${offer.available ? '' : 'opacity-60'}`}>
      {/* Loja */}
      <div className="min-w-[140px] flex-1">
        <p className="text-sm text-primary flex items-center gap-2">
          {offer.shop_name}
          {best && (
            <span className="text-[10px] font-bold uppercase tracking-wide px-1.5 rounded" style={{ color: 'var(--games)', background: 'var(--games-bg)' }}>
              melhor
            </span>
          )}
        </p>
        <p className="text-[11px] text-muted">
          {offer.drm ? `${offer.drm} · ` : ''}
          {offer.available ? `verificado há ${timeAgo(offer.last_seen_at)}` : `sem oferta · visto há ${timeAgo(offer.last_seen_at)}`}
          {offer.voucher && ` · cupom ${offer.voucher}`}
        </p>
      </div>

      {/* Preço atual */}
      <div className="text-right min-w-[92px]">
        <p className="text-[10px] text-muted uppercase tracking-wide">{offer.available ? 'Agora' : 'Último preço'}</p>
        <p className="text-sm font-medium" style={{ color: isShopLow ? 'var(--games)' : 'var(--text-primary)' }}>
          {formatMoney(offer.price_minor, currency)}
        </p>
        {offer.discount_percent > 0 && (
          <p className="text-[11px]">
            <span className="line-through text-muted">{formatMoney(offer.regular_minor, currency)}</span>{' '}
            <span style={{ color: 'var(--games)' }}>−{offer.discount_percent}%</span>
          </p>
        )}
      </div>

      {/* Menor histórico daquela loja + quando */}
      <div className="text-right min-w-[104px]">
        <p className="text-[10px] text-muted uppercase tracking-wide">Menor histórico</p>
        <p className="text-xs text-secondary">
          {offer.shop_low_minor != null ? formatMoney(offer.shop_low_minor, currency) : '—'}
        </p>
        <p className="text-[11px] text-muted">
          {offer.shop_low_at ? `há ${timeAgo(offer.shop_low_at)}` : '—'}
        </p>
      </div>

      {offer.available && offer.url ? (
        <a
          href={offer.url}
          target="_blank"
          rel="noopener noreferrer sponsored"
          className="text-xs px-3 py-1.5 bg-card border border-border rounded-lg text-primary hover:border-accent transition-colors whitespace-nowrap"
        >
          Ir para a loja ↗
        </a>
      ) : (
        <span className="text-xs text-muted whitespace-nowrap min-w-[104px] text-right">indisponível</span>
      )}
    </div>
  )
}

/* ─────────────────────────────────── Painel ───────────────────────────────── */

export function PricePanel({ mediaItemId, title }: { mediaItemId: number; title: string }) {
  const qc = useQueryClient()
  const [range, setRange] = useState<GamePriceRange>('90d')
  const [shop, setShop]   = useState<number | null>(null)
  const [msg, setMsg]     = useState('')
  const [showMatcher, setShowMatcher] = useState(false)

  const { data, isLoading } = useQuery<GamePriceDetails>({
    queryKey: ['prices', 'game', mediaItemId, range, shop],
    queryFn: () => api.prices.game(mediaItemId, { range, shop }),
  })

  const refresh = useMutation({
    mutationFn: () => api.prices.refresh(mediaItemId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prices', 'game', mediaItemId] })
      qc.invalidateQueries({ queryKey: ['prices', 'backlog'] })
      setMsg('Preços atualizados.')
      setTimeout(() => setMsg(''), 3000)
    },
    onError: (e: unknown) => { setMsg((e as Error).message || 'Falha ao atualizar.'); setTimeout(() => setMsg(''), 4000) },
  })

  if (isLoading) return <div className="h-24 bg-card rounded-lg animate-pulse mb-6" />
  if (!data) return null

  const currency = data.currency ?? 'BRL'
  const needsMatch = showMatcher || data.match.status === 'ambiguous' || data.match.status === 'not_found'

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between gap-3 mb-3 flex-wrap">
        <p className="text-xs text-muted uppercase tracking-wide">Preços</p>
        <div className="flex items-center gap-3">
          {msg && <span className="text-xs text-accent">{msg}</span>}
          {data.stale && data.match.status === 'resolved' && (
            <span className="text-[10px]" style={{ color: 'var(--movies)' }}>dados desatualizados</span>
          )}
          <button
            onClick={() => refresh.mutate()}
            disabled={refresh.isPending || !data.enabled}
            className="text-xs text-muted hover:text-primary transition-colors disabled:opacity-40"
          >
            {refresh.isPending ? 'Atualizando…' : '↻ Atualizar'}
          </button>
        </div>
      </div>

      {!data.enabled ? (
        <div className="bg-card border border-border rounded-lg p-4 text-sm text-muted">
          Acompanhamento de preços desativado. Ative o <b className="text-secondary">IsThereAnyDeal</b> e informe a chave de API em{' '}
          <a href="/settings" className="text-accent underline">Configurações</a>.
        </div>
      ) : needsMatch ? (
        <>
          <MatchFinder mediaItemId={mediaItemId} title={title} current={data.match.provider_game_id} />
          {showMatcher && data.match.status === 'resolved' && (
            <button onClick={() => setShowMatcher(false)} className="mt-2 text-[11px] text-muted hover:text-primary transition-colors">
              ← Voltar aos preços
            </button>
          )}
        </>
      ) : data.match.status === 'pending' ? (
        <div className="bg-card border border-border rounded-lg p-4 text-sm text-muted">
          Ainda não consultado. A próxima sincronização automática busca este jogo — ou use “Atualizar”.
        </div>
      ) : (
        <>
          {/* Indicadores */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
            <Stat
              label="Melhor preço"
              value={data.stats.current_minor != null ? formatMoney(data.stats.current_minor, currency) : '—'}
              highlight={data.stats.current_minor != null && data.stats.current_minor === data.stats.history_low_minor}
            />
            <Stat label="Menor histórico" value={data.stats.history_low_minor != null ? formatMoney(data.stats.history_low_minor, currency) : '—'} />
            <Stat label="Menor do mês"    value={data.stats.month_low_minor != null ? formatMoney(data.stats.month_low_minor, currency) : '—'} />
            <Stat label="Menor em 30 dias" value={data.stats.last30_low_minor != null ? formatMoney(data.stats.last30_low_minor, currency) : '—'} />
          </div>

          <p className="text-[11px] text-muted mb-4">
            {data.last_synced_at ? `Atualizado há ${timeAgo(data.last_synced_at)}` : 'Nunca atualizado'}
            {data.stats.local_since && ` · histórico local desde ${formatDate(data.stats.local_since)}`}
            {data.match.matched_title && ` · casado com “${data.match.matched_title}”`}
          </p>

          {data.best === null && (
            <p className="text-sm text-muted mb-4">Nenhuma oferta disponível na região configurada no momento.</p>
          )}

          {/* Gráfico */}
          <div className="flex flex-wrap items-center gap-2 mb-2">
            {RANGES.map(r => (
              <button
                key={r.value}
                onClick={() => setRange(r.value)}
                className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                  range === r.value ? 'bg-accent text-bg' : 'bg-card text-muted hover:text-primary border border-border'
                }`}
              >
                {r.label}
              </button>
            ))}
            {data.shops.length > 1 && (
              <select
                value={shop ?? ''}
                onChange={e => setShop(e.target.value ? Number(e.target.value) : null)}
                aria-label="Filtrar por loja"
                className="ml-auto bg-card border border-border rounded-full px-3 py-1 text-xs text-secondary outline-none focus:border-accent"
              >
                <option value="">Todas as lojas</option>
                {data.shops.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            )}
          </div>

          <PriceChart points={data.points} currency={currency} />

          {/* Alternativa textual ao gráfico */}
          <details className="mt-2 mb-5">
            <summary className="text-xs text-muted cursor-pointer hover:text-primary">
              Ver os dados do gráfico em tabela
            </summary>
            <div className="mt-2 max-h-64 overflow-y-auto border border-border rounded-lg">
              <table className="w-full text-xs">
                <caption className="sr-only">Menor preço disponível por dia</caption>
                <thead className="sticky top-0 bg-surface">
                  <tr className="text-muted text-left">
                    <th scope="col" className="px-3 py-2 font-medium">Data</th>
                    <th scope="col" className="px-3 py-2 font-medium">Loja</th>
                    <th scope="col" className="px-3 py-2 font-medium">Preço</th>
                    <th scope="col" className="px-3 py-2 font-medium">Regular</th>
                    <th scope="col" className="px-3 py-2 font-medium">Desconto</th>
                  </tr>
                </thead>
                <tbody>
                  {data.points.length === 0 ? (
                    <tr><td colSpan={5} className="px-3 py-3 text-muted">Sem dados no período.</td></tr>
                  ) : data.points.map(p => (
                    <tr key={p.day} className="border-t border-border">
                      <td className="px-3 py-1.5 text-secondary">{formatDate(p.day)}</td>
                      <td className="px-3 py-1.5 text-secondary">{p.shop_name}</td>
                      <td className="px-3 py-1.5 text-primary">{formatMoney(p.price_minor, currency)}</td>
                      <td className="px-3 py-1.5 text-muted">{formatMoney(p.regular_minor, currency)}</td>
                      <td className="px-3 py-1.5 text-muted">{p.discount_percent > 0 ? `−${p.discount_percent}%` : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>

          {/* Lojas */}
          {data.offers.length > 0 && (
            <div>
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <p className="text-xs text-muted uppercase tracking-wide">
                  Lojas · {data.offers.length}
                </p>
                <p className="text-[11px] text-muted">
                  {data.offers.filter(o => o.available).length} com oferta agora
                </p>
              </div>
              <div className="border-t border-border">
                {data.offers.map(o => (
                  <OfferRow
                    key={o.shop_id}
                    offer={o}
                    currency={currency}
                    best={o.shop_id === data.best?.shop_id}
                  />
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 mt-3 flex-wrap">
            <p className="text-[11px] text-muted">
              Preços e histórico por{' '}
              <a href="https://isthereanydeal.com/" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">
                IsThereAnyDeal
              </a>
              . Plataforma: PC.
            </p>
            <button
              onClick={() => setShowMatcher(true)}
              className="text-[11px] text-muted hover:text-primary transition-colors"
            >
              Corresponder a outro produto
            </button>
          </div>

          {data.last_error && (
            <p className="text-[11px] mt-2" style={{ color: 'var(--movies)' }}>Último erro: {data.last_error}</p>
          )}
        </>
      )}
    </div>
  )
}
