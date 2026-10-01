/**
 * Biblioteca de games vinda da Steam (ST-02).
 *
 * A Steam não avisa ninguém quando algo muda: o Shelf consulta a Web API
 * (`GetOwnedGames`) a cada 30 min e aplica as regras de `library-plan.ts`.
 * O tempo de jogo só é atualizado pela Steam quando o jogo fecha, então a
 * cadência não perde informação; ela só atrasa um pouco.
 *
 * Identidade: sempre o AppID (`media_items.steam_appid`). Um jogo que já existe
 * no Shelf sem AppID é adotado (lojas da RAWG → título exato normalizado e
 * único); só sem nenhum casamento um card novo `steam:<appid>` é criado. O
 * `external_id` de um card existente nunca muda.
 *
 * Proteções:
 * - biblioteca vazia com histórico (perfil que ficou privado) não muda nada;
 * - na primeira vez que um jogo é visto não há atividade, aviso nem diário —
 *   senão a primeira leitura inventaria sessões de anos atrás.
 */
import { db } from '../db.js'
import { cfg, setCfg } from '../integrations/config.js'
import { GAME_STATUS_TO_BASE, type GameStatus } from '../media-domain.js'
import { normalizeTitle, steamAppIdFromRawg } from '../prices/matcher.js'
import { recordDiaryProgress } from '../diary-progress.js'
import { notifyLibraryActivity } from '../notify.js'
import * as steam from './client.js'
import { decideLibraryUpdate, type LibraryGameRow } from './library-plan.js'
import { syncSteamAchievements } from './achievements.js'
import { syncTimeToBeat } from '../igdb.js'

const STATE_KEY = 'STEAM_LIBRARY_STATE'
const LAST_SYNC_KEY = 'STEAM_LIBRARY_LAST_SYNC'
const APPID_MISSES_KEY = 'STEAM_APPID_MISSES'
const APPID_RETRY_MS = 7 * 24 * 3_600_000
/** Sem leitura anterior, só vira atividade o que foi jogado há pouco. */
const FRESH_MS = 48 * 3_600_000

export function steamLibraryEnabled(): boolean {
  return cfg('STEAM_LIBRARY_ENABLED') === '1' && !!cfg('STEAM_ID') && !!cfg('STEAM_API_KEY')
}

export interface SteamLibraryResult {
  at: string
  owned: number
  created: number
  adopted: number
  updated: number
  started: number
  errors: string[]
}

export function lastLibrarySync(): SteamLibraryResult | null {
  try { return JSON.parse(cfg(LAST_SYNC_KEY) || 'null') } catch { return null }
}

/** Último tempo de jogo visto por AppID — base para diário e atividade. */
type LibraryState = Record<string, number>

