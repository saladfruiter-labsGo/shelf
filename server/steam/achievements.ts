/**
 * Conquistas da Steam (ST-03): leitura, "zerado"/"platinado" automáticos e
 * abandono automático.
 *
 * Roda depois de cada leitura da biblioteca, só para os jogos cujo tempo de
 * jogo mudou desde a última verificação (mais uma passada inicial). A lista
 * de conquistas (schema) e a raridade global são renovadas a cada 30 dias.
 *
 * Diário: a conclusão entra com a **data real** do desbloqueio (a Steam
 * informa), uma única vez por jogo e data. Atividade e aviso no Telegram só
 * para conclusões das últimas 48 h — a primeira passada não dispara avisos de
 * jogos zerados há anos.
 */
import { db } from '../db.js'
import { cfg, setCfg } from '../integrations/config.js'
import { GAME_STATUS_TO_BASE } from '../media-domain.js'
import { notifyLibraryActivity } from '../notify.js'
import * as steam from './client.js'
import { classifyFinale } from './finale.js'
import { decideAchievementStatus, shouldAutoAbandon } from './achievement-rules.js'

const STATE_KEY = 'STEAM_ACHIEVEMENTS_STATE'
const LAST_SYNC_KEY = 'STEAM_ACHIEVEMENTS_LAST_SYNC'
const SCHEMA_TTL_MS = 30 * 24 * 3_600_000
const FRESH_MS = 48 * 3_600_000
const CONCURRENCY = 3

export const DEFAULT_AUTO_ABANDON_DAYS = 150

export function autoAbandonDays(): number {
  const raw = cfg('STEAM_AUTO_ABANDON_DAYS')
  if (raw === '') return DEFAULT_AUTO_ABANDON_DAYS
  const days = Number(raw)
  return Number.isFinite(days) && days >= 0 ? Math.round(days) : DEFAULT_AUTO_ABANDON_DAYS
}

export interface SteamAchievementsResult {
  at: string
  checked: number
  zerados: number
  platinados: number
  abandonados: number
  private: boolean
  errors: string[]
}

export function lastAchievementsSync(): SteamAchievementsResult | null {
  try { return JSON.parse(cfg(LAST_SYNC_KEY) || 'null') } catch { return null }
}

/** AppID → { tempo de jogo na última verificação, quando o schema foi lido }. */
type AchievementsState = Record<string, { playtime: number; schemaAt: number }>

function readState(): AchievementsState {
  try { return JSON.parse(cfg(STATE_KEY) || '{}') } catch { return {} }
}

const upsertAchievement = db.prepare(`
  INSERT INTO steam_achievements
    (appid, api_name, name, description, icon, icon_gray, hidden, global_percent, achieved, unlocked_at, finale, updated_at)
  VALUES
    (@appid, @api_name, @name, @description, @icon, @icon_gray, @hidden, @global_percent, @achieved, @unlocked_at, @finale, datetime('now'))
  ON CONFLICT(appid, api_name) DO UPDATE SET
    name           = excluded.name,
    description    = excluded.description,
    icon           = COALESCE(excluded.icon, steam_achievements.icon),
    icon_gray      = COALESCE(excluded.icon_gray, steam_achievements.icon_gray),
    hidden         = excluded.hidden,
    global_percent = COALESCE(excluded.global_percent, steam_achievements.global_percent),
    achieved       = excluded.achieved,
    unlocked_at    = excluded.unlocked_at,
    finale         = excluded.finale,
    updated_at     = datetime('now')
`)
const updatePlayerProgress = db.prepare(`
  UPDATE steam_achievements SET achieved = @achieved, unlocked_at = @unlocked_at, updated_at = datetime('now')
   WHERE appid = @appid AND api_name = @api_name
`)
const insertCompletionDiary = db.prepare(`
  INSERT INTO diary_entries (media_item_id, watched_at, rating, comment, source)
  SELECT @media_item_id, @watched_at, @rating, NULL, 'steam'
  WHERE NOT EXISTS (
    SELECT 1 FROM diary_entries
     WHERE media_item_id = @media_item_id AND progress_unit IS NULL AND watched_at = @watched_at
  )
`)
const insertActivity = db.prepare(`
  INSERT OR IGNORE INTO activity_events
    (source, event_type, media_type, external_ref, title, subtitle, cover_url, rating, duration_ms, genre, occurred_at, raw)
  VALUES ('steam', 'played', 'game', @external_ref, @title, @subtitle, @cover_url, @rating, NULL, NULL, @occurred_at, NULL)
`)

