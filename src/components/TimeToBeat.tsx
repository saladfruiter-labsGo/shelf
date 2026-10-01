import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { formatPlaytime } from '../lib/utils'

/** Médias da IGDB arredondadas: "~22h", não "~22h 13min". */
function approxHours(seconds: number): string {
  return seconds < 3600 ? `~${Math.max(1, Math.round(seconds / 60))}min` : `~${Math.round(seconds / 3600)}h`
}

/**
 * Tempo para zerar (IGDB): História, + Extras e 100%, com uma barra comparando
 * o seu tempo de jogo com o da história. Some quando a IGDB não tem dado — nada
 * de "0h".
 */
export function TimeToBeat({ mediaId, playtimeSeconds, enabled }: { mediaId: number; playtimeSeconds: number | null | undefined; enabled: boolean }) {
  const { data } = useQuery({
    queryKey: ['game-ttb', mediaId],
    queryFn: () => api.games.timeToBeat(mediaId),
    enabled,
    staleTime: 60 * 60_000,
  })
  if (!data || (!data.main && !data.extra && !data.complete)) return null

  const measures = [
    { label: 'História', value: data.main },
    { label: 'História + extras', value: data.extra },
    { label: '100%', value: data.complete },
  ].filter((m): m is { label: string; value: number } => !!m.value)
  const played = playtimeSeconds ?? 0
  const pct = data.main && played > 0 ? Math.min(100, Math.round((played / data.main) * 100)) : null

  return (
    <section aria-labelledby="game-ttb" className="mb-8">
      <h2 id="game-ttb" className="text-xs text-muted uppercase tracking-wide mb-3">
        Tempo para zerar <span className="normal-case tracking-normal">· via IGDB</span>
      </h2>
      <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))' }}>
        {measures.map(m => (
          <div key={m.label} className="bg-surface border border-border rounded-lg p-3">
            <p className="font-display text-lg font-bold text-primary">{approxHours(m.value)}</p>
            <p className="text-xs text-muted">{m.label}</p>
          </div>
        ))}
      </div>
      {pct != null && (
        <div className="mt-3">
          <div className="h-2 bg-card rounded-full overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
            aria-label="Seu tempo de jogo comparado ao tempo da história">
            <div className="h-full rounded-full" style={{ width: `${pct}%`, background: 'var(--games)' }} />
          </div>
          <p className="text-sm text-muted mt-1">
            Você jogou {formatPlaytime(played)} de {approxHours(data.main!)} da história
            {played > data.main! ? ' — já passou da média.' : '.'}
          </p>
        </div>
      )}
    </section>
  )
}
