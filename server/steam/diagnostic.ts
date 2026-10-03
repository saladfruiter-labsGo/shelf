/**
 * Diagnóstico da Steam: medição só de leitura, rodada de dentro do app com a
 * conta conectada pela interface ("Entrar com a Steam" + API key).
 *
 * Responde, antes de a Steam virar a fonte da biblioteca de games:
 * - quantos jogos a conta tem e quantos foram jogados;
 * - quantos jogos do Shelf casam com a Steam e quantos vêm de outras lojas;
 * - nos jogados, em quantos o "zerado" sairia automático pelas conquistas,
 *   quantos precisariam de confirmação e quantos ficariam manuais.
 *
 * Não grava nada em `media_items`: o resultado fica só em `STEAM_DIAGNOSTIC`.
 */
import { db } from '../db.js'
import { setCfg, cfg } from '../integrations/config.js'
import { normalizeTitle } from '../prices/matcher.js'
import { QUEUE_PREDICATE } from '../media-domain.js'
import * as steam from './client.js'
import { summarizeFinale } from './finale.js'
import { PerUser } from '../user-state.js'

const RESULT_KEY = 'STEAM_DIAGNOSTIC'
const CONCURRENCY = 4
const SAMPLE_LIMIT = 60

export interface SteamDiagnostic {
  started_at: string
  finished_at: string | null
  running: boolean
  progress: { done: number; total: number }
  owned_total: number
  owned_played: number
  playtime_hours: number
  shelf: {
    /** Jogos que você tem no Shelf: biblioteca + Backlog. */
    games: number
    matched_by_appid: number
    /** Sem AppID gravado, mas com o mesmo título de um jogo da conta. */
    matched_by_title: number
    /** Não encontrados na conta Steam, agrupados pela loja de origem. */
    outside_steam: { library: string; count: number }[]
  }
  achievements: {
    /** Jogos jogados com conquistas verificadas. */
    checked: number
    no_achievements: number
    auto: number
    confirm: number
    manual: number
    games_with_hidden_without_description: number
    would_be_zerado: number
    would_be_platinado: number
    /** As conquistas do perfil não estão visíveis para a API. */
    private: boolean
  }
  samples: {
    auto: { title: string; achievements: string[]; unlocked: boolean }[]
    confirm: { title: string; candidates: string[]; hidden: number }[]
    manual: string[]
  }
  errors: string[]
}

function emptyDiagnostic(): SteamDiagnostic {
  return {
    started_at: new Date().toISOString(),
    finished_at: null,
    running: true,
    progress: { done: 0, total: 0 },
    owned_total: 0, owned_played: 0, playtime_hours: 0,
    shelf: { games: 0, matched_by_appid: 0, matched_by_title: 0, outside_steam: [] },
    achievements: {
      checked: 0, no_achievements: 0, auto: 0, confirm: 0, manual: 0,
      games_with_hidden_without_description: 0, would_be_zerado: 0, would_be_platinado: 0, private: false,
    },
    samples: { auto: [], confirm: [], manual: [] },
    errors: [],
  }
}

const current = new PerUser<SteamDiagnostic | null>(() => null)
const running = new PerUser<Promise<void> | null>(() => null)
let aborted = false

export function lastDiagnostic(): SteamDiagnostic | null {
  const live = current.get()
  if (live) return live
  try { return JSON.parse(cfg(RESULT_KEY) || 'null') } catch { return null }
}

async function withRetry<T>(fn: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt++) {
    try {
      return await fn()
    } catch (e) {
      if (!(e instanceof steam.SteamError) || e.status !== 429 || attempt >= 3) throw e
      await new Promise(resolve => setTimeout(resolve, 2_000 * attempt))
    }
  }
}

interface ShelfOwnedGame { title: string; steam_appid: number | null; library: string | null }

function compareShelf(diag: SteamDiagnostic, owned: steam.SteamOwnedGame[]): void {
  const ownedIds = new Set(owned.map(g => g.appid))
  const ownedTitles = new Set(owned.map(g => normalizeTitle(g.name)))
  const games = db.prepare(`
    SELECT title, steam_appid, library FROM media_items
     WHERE type = 'game' AND (status != 'wishlist' OR ${QUEUE_PREDICATE.backlog})
  `).all() as ShelfOwnedGame[]

  const outside = new Map<string, number>()
  diag.shelf.games = games.length
  for (const game of games) {
    if (game.steam_appid && ownedIds.has(game.steam_appid)) diag.shelf.matched_by_appid++
    else if (ownedTitles.has(normalizeTitle(game.title))) diag.shelf.matched_by_title++
    else {
      const library = game.library?.trim() || 'Sem loja informada'
      outside.set(library, (outside.get(library) ?? 0) + 1)
    }
  }
  diag.shelf.outside_steam = [...outside.entries()]
    .map(([library, count]) => ({ library, count }))
    .sort((a, b) => b.count - a.count || a.library.localeCompare(b.library, 'pt-BR'))
}

