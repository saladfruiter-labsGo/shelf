/**
 * Regras puras de status por conquistas (ST-03).
 *
 * - **Platinado**: todas as conquistas desbloqueadas. É "pegajoso": um DLC que
 *   traga conquistas novas depois não rebaixa o jogo.
 * - **Zerado**: alguma conquista de final (`finale`, só confiança alta)
 *   desbloqueada. Jogo sem conquista de final reconhecida fica para o usuário
 *   marcar à mão (decisão de 2026-10-01: sem fila de confirmação).
 * - **Abandonado automático**: "jogando" sem jogar há N dias e sem final
 *   desbloqueado.
 * - Status escolhido à mão nunca é mexido; nada aqui rebaixa.
 */
import type { GameStatus } from '../media-domain.js'

export interface AchievementSnapshot {
  total: number
  unlocked: number
  /** Datas de desbloqueio das conquistas de final (ISO). */
  finaleUnlocks: string[]
  /** Data do último desbloqueio (ISO), usada como data da platina. */
  lastUnlockAt: string | null
}

export interface StatusRow {
  game_status: string | null
  game_status_source: string | null
}

export interface AchievementDecision {
  gameStatus: Extract<GameStatus, 'zerado' | 'platinado'> | null
  /** Data da conclusão: o primeiro final desbloqueado, ou a platina. */
  completedAt: string | null
}

const RANK: Record<string, number> = {
  nunca_jogado: 0, backlog: 1, jogando: 2, pausado: 2, abandonado: 2, zerado: 3, platinado: 4,
}

function earliest(dates: string[]): string | null {
  return dates.filter(Boolean).sort((a, b) => Date.parse(a) - Date.parse(b))[0] ?? null
}

export function decideAchievementStatus(row: StatusRow, snap: AchievementSnapshot): AchievementDecision {
  const none: AchievementDecision = { gameStatus: null, completedAt: null }
  if (row.game_status_source === 'manual') return none

  const current = RANK[row.game_status ?? 'jogando'] ?? 2
  const platinum = snap.total > 0 && snap.unlocked >= snap.total
  const firstFinale = earliest(snap.finaleUnlocks)

  if (platinum && current < RANK.platinado) {
    return { gameStatus: 'platinado', completedAt: firstFinale ?? snap.lastUnlockAt }
  }
  if (firstFinale && current < RANK.zerado) {
    return { gameStatus: 'zerado', completedAt: firstFinale }
  }
  return none
}

export function shouldAutoAbandon(
  row: StatusRow & { last_played_at: string | null },
  hasFinaleUnlocked: boolean,
  days: number,
  now = Date.now(),
): boolean {
  if (days <= 0 || row.game_status_source === 'manual') return false
  if (row.game_status !== 'jogando' || hasFinaleUnlocked || !row.last_played_at) return false
  return now - Date.parse(row.last_played_at) > days * 24 * 3_600_000
}
