/**
 * Do banco pessoal para o feed.
 *
 * Gatilhos no banco de cada conta anotam o que mudou no diário e nas
 * conquistas (`social_outbox`); aqui essa caixa é esvaziada para o banco
 * núcleo. Só entra no feed o que é recente — uma importação de anos de
 * Letterboxd, ou a primeira leitura de 3 mil conquistas da Steam, não pode
 * soterrar o feed dos amigos.
 *
 * Conquistas são consolidadas: uma entrada por jogo e por dia, que cresce
 * (e volta ao topo) a cada conquista nova.
 */
import { core, coreDb } from '../core-db.js'
import { db, requireUserId } from '../db.js'
import { cfg } from '../integrations/config.js'

const RECENT_MS = 3 * 24 * 3600 * 1000
/** Origens que trazem histórico, não atividade de agora. */
const HISTORICAL_SOURCES = new Set(['backfill', 'letterboxd'])
const MAX_ACHIEVEMENTS_PER_POST = 60

export interface FeedMedia {
  local_id: number
  type: string
  external_id: string
  title: string
  cover_url: string | null
  year: number | null
}

export interface DiaryData {
  entry_id: number
  watched_at: string
  rating: number | null
  comment: string | null
  source: string
  season_number: number | null
  episode_number: number | null
  episode_title: string | null
  progress: { value: number; total: number | null; unit: string } | null
  status: string | null
  game_status: string | null
}

export interface AchievementItem {
  api_name: string
  name: string
  description: string | null
  icon: string | null
  percent: number | null
  unlocked_at: string | null
}

export interface AchievementsData {
  appid: number
  day: string
  items: AchievementItem[]
  unlocked: number | null
  total: number | null
}

export function shareDiary(): boolean { return cfg('FEED_SHARE_DIARY') !== '0' }
export function shareAchievements(): boolean { return cfg('FEED_SHARE_ACHIEVEMENTS') !== '0' }