function readState(): LibraryState {
  try {
    const parsed = JSON.parse(cfg(STATE_KEY) || '{}')
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch {
    return {}
  }
}

const selectGames = () => db.prepare(`
  SELECT id, external_id, title, status, game_status, game_status_source, playtime_seconds,
         playtime_source, last_played_at, steam_appid
    FROM media_items WHERE type = 'game'
`).all() as (LibraryGameRow & { external_id: string })[]

/**
 * Descobre o AppID dos jogos do Shelf que ainda não têm, pelas lojas da RAWG.
 * Resultado negativo fica guardado por 7 dias para não repetir a cada leitura.
 */
async function resolveMissingAppIds(games: (LibraryGameRow & { external_id: string })[]): Promise<void> {
  let misses: Record<string, number> = {}
  try { misses = JSON.parse(cfg(APPID_MISSES_KEY) || '{}') } catch { misses = {} }
  const now = Date.now()
  const pending = games.filter(g =>
    !g.steam_appid && /^\d+$/.test(g.external_id) && !(misses[g.external_id] && now - misses[g.external_id] < APPID_RETRY_MS))
  const setAppId = db.prepare('UPDATE media_items SET steam_appid = ? WHERE id = ? AND steam_appid IS NULL')

  const queue = [...pending]
  const worker = async () => {
    for (let game = queue.shift(); game; game = queue.shift()) {
      const appid = await steamAppIdFromRawg(game.external_id).catch(() => null)
      if (appid) { setAppId.run(appid, game.id); game.steam_appid = appid }
      else misses[game.external_id] = now
    }
  }
  await Promise.all(Array.from({ length: 4 }, worker))
  setCfg(APPID_MISSES_KEY, JSON.stringify(misses))
}

/** Arte vertical da Steam quando existe; senão o header (que todo app tem). */
async function steamCover(appid: number): Promise<string> {
  const vertical = `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8_000)
  try {
    const res = await fetch(vertical, { method: 'HEAD', signal: ctrl.signal })
    return res.ok ? vertical : steam.headerImage(appid)
  } catch {
    return steam.headerImage(appid)
  } finally {
    clearTimeout(timer)
  }
}

const insertGame = db.prepare(`
  INSERT INTO media_items
    (external_id, type, title, cover_url, status, game_status, game_status_source,
     playtime_seconds, playtime_source, last_played_at, library, steam_appid)
  VALUES
    (@external_id, 'game', @title, @cover_url, @status, @game_status, 'steam',
     @playtime_seconds, CASE WHEN @playtime_seconds IS NULL THEN NULL ELSE 'steam' END,
     @last_played_at, 'Steam', @steam_appid)
  ON CONFLICT(external_id, type) DO NOTHING
`)
const insertActivity = db.prepare(`
  INSERT OR IGNORE INTO activity_events
    (source, event_type, media_type, external_ref, title, subtitle, cover_url, rating, duration_ms, genre, occurred_at, raw)
  VALUES ('steam', 'playing', 'game', @external_ref, @title, NULL, @cover_url, NULL, NULL, NULL, @occurred_at, NULL)
`)

let running: Promise<SteamLibraryResult> | null = null

async function runLibrarySync(): Promise<SteamLibraryResult> {
  const result: SteamLibraryResult = { at: new Date().toISOString(), owned: 0, created: 0, adopted: 0, updated: 0, started: 0, errors: [] }
  const state = readState()
  try {
    const owned = await steam.fetchOwnedGames()
    result.owned = owned.length
    if (owned.length === 0 && Object.keys(state).length > 0) {
      result.errors.push('A Steam devolveu a biblioteca vazia — nada foi alterado. Confira se os detalhes de jogo do perfil continuam públicos.')
      return result
    }

    let games = selectGames()
    await resolveMissingAppIds(games)
    games = selectGames()

    const byAppId = new Map<number, (typeof games)[number]>()
    for (const game of games) if (game.steam_appid) byAppId.set(game.steam_appid, game)
    // Adoção por título só quando o casamento é único, para nunca juntar edições diferentes.
    const byTitle = new Map<string, (typeof games)[number] | null>()
    for (const game of games) {
      if (game.steam_appid) continue
      const key = normalizeTitle(game.title)
      byTitle.set(key, byTitle.has(key) ? null : game)
    }

    const now = Date.now()
    const nextState: LibraryState = { ...state }
    const setAppId = db.prepare('UPDATE media_items SET steam_appid = ? WHERE id = ?')
    const covers = new Map<number, string>()
    const newOnes = owned.filter(g => !byAppId.has(g.appid) && !byTitle.get(normalizeTitle(g.name)))
    const coverQueue = [...newOnes]
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let game = coverQueue.shift(); game; game = coverQueue.shift()) covers.set(game.appid, await steamCover(game.appid))
    }))

    const effects: (() => void)[] = []
    db.transaction(() => {
      for (const game of owned) {
        let current = byAppId.get(game.appid) ?? null
        if (!current) {
          const adopted = byTitle.get(normalizeTitle(game.name))
          if (adopted) {
            setAppId.run(game.appid, adopted.id)
            adopted.steam_appid = game.appid
            byTitle.delete(normalizeTitle(game.name))
            byAppId.set(game.appid, adopted)
            current = adopted
            result.adopted++
          }
        }

        const decision = decideLibraryUpdate(game, current)
        const previousSeconds = state[String(game.appid)]
        const seenBefore = previousSeconds !== undefined
        const steamSeconds = Math.round(game.playtime_minutes * 60)
        nextState[String(game.appid)] = steamSeconds

        let mediaId: number
        let title = game.name
        let cover: string | null = null
        if (!current) {
          const status = decision.gameStatus ?? 'backlog'
          insertGame.run({
            external_id: `steam:${game.appid}`,
            title: game.name,
            cover_url: covers.get(game.appid) ?? steam.headerImage(game.appid),
            status: GAME_STATUS_TO_BASE[status],
            game_status: status,
            playtime_seconds: decision.playtimeSeconds,
            last_played_at: decision.lastPlayedAt,
            steam_appid: game.appid,
          })
          const row = db.prepare("SELECT id, cover_url FROM media_items WHERE external_id = ? AND type = 'game'")
            .get(`steam:${game.appid}`) as { id: number; cover_url: string | null }
          mediaId = row.id
          cover = row.cover_url
          result.created++
        } else {
          mediaId = current.id
          title = current.title
          const sets: string[] = []
          const values: unknown[] = []
          if (decision.gameStatus) {
            const nextStatus: GameStatus = decision.gameStatus
            sets.push('game_status = ?', "game_status_source = 'steam'", 'status = ?')
            values.push(nextStatus, GAME_STATUS_TO_BASE[nextStatus])
          }
          if (decision.playtimeSeconds != null) {
            sets.push('playtime_seconds = ?', "playtime_source = 'steam'")
            values.push(decision.playtimeSeconds)
          }
          if (decision.lastPlayedAt) {
            sets.push('last_played_at = ?')
            values.push(decision.lastPlayedAt)
          }
          if (sets.length > 0) {
            db.prepare(`UPDATE media_items SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values, mediaId)
            result.updated++
          }
        }

        // Diário e atividade só para o que mudou desde a última leitura da Steam.
        const lastPlayed = game.last_played_at
        const playedRecently = !!lastPlayed && now - Date.parse(lastPlayed) <= FRESH_MS
        if (seenBefore && steamSeconds > previousSeconds && lastPlayed) {
          recordDiaryProgress({
            mediaItemId: mediaId, source: 'steam', value: steamSeconds, total: null,
            unit: 'seconds', rating: null, observedAt: lastPlayed,
          })
        }
        if (decision.started && (seenBefore || playedRecently)) {
          result.started++
          const occurredAt = lastPlayed ?? result.at
          effects.push(() => {
            insertActivity.run({ external_ref: `steam:${game.appid}`, title, cover_url: cover, occurred_at: occurredAt })
            notifyLibraryActivity({ event: 'in_progress', type: 'game', title })
          })
        }
      }
      setCfg(STATE_KEY, JSON.stringify(nextState))
    })()

    for (const effect of effects) {
      try { effect() } catch (e) { result.errors.push((e as Error).message) }
    }
  } catch (e) {
    result.errors.push((e as Error).message)
  } finally {
    setCfg(LAST_SYNC_KEY, JSON.stringify(result))
  }
  return result
}

