/**
 * Classificador de conquistas "Finaliza": a conquista que só se desbloqueia ao
 * terminar a história do jogo (ex.: "Finish the game on any difficulty").
 *
 * A Steam não marca isso; sites como o Your Gamer Profile mantêm a marcação à
 * mão. Aqui a primeira passada é por texto, e o que fica em dúvida vai para a
 * confirmação do usuário (ST-03). Um jogo pode ter várias conquistas de final
 * (uma por dificuldade, uma por final alternativo).
 */
import type { SteamAchievementSchema } from './client.js'

export type FinaleConfidence = 'high' | 'low'

function normalize(text: string): string {
  return text
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[’']/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
}

const HIGH: RegExp[] = [
  // finish / complete / beat the game|story|campaign
  /\b(finish|finished|complete|completed|beat|beaten|clear|cleared)\s+(the\s+)?(main\s+)?(game|story|campaign|main quest|storyline|adventure)\b/,
  /\b(game|story|campaign|storyline)\s+(is\s+)?(complete|completed|finished|beaten|cleared)\b/,
  // reach / see / watch the ending | credits
  /\b(see|saw|watch|watched|reach|reached|witness|witnessed|view|get|got|unlock|unlocked|achieve)\s+(the\s+|an?\s+|any\s+)?([\w-]+\s+)?(ending|credits|end credits)\b/,
  /\b(true|good|bad|secret|golden|normal|best|worst|final)\s+ending\b/,
  /^ending\b|\bending\s+[a-z0-9]$/,
  /\b(defeat|kill|beat|slay|destroy)\s+(the\s+)?(final|last)\s+boss\b/,
  // pt-BR
  /\b(termine|terminar|termina|terminou|conclua|concluir|concluiu|complete|completar|completou|zere|zerar|zerou|finalize|finalizar|finalizou)\s+(o\s+|a\s+)?(jogo|historia|campanha|aventura)\b/,
  /\b(veja|ver|assista|assistir|alcance|chegue ao)\s+(os\s+|o\s+|a\s+)?(creditos|final|desfecho)\b/,
  /\b(derrote|derrotar|derrotou|mate)\s+o\s+chefe\s+final\b/,
]

const LOW: RegExp[] = [
  /\b(epilogue|epilogo|finale|the end|o fim)\b/,
  /\b(final|last)\s+(chapter|act|mission|level|stage|episode|capitulo|ato|missao|fase)\b/,
  /\b(new game\s*\+|ng\+)\b/,
]

// Conquistas que mencionam "complete"/"finish" mas não são o final da história.
const NEGATIVE: RegExp[] = [
  /\b(all|every)\s+(achievements|trophies|conquistas|trofeus)\b/,
  /\b100\s*%/,
  /\b(collect|find|get|obtain|acquire)\s+(all|every)\b/,
  /\b(chapter|act|episode|capitulo|ato)\s+(\d+|[ivx]+|one|two|three|four|five)\b/,
  /\b(tutorial|prologue|prologo)\b/,
  /\b(side ?quests?|contracts?|bounties|races?|tournament|minigame)\b/,
]

/** Confiança de que a conquista marca o fim da história, ou `null`. */
export function classifyFinale(achievement: Pick<SteamAchievementSchema, 'name' | 'description'>): FinaleConfidence | null {
  const description = normalize(achievement.description ?? '')
  const name = normalize(achievement.name)
  const text = description || name

  if (NEGATIVE.some(rx => rx.test(text))) return null
  if (HIGH.some(rx => rx.test(text))) return 'high'
  // Sem descrição (conquista oculta), o nome sozinho é pista fraca.
  if (!description && HIGH.some(rx => rx.test(name))) return 'low'
  if (LOW.some(rx => rx.test(text)) || (!description && LOW.some(rx => rx.test(name)))) return 'low'
  return null
}

export type GameFinaleState =
  /** Jogo sem conquistas: zerado só à mão. */
  | 'no_achievements'
  /** Ao menos uma conquista de final com confiança alta. */
  | 'auto'
  /** Só candidatas fracas ou conquistas ocultas sem descrição: pedir confirmação. */
  | 'confirm'
  /** Conquistas legíveis e nenhuma parece final: zerado à mão. */
  | 'manual'

export interface GameFinaleSummary {
  state: GameFinaleState
  high: SteamAchievementSchema[]
  low: SteamAchievementSchema[]
  hiddenWithoutDescription: number
}

export function summarizeFinale(schema: SteamAchievementSchema[]): GameFinaleSummary {
  const high: SteamAchievementSchema[] = []
  const low: SteamAchievementSchema[] = []
  let hiddenWithoutDescription = 0
  for (const achievement of schema) {
    if (achievement.hidden && !achievement.description) hiddenWithoutDescription++
    const confidence = classifyFinale(achievement)
    if (confidence === 'high') high.push(achievement)
    else if (confidence === 'low') low.push(achievement)
  }

  let state: GameFinaleState
  if (schema.length === 0) state = 'no_achievements'
  else if (high.length > 0) state = 'auto'
  else if (low.length > 0 || hiddenWithoutDescription > 0) state = 'confirm'
  else state = 'manual'
  return { state, high, low, hiddenWithoutDescription }
}