function isRecent(value: string | null | undefined, now = Date.now()): boolean {
  if (!value) return false
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T12:00:00Z` : value.includes('T') || value.includes('Z') ? value : `${value.replace(' ', 'T')}Z`
  const at = Date.parse(iso)
  return Number.isFinite(at) && at >= now - RECENT_MS && at <= now + RECENT_MS
}

const nowIso = () => new Date().toISOString()

function upsertPost(key: string, authorId: number, kind: 'diary' | 'achievements', media: FeedMedia, data: unknown, bump: boolean): void {
  const existing = core('SELECT id FROM feed_posts WHERE source_key = ?').get(key) as { id: number } | undefined
  if (existing) {
    core(`UPDATE feed_posts SET media_json = ?, data_json = ?, updated_at = ?${bump ? ', created_at = ?' : ''} WHERE id = ?`)
      .run(...[JSON.stringify(media), JSON.stringify(data), nowIso(), ...(bump ? [nowIso()] : []), existing.id])
    return
  }
  core(`
    INSERT INTO feed_posts (author_id, kind, media_json, data_json, source_key, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(authorId, kind, JSON.stringify(media), JSON.stringify(data), key, nowIso(), nowIso())
}

/* ─────────────────────────────── Diário ─────────────────────────────── */

const diaryRow = db.prepare(`
  SELECT d.id, d.media_item_id, d.watched_at, d.rating, d.comment, d.source,
         d.season_number, d.episode_number, d.progress_value, d.progress_total, d.progress_unit,
         m.type, m.external_id, m.title, m.cover_url, m.year, m.status, m.game_status,
         e.title AS episode_title
    FROM diary_entries d
    JOIN media_items m ON m.id = d.media_item_id
    LEFT JOIN series_episodes e ON e.media_item_id = d.media_item_id
      AND e.season_number = d.season_number AND e.episode_number = d.episode_number
   WHERE d.id = ?
`)

type DiaryRow = {
  id: number; media_item_id: number; watched_at: string; rating: number | null; comment: string | null; source: string
  season_number: number | null; episode_number: number | null
  progress_value: number | null; progress_total: number | null; progress_unit: string | null
  type: string; external_id: string; title: string; cover_url: string | null; year: number | null
  status: string | null; game_status: string | null; episode_title: string | null
}

function syncDiary(userId: number, entryId: number, op: 'upsert' | 'delete'): void {
  const key = `diary:${userId}:${entryId}`
  if (op === 'delete') {
    core('DELETE FROM feed_posts WHERE source_key = ?').run(key)
    return
  }
  const row = diaryRow.get(entryId) as DiaryRow | undefined
  if (!row) return
  const exists = Boolean(core('SELECT 1 FROM feed_posts WHERE source_key = ?').get(key))
  // Entrada nova só vira post se for atividade de agora; uma que já está no
  // feed sempre acompanha a edição (nota ou resenha escritas depois).
  if (!exists && (!shareDiary() || HISTORICAL_SOURCES.has(row.source) || !isRecent(row.watched_at))) return
  const media: FeedMedia = {
    local_id: row.media_item_id, type: row.type, external_id: row.external_id,
    title: row.title, cover_url: row.cover_url, year: row.year,
  }
  const data: DiaryData = {
    entry_id: row.id, watched_at: row.watched_at, rating: row.rating && row.rating > 0 ? row.rating : null,
    comment: row.comment?.trim() || null, source: row.source,
    season_number: row.season_number, episode_number: row.episode_number, episode_title: row.episode_title,
    progress: row.progress_value != null && row.progress_unit
      ? { value: row.progress_value, total: row.progress_total, unit: row.progress_unit }
      : null,
    status: row.status, game_status: row.game_status,
  }
  upsertPost(key, userId, 'diary', media, data, false)
}

/* ────────────────────────────── Conquistas ───────────────────────────── */

const achievementRow = db.prepare(`
  SELECT a.appid, a.api_name, a.name, a.description, a.icon, a.global_percent, a.unlocked_at,
         m.id AS media_item_id, m.external_id, m.title, m.cover_url, m.year,
         m.achievements_unlocked, m.achievements_total
    FROM steam_achievements a
    LEFT JOIN media_items m ON m.steam_appid = a.appid AND m.type = 'game'
   WHERE a.appid = ? AND a.api_name = ? AND a.achieved = 1
   LIMIT 1
`)

type AchievementRow = {
  appid: number; api_name: string; name: string; description: string | null; icon: string | null
  global_percent: number | null; unlocked_at: string | null
  media_item_id: number | null; external_id: string | null; title: string | null; cover_url: string | null; year: number | null
  achievements_unlocked: number | null; achievements_total: number | null
}

function syncAchievement(userId: number, appid: number, apiName: string): void {
  if (!shareAchievements()) return
  const row = achievementRow.get(appid, apiName) as AchievementRow | undefined
  // Sem o jogo na biblioteca não há capa nem título para mostrar.
  if (!row || row.media_item_id == null || !isRecent(row.unlocked_at)) return
  const day = (row.unlocked_at ?? nowIso()).slice(0, 10)
  const key = `ach:${userId}:${appid}:${day}`
  const existing = core('SELECT data_json FROM feed_posts WHERE source_key = ?').get(key) as { data_json: string } | undefined
  const data: AchievementsData = existing
    ? JSON.parse(existing.data_json) as AchievementsData
    : { appid, day, items: [], unlocked: null, total: null }
  if (data.items.some(item => item.api_name === apiName)) return
  data.items.push({
    api_name: row.api_name, name: row.name, description: row.description, icon: row.icon,
    percent: row.global_percent, unlocked_at: row.unlocked_at,
  })
  data.items.sort((a, b) => String(a.unlocked_at).localeCompare(String(b.unlocked_at)))
  if (data.items.length > MAX_ACHIEVEMENTS_PER_POST) data.items = data.items.slice(-MAX_ACHIEVEMENTS_PER_POST)
  data.unlocked = row.achievements_unlocked
  data.total = row.achievements_total
  const media: FeedMedia = {
    local_id: row.media_item_id, type: 'game', external_id: row.external_id ?? `steam:${appid}`,
    title: row.title ?? `App ${appid}`, cover_url: row.cover_url, year: row.year,
  }
  // Conquista nova numa entrada de hoje traz a entrada de volta ao topo.
  upsertPost(key, userId, 'achievements', media, data, true)
}

/* ─────────────────────────────── Drenagem ─────────────────────────────── */

const pending = db.prepare('SELECT 1 FROM social_outbox LIMIT 1')
const batch = db.prepare('SELECT id, kind, ref_id, ref_text, op FROM social_outbox ORDER BY id LIMIT 500')
const consume = db.prepare('DELETE FROM social_outbox WHERE id <= ?')

/** Esvazia a caixa de saída de quem está no contexto. Barato quando não há nada. */
export function drainSocialOutbox(): void {
  if (!pending.get()) return
  const userId = requireUserId()
  for (let round = 0; round < 20; round++) {
    const rows = batch.all() as { id: number; kind: string; ref_id: number; ref_text: string | null; op: 'upsert' | 'delete' }[]
    if (!rows.length) return
    coreDb.transaction(() => {
      for (const row of rows) {
        if (row.kind === 'diary') syncDiary(userId, row.ref_id, row.op)
        else if (row.kind === 'achievement' && row.ref_text) syncAchievement(userId, row.ref_id, row.ref_text)
      }
    })()
    consume.run(rows[rows.length - 1].id)
  }
}
