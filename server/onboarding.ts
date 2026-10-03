/**
 * Configuração guiada: o roteiro que aparece quando uma conta ainda não
 * conectou nada. Cada passo sabe dizer sozinho se já está feito, olhando a
 * própria configuração — o roteiro nunca fica "fora de sincronia" com a tela
 * de Integrações. O que a pessoa decide (pular um passo, deixar para depois)
 * fica no banco pessoal, em `ONBOARDING_STATE`.
 */
import { core } from './core-db.js'
import { currentUserId, db } from './db.js'
import { cfg, setCfg } from './integrations/config.js'

export const ONBOARDING_STEPS = [
  'profile', 'instance', 'steam', 'lastfm', 'plex', 'kavita', 'playnite', 'telegram', 'letterboxd',
] as const
export type OnboardingStepId = typeof ONBOARDING_STEPS[number]

/** Passos que contam como "conectou alguma coisa" (perfil e chaves da instância não contam). */
const CONNECTIONS: OnboardingStepId[] = ['steam', 'lastfm', 'plex', 'kavita', 'playnite', 'telegram', 'letterboxd']

export interface OnboardingStep {
  id: OnboardingStepId
  status: 'done' | 'skipped' | 'pending'
}

export interface OnboardingView {
  /** Abrir sozinho ao entrar: nada conectado e a pessoa não deixou para depois. */
  auto_open: boolean
  dismissed: boolean
  steps: OnboardingStep[]
  done: number
  total: number
}

interface StoredState { skipped: OnboardingStepId[]; dismissed: boolean }

const STATE_KEY = 'ONBOARDING_STATE'

function readState(): StoredState {
  try {
    const raw = JSON.parse(cfg(STATE_KEY) || '{}') as Partial<StoredState>
    return {
      skipped: Array.isArray(raw.skipped) ? raw.skipped.filter(isStepId) : [],
      dismissed: raw.dismissed === true,
    }
  } catch {
    return { skipped: [], dismissed: false }
  }
}

function writeState(state: StoredState): void {
  setCfg(STATE_KEY, JSON.stringify(state))
}

export function isStepId(value: unknown): value is OnboardingStepId {
  return typeof value === 'string' && (ONBOARDING_STEPS as readonly string[]).includes(value)
}

const on = (key: string) => cfg(key) === '1'
const has = (...keys: string[]) => keys.every(key => !!cfg(key))

function stepDone(id: OnboardingStepId): boolean {
  switch (id) {
    case 'profile': {
      const userId = currentUserId()
      if (userId == null) return true
      const row = core('SELECT avatar_file, bio FROM users WHERE id = ?').get(userId) as { avatar_file: string | null; bio: string | null } | undefined
      return !!(row?.avatar_file || row?.bio)
    }
    case 'instance': return has('TMDB_API_KEY', 'RAWG_API_KEY')
    case 'steam':    return has('STEAM_ID', 'STEAM_API_KEY')
    case 'lastfm':   return on('LASTFM_ENABLED') && has('LASTFM_USER', 'LASTFM_API_KEY')
    case 'plex':     return on('PLEX_ENABLED') && has('PLEX_URL', 'PLEX_TOKEN')
    case 'kavita':   return on('KAVITA_ENABLED') && has('KAVITA_URL', 'KAVITA_API_KEY')
    case 'playnite': return on('PLAYNITE_ENABLED')
    case 'telegram': return on('TELEGRAM_ENABLED') && has('TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID')
    case 'letterboxd':
      return Boolean(db.prepare("SELECT 1 FROM diary_entries WHERE source = 'letterboxd' LIMIT 1").get())
  }
}

export function onboardingView(isAdmin: boolean): OnboardingView {
  const state = readState()
  // As chaves de busca são da instância: só quem pode configurá-las vê o passo.
  const ids = ONBOARDING_STEPS.filter(id => id !== 'instance' || isAdmin)
  const steps = ids.map<OnboardingStep>(id => ({
    id,
    status: stepDone(id) ? 'done' : state.skipped.includes(id) ? 'skipped' : 'pending',
  }))
  const connectedSomething = steps.some(s => CONNECTIONS.includes(s.id) && s.status === 'done')
  return {
    auto_open: !connectedSomething && !state.dismissed,
    dismissed: state.dismissed,
    steps,
    done: steps.filter(s => s.status === 'done').length,
    total: steps.length,
  }
}

export type OnboardingAction =
  | { skip: OnboardingStepId }
  | { unskip: OnboardingStepId }
  | { dismiss: boolean }
  | { reset: true }

export function parseOnboardingAction(body: unknown): OnboardingAction | null {
  if (!body || typeof body !== 'object') return null
  const b = body as Record<string, unknown>
  if (isStepId(b.skip)) return { skip: b.skip }
  if (isStepId(b.unskip)) return { unskip: b.unskip }
  if (typeof b.dismiss === 'boolean') return { dismiss: b.dismiss }
  if (b.reset === true) return { reset: true }
  return null
}

export function applyOnboardingAction(action: OnboardingAction): void {
  const state = readState()
  if ('skip' in action) {
    if (!state.skipped.includes(action.skip)) state.skipped.push(action.skip)
  } else if ('unskip' in action) {
    state.skipped = state.skipped.filter(id => id !== action.unskip)
  } else if ('dismiss' in action) {
    state.dismissed = action.dismiss
  } else {
    state.skipped = []
    state.dismissed = false
  }
  writeState(state)
}