interface GameRow {
  id: number
  title: string
  cover_url: string | null
  rating: number
  game_status: string | null
  game_status_source: string | null
  last_played_at: string | null
  completed_at: string | null
}

const gameByAppId = db.prepare(`
  SELECT id, title, cover_url, rating, game_status, game_status_source, last_played_at, completed_at
    FROM media_items WHERE type = 'game' AND steam_appid = ?
`)

/** Lê e grava as conquistas de um jogo; devolve false se o perfil estiver privado. */
async function refreshGame(appid: number, schemaStale: boolean): Promise<'ok' | 'private' | 'no_stats'> {
  const player = await steam.fetchPlayerAchievements(appid)
  if (!player.ok) return player.reason

  const hasRows = (db.prepare('SELECT COUNT(*) AS n FROM steam_achievements WHERE appid = ?').get(appid) as { n: number }).n > 0
  if (schemaStale || !hasRows) {
    const [schema, percents] = await Promise.all([
      steam.fetchAchievementSchema(appid),
      steam.fetchGlobalAchievementPercentages(appid),
    ])
    const progress = new Map(player.achievements.map(a => [a.apiName, a]))
    db.transaction(() => {
      for (const a of schema) {
        const mine = progress.get(a.apiName)
        upsertAchievement.run({
          appid, api_name: a.apiName, name: a.name, description: a.description,
          icon: a.icon ?? null, icon_gray: a.iconGray ?? null, hidden: a.hidden ? 1 : 0,
          global_percent: percents.get(a.apiName) ?? null,
          achieved: mine?.achieved ? 1 : 0, unlocked_at: mine?.unlockedAt ?? null,
          // Só confiança alta vira "Finaliza": o resto o usuário marca à mão.
          finale: classifyFinale(a) === 'high' ? 1 : 0,
        })
      }
    })()
  } else {
    db.transaction(() => {
      for (const a of player.achievements) {
        updatePlayerProgress.run({ appid, api_name: a.apiName, achieved: a.achieved ? 1 : 0, unlocked_at: a.unlockedAt })
      }
    })()
  }
  return 'ok'
}

/** Aplica as regras de status a um jogo a partir do que está gravado. */
function applyStatus(appid: number, result: SteamAchievementsResult, now: number): void {
  const game = gameByAppId.get(appid) as GameRow | undefined
  if (!game) return
  const stats = db.prepare(`
    SELECT COUNT(*) AS total, SUM(achieved) AS unlocked, MAX(unlocked_at) AS last_unlock
      FROM steam_achievements WHERE appid = ?
  `).get(appid) as { total: number; unlocked: number | null; last_unlock: string | null }
  const finaleUnlocks = (db.prepare(
    'SELECT unlocked_at FROM steam_achievements WHERE appid = ? AND finale = 1 AND achieved = 1 AND unlocked_at IS NOT NULL',
  ).all(appid) as { unlocked_at: string }[]).map(r => r.unlocked_at)

  db.prepare('UPDATE media_items SET achievements_total = ?, achievements_unlocked = ? WHERE id = ?')
    .run(stats.total || null, stats.total ? stats.unlocked ?? 0 : null, game.id)

  const decision = decideAchievementStatus(game, {
    total: stats.total, unlocked: stats.unlocked ?? 0, finaleUnlocks, lastUnlockAt: stats.last_unlock,
  })
  if (decision.gameStatus && decision.completedAt) {
    const wasFinished = game.game_status === 'zerado' || game.game_status === 'platinado'
    db.prepare(`
      UPDATE media_items SET game_status = ?, game_status_source = 'steam', status = ?,
             completed_at = COALESCE(completed_at, ?), updated_at = datetime('now')
       WHERE id = ?
    `).run(decision.gameStatus, GAME_STATUS_TO_BASE[decision.gameStatus], decision.completedAt, game.id)
    if (decision.gameStatus === 'platinado') result.platinados++
    else result.zerados++

    // Zerado → platinado não é uma nova conclusão no diário.
    if (!wasFinished) {
      insertCompletionDiary.run({ media_item_id: game.id, watched_at: decision.completedAt, rating: game.rating > 0 ? game.rating : null })
    }
    if (now - Date.parse(decision.completedAt) <= FRESH_MS) {
      insertActivity.run({
        external_ref: `steam:${appid}`, title: game.title,
        subtitle: decision.gameStatus === 'platinado' ? 'Platinado' : 'Zerado',
        cover_url: game.cover_url, rating: game.rating > 0 ? game.rating : null, occurred_at: decision.completedAt,
      })
      notifyLibraryActivity({ event: 'completed', type: 'game', title: game.title, rating: game.rating || null, mediaItemId: game.id })
    }
    return
  }

  if (shouldAutoAbandon(game, finaleUnlocks.length > 0, autoAbandonDays(), now)) {
    db.prepare(`
      UPDATE media_items SET game_status = 'abandonado', game_status_source = 'steam', status = ?, updated_at = datetime('now')
       WHERE id = ?
    `).run(GAME_STATUS_TO_BASE.abandonado, game.id)
    result.abandonados++
  }
}