/** Uma leitura por vez; quem chega durante uma em andamento recebe o mesmo resultado. */
export function syncSteamLibrary(): Promise<SteamLibraryResult> {
  if (!running) running = runLibrarySync().finally(() => { running = null })
  return running
}

/* ──────────────────────────────── Agendamento ────────────────────────────── */

const FIRST_RUN_DELAY_MS = 90_000
const INTERVAL_MS = 30 * 60_000
let firstRunTimer: NodeJS.Timeout | null = null
let intervalTimer: NodeJS.Timeout | null = null

export function startSteamLibrarySync(): void {
  if (firstRunTimer || intervalTimer) return
  // Depois da biblioteca, as conquistas dos jogos que mudaram (zerado/platinado/abandonado).
  const tick = () => {
    if (!steamLibraryEnabled()) return
    syncSteamLibrary()
      .then(() => syncSteamAchievements())
      // Tempo para zerar dos jogos novos, em lotes pequenos (IGDB: 4 req/s).
      .then(() => syncTimeToBeat(50))
      .catch(() => {})
  }
  firstRunTimer = setTimeout(() => { firstRunTimer = null; tick() }, FIRST_RUN_DELAY_MS)
  intervalTimer = setInterval(tick, INTERVAL_MS)
  firstRunTimer.unref()
  intervalTimer.unref()
}

export async function stopSteamLibrarySync(): Promise<void> {
  if (firstRunTimer) clearTimeout(firstRunTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  firstRunTimer = null
  intervalTimer = null
  await running?.catch(() => {})
}
