/**
 * Regras puras da biblioteca vinda da Steam (ST-02).
 *
 * - O que a Steam informa só **promove** o status: jogo comprado sai da
 *   Wishlist para o Backlog; jogo com tempo de jogo sai do Backlog para
 *   "jogando". Zerado, platinado, pausado e abandonado nunca são mexidos aqui,
 *   e status escolhido à mão (`game_status_source = 'manual'`) fica travado.
 * - Tempo de jogo e última vez jogada passam a vir da Steam, exceto um tempo
 *   digitado à mão maior que o da Steam.
 */
import type { GameStatus } from '../media-domain.js'

export interface LibraryGameRow {
  id: number
  title: string
  status: string
  game_status: string | null
  game_status_source: string | null
  playtime_seconds: number | null
  playtime_source: string | null
  last_played_at: string | null
  steam_appid: number | null
}

export interface OwnedGameInput {
  appid: number
  name: string
  playtime_minutes: number
  last_played_at: string | null
}

export interface LibraryDecision {
  /** Novo status, quando muda. */
  gameStatus: GameStatus | null
  /** Novo tempo de jogo (s), quando muda. */
  playtimeSeconds: number | null
  /** Nova última vez jogada, quando muda. */
  lastPlayedAt: string | null
  /** Passou a "jogando" nesta leitura (gera atividade). */
  started: boolean
}

/** Status efetivo de um jogo, inclusive dos antigos sem `game_status`. */
export function effectiveGameStatus(row: Pick<LibraryGameRow, 'status' | 'game_status'>): string {
  if (row.game_status) return row.game_status
  switch (row.status) {
    case 'wishlist': return 'nunca_jogado'
    case 'completed': return 'zerado'
    case 'dropped': return 'abandonado'
    default: return 'jogando'
  }
}

export function decideLibraryUpdate(owned: OwnedGameInput, current: LibraryGameRow | null): LibraryDecision {
  const steamSeconds = Math.max(0, Math.round(owned.playtime_minutes * 60))
  const played = steamSeconds > 0

  if (!current) {
    return {
      gameStatus: played ? 'jogando' : 'backlog',
      playtimeSeconds: played ? steamSeconds : null,
      lastPlayedAt: owned.last_played_at,
      started: played,
    }
  }

  const effective = effectiveGameStatus(current)
  let gameStatus: GameStatus | null = null
  // Status escolhido à mão fica travado: nada automático passa por cima.
  if (current.game_status_source !== 'manual') {
    // Está na sua conta: deixou de ser "quero comprar".
    if (effective === 'nunca_jogado') gameStatus = played ? 'jogando' : 'backlog'
    else if (effective === 'backlog' && played) gameStatus = 'jogando'
  }

  let playtimeSeconds: number | null = null
  const currentSeconds = current.playtime_seconds ?? 0
  if (played && steamSeconds !== currentSeconds && (current.playtime_source !== 'manual' || steamSeconds > currentSeconds)) {
    playtimeSeconds = steamSeconds
  }

  let lastPlayedAt: string | null = null
  if (owned.last_played_at && (!current.last_played_at || Date.parse(owned.last_played_at) > Date.parse(current.last_played_at))) {
    lastPlayedAt = owned.last_played_at
  }

  return { gameStatus, playtimeSeconds, lastPlayedAt, started: gameStatus === 'jogando' }
}