let running: Promise<SteamAchievementsResult> | null = null
let aborted = false

async function run(): Promise<SteamAchievementsResult> {
  const result: SteamAchievementsResult = {
    at: new Date().toISOString(), checked: 0, zerados: 0, platinados: 0, abandonados: 0, private: false, errors: [],
  }
  try {
    const owned = await steam.fetchOwnedGames()
    const state = readState()
    const now = Date.now()

    const due = owned
      .filter(g => g.playtime_minutes > 0 && g.has_stats)
      .filter(g => state[String(g.appid)]?.playtime !== g.playtime_minutes)
      .sort((a, b) => b.playtime_minutes - a.playtime_minutes)

    const queue = [...due]
    const worker = async () => {
      for (let game = queue.shift(); game && !aborted && !result.private; game = queue.shift()) {
        try {
          const previous = state[String(game.appid)]
          const schemaStale = !previous || now - previous.schemaAt > SCHEMA_TTL_MS
          const outcome = await refreshGame(game.appid, schemaStale)
          if (outcome === 'private') { result.private = true; break }
          state[String(game.appid)] = { playtime: game.playtime_minutes, schemaAt: schemaStale ? now : previous!.schemaAt }
          if (outcome === 'ok') {
            result.checked++
            applyStatus(game.appid, result, now)
          }
        } catch (e) {
          if (result.errors.length < 10) result.errors.push(`${game.name}: ${(e as Error).message}`)
        }
      }
    }
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    setCfg(STATE_KEY, JSON.stringify(state))

    // Abandono automático também vale para quem não jogou nada desde a última leitura.
    for (const game of owned.filter(g => g.playtime_minutes > 0 && !due.includes(g))) {
      const row = gameByAppId.get(game.appid) as GameRow | undefined
      if (!row) continue
      const finaleUnlocked = (db.prepare(
        'SELECT COUNT(*) AS n FROM steam_achievements WHERE appid = ? AND finale = 1 AND achieved = 1',
      ).get(game.appid) as { n: number }).n > 0
      if (shouldAutoAbandon(row, finaleUnlocked, autoAbandonDays(), now)) {
        db.prepare(`
          UPDATE media_items SET game_status = 'abandonado', game_status_source = 'steam', status = ?, updated_at = datetime('now')
           WHERE id = ?
        `).run(GAME_STATUS_TO_BASE.abandonado, row.id)
        result.abandonados++
      }
    }

    if (result.private) {
      result.errors.unshift('As conquistas do perfil não estão visíveis para a API. Na Steam: Perfil → Privacidade → Detalhes do jogo: Público.')
    }
  } catch (e) {
    result.errors.push((e as Error).message)
  } finally {
    setCfg(LAST_SYNC_KEY, JSON.stringify(result))
  }
  return result
}

/** Uma leitura por vez; quem chega durante uma em andamento recebe o mesmo resultado. */
export function syncSteamAchievements(): Promise<SteamAchievementsResult> {
  if (!running) {
    aborted = false
    running = run().finally(() => { running = null })
  }
  return running
}

export async function stopSteamAchievements(): Promise<void> {
  aborted = true
  await running?.catch(() => {})
}