async function checkAchievements(diag: SteamDiagnostic, game: steam.SteamOwnedGame): Promise<void> {
  if (aborted || diag.achievements.private) return
  const player = await withRetry(() => steam.fetchPlayerAchievements(game.appid))
  if (!player.ok) {
    if (player.reason === 'private') {
      diag.achievements.private = true
      return
    }
    diag.achievements.no_achievements++
    return
  }
  const schema = player.achievements.length > 0 ? await withRetry(() => steam.fetchAchievementSchema(game.appid)) : []
  diag.achievements.checked++

  const summary = summarizeFinale(schema)
  const unlocked = new Set(player.achievements.filter(a => a.achieved).map(a => a.apiName))
  if (summary.hiddenWithoutDescription > 0) diag.achievements.games_with_hidden_without_description++
  if (player.achievements.length > 0 && unlocked.size === player.achievements.length) diag.achievements.would_be_platinado++

  switch (summary.state) {
    case 'no_achievements':
      diag.achievements.no_achievements++
      break
    case 'auto': {
      diag.achievements.auto++
      const finished = summary.high.some(a => unlocked.has(a.apiName))
      if (finished) diag.achievements.would_be_zerado++
      if (diag.samples.auto.length < SAMPLE_LIMIT) {
        diag.samples.auto.push({ title: game.name, achievements: summary.high.map(a => a.name), unlocked: finished })
      }
      break
    }
    case 'confirm':
      diag.achievements.confirm++
      if (diag.samples.confirm.length < SAMPLE_LIMIT) {
        diag.samples.confirm.push({ title: game.name, candidates: summary.low.map(a => a.name), hidden: summary.hiddenWithoutDescription })
      }
      break
    case 'manual':
      diag.achievements.manual++
      if (diag.samples.manual.length < SAMPLE_LIMIT) diag.samples.manual.push(game.name)
      break
  }
}

async function run(diag: SteamDiagnostic): Promise<void> {
  try {
    const owned = await steam.fetchOwnedGames()
    const played = owned.filter(g => g.playtime_minutes > 0)
    diag.owned_total = owned.length
    diag.owned_played = played.length
    diag.playtime_hours = Math.round(owned.reduce((sum, g) => sum + g.playtime_minutes, 0) / 60)
    compareShelf(diag, owned)

    // Só quem tem estatísticas na Steam pode ter conquistas; o resto conta direto.
    const withStats = played.filter(g => g.has_stats)
    diag.achievements.no_achievements += played.length - withStats.length
    diag.progress.total = withStats.length

    const queue = [...withStats].sort((a, b) => b.playtime_minutes - a.playtime_minutes)
    const worker = async () => {
      for (let game = queue.shift(); game && !aborted; game = queue.shift()) {
        try {
          await checkAchievements(diag, game)
        } catch (e) {
          if (diag.errors.length < 20) diag.errors.push(`${game.name}: ${(e as Error).message}`)
        }
        diag.progress.done++
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))

    if (diag.achievements.private) {
      diag.errors.unshift('As conquistas do perfil não estão visíveis para a API. Na Steam: Perfil → Privacidade → Detalhes do jogo: Público.')
    }
    if (aborted) diag.errors.push('Diagnóstico interrompido antes do fim.')
  } catch (e) {
    diag.errors.push((e as Error).message)
  } finally {
    diag.running = false
    diag.finished_at = new Date().toISOString()
    setCfg(RESULT_KEY, JSON.stringify(diag))
    current.set(null)
  }
}

/** Começa um diagnóstico; devolve o estado atual se já houver um rodando. */
export function startSteamDiagnostic(): { started: boolean; diagnostic: SteamDiagnostic } {
  const live = current.get()
  if (live && running.get()) return { started: false, diagnostic: live }
  aborted = false
  const diag = emptyDiagnostic()
  current.set(diag)
  running.set(run(diag).finally(() => { running.set(null) }))
  return { started: true, diagnostic: diag }
}

/** Interrompe e espera o diagnóstico em andamento (shutdown gracioso). */
export async function stopSteamDiagnostic(): Promise<void> {
  aborted = true
  await Promise.allSettled(running.all())
}
