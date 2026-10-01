import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { imageUrl } from '../lib/images'
import { formatDate, formatPercent } from '../lib/utils'
import { SourceBadge } from './SourceBadge'
import type { GameAchievement } from '../types'

const INITIAL = 12

function rarityLabel(percent: number | null): string | null {
  if (percent == null) return null
  return percent < 5 ? `Rara · ${formatPercent(percent)}` : `${formatPercent(percent)} dos jogadores`
}

function AchievementRow({ a }: { a: GameAchievement }) {
  const icon = imageUrl(a.achieved ? a.icon : a.icon_gray ?? a.icon, 160)
  return (
    <li className="flex gap-3 items-start py-2.5 border-b border-border" style={{ opacity: a.achieved ? 1 : 0.6 }}>
      <span className="rounded-md overflow-hidden bg-card flex-shrink-0" style={{ width: 40, height: 40 }}>
        {icon && <img src={icon} alt="" loading="lazy" width={40} height={40} style={{ width: 40, height: 40, objectFit: 'cover' }} />}
      </span>
      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-semibold text-primary">{a.name}</span>
          {a.finale && (
            <span title="Marca o fim da história: desbloquear conta como zerado"
              className="text-[10px] font-semibold rounded-full px-2 py-0.5" style={{ color: 'var(--series)', background: 'var(--series-bg)' }}>
              Finaliza
            </span>
          )}
        </span>
        {a.description && <span className="block text-sm text-secondary">{a.description}</span>}
        <span className="block text-xs text-muted mt-0.5">
          {[a.achieved && a.unlocked_at ? `Desbloqueada em ${formatDate(a.unlocked_at)}` : a.achieved ? 'Desbloqueada' : 'Bloqueada', rarityLabel(a.global_percent)]
            .filter(Boolean).join(' · ')}
        </span>
      </span>
    </li>
  )
}

/** Conquistas do jogo, como lidas da Steam (ST-03). Some quando não há nenhuma. */
export function GameAchievements({ mediaId, enabled }: { mediaId: number; enabled: boolean }) {
  const [showAll, setShowAll] = useState(false)
  const { data } = useQuery({
    queryKey: ['game-achievements', mediaId],
    queryFn: () => api.games.achievements(mediaId),
    enabled,
  })
  if (!data || data.total === 0) return null

  const pct = Math.round((data.unlocked / data.total) * 100)
  const visible = data.achievements.filter(a => a.achieved || !a.hidden)
  const hiddenLocked = data.achievements.length - visible.length
  const shown = showAll ? visible : visible.slice(0, INITIAL)
  const rarest = data.achievements
    .filter(a => a.achieved && a.global_percent != null)
    .sort((x, y) => (x.global_percent ?? 100) - (y.global_percent ?? 100))[0]

  return (
    <section aria-labelledby="game-conquistas" className="mb-8">
      <h2 id="game-conquistas" className="text-xs text-muted uppercase tracking-wide mb-3 flex items-center gap-2">
        Conquistas · {data.unlocked}/{data.total} <SourceBadge source="steam" />
      </h2>
      <div className="h-2 bg-card rounded-full overflow-hidden mb-2" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}
        aria-label={`${pct}% das conquistas`}>
        <div className="h-full rounded-full" style={{ width: `${pct}%`, background: pct === 100 ? 'var(--music)' : 'var(--games)' }} />
      </div>
      <p className="text-sm text-muted mb-3">
        {pct}% desbloqueadas{rarest ? ` · mais rara: ${rarest.name} (${formatPercent(rarest.global_percent!)})` : ''}
      </p>

      <ul className="border-t border-border">
        {shown.map(a => <AchievementRow key={a.api_name} a={a} />)}
      </ul>
      <div className="flex flex-wrap items-center gap-4 mt-3">
        {visible.length > INITIAL && (
          <button type="button" onClick={() => setShowAll(v => !v)} className="text-sm text-secondary hover:text-primary"
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer' }}>
            {showAll ? 'Mostrar menos' : `Ver todas (${visible.length})`}
          </button>
        )}
        {hiddenLocked > 0 && <span className="text-sm text-muted">+ {hiddenLocked} oculta(s) ainda bloqueada(s)</span>}
      </div>
    </section>
  )
}
