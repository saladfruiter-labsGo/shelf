/**
 * Página de Perfil: tudo o que ela mostra é montado aqui, no servidor.
 *
 * Desenhado para o multiusuário (MU-04): hoje existe um perfil só (`profile`
 * com `id = 1`), mas a resposta já tem o formato de "perfil de alguém" — no
 * multiusuário ela passa a ser `GET /api/users/:username/profile` sem mudar.
 *
 * Regras:
 * - nunca inclui credenciais, e-mail, SteamID ou configuração de integrações;
 * - cada bloco declara a procedência (`source`), para o selo da Steam.
 */
import { db } from './db.js'
import { cfg, setCfg } from './integrations/config.js'
import { LIBRARY_STATUS_PREDICATE, QUEUE_PREDICATE } from './media-domain.js'
import { fetchPlayerSummary, type SteamPlayerSummary } from './steam/client.js'

export type DataSource = 'steam' | 'shelf'

export interface ProfileView {
  user: {
    display_name: string
    avatar_url: string | null
    avatar_source: DataSource | null
    member_since: string
  }
  accounts: {
    steam: (SteamPlayerSummary & { source: 'steam' }) | null
  }
  totals: { library: number; wishlist: number; backlog: number; diary: number; rated: number }
  shelf_by_year: { year: number; total: number; completed: number; in_progress: number }[]
  games: {
    year: number
    played_hours: number
    played_source: DataSource
    playing: number
    backlog: number
    completed_total: number
    platinum_total: number
    completed_this_year: number
    platinum_this_year: number
    completed_source: DataSource
    /** Conquistas desbloqueadas na Steam (sempre com selo). */
    achievements_unlocked: number
    rarest_achievement: { name: string; game: string; media_item_id: number; percent: number } | null
  }
  favorites: { id: number; type: string; title: string; cover_url: string | null; favorite: number }[]
  recent_ratings: { id: number; media_item_id: number; type: string; title: string; cover_url: string | null; rating: number; watched_at: string }[]
  activity: { id: number; source: string; event_type: string; media_type: string; title: string; subtitle: string | null; cover_url: string | null; rating: number | null; occurred_at: string }[]
}

/* ─────────────────────────────── Conta Steam ─────────────────────────────── */

const STEAM_SUMMARY_KEY = 'STEAM_PLAYER_SUMMARY'
const STEAM_SUMMARY_TTL_MS = 12 * 3_600_000
const STEAM_RETRY_MS = 15 * 60_000

interface CachedSummary { at: number; steam_id: string; summary: SteamPlayerSummary | null }

function readSummaryCache(): CachedSummary | null {
  try { return JSON.parse(cfg(STEAM_SUMMARY_KEY) || 'null') } catch { return null }
}

/**
 * Nome, avatar e link do perfil Steam, com cache de 12 h. A Steam fora do ar
 * nunca derruba o Perfil: devolve o último valor conhecido (ou nada).
 */
async function steamAccount(fetchSummary: () => Promise<SteamPlayerSummary | null>): Promise<SteamPlayerSummary | null> {
  const steamId = cfg('STEAM_ID')
  if (!steamId) return null
  const cached = readSummaryCache()
  const fresh = cached && cached.steam_id === steamId && Date.now() - cached.at < STEAM_SUMMARY_TTL_MS
  if (fresh) return cached.summary
  try {
    const summary = await fetchSummary()
    setCfg(STEAM_SUMMARY_KEY, JSON.stringify({ at: Date.now(), steam_id: steamId, summary } satisfies CachedSummary))
    return summary
  } catch {
    // Mantém o último valor e só tenta de novo em 15 min, para cada visita ao
    // Perfil não bater na Steam enquanto ela (ou a API key) estiver com problema.
    const previous = cached?.steam_id === steamId ? cached.summary : null
    setCfg(STEAM_SUMMARY_KEY, JSON.stringify({
      at: Date.now() - STEAM_SUMMARY_TTL_MS + STEAM_RETRY_MS, steam_id: steamId, summary: previous,
    } satisfies CachedSummary))
    return previous
  }
}

/* ─────────────────────────────────── Perfil ──────────────────────────────── */

const FIRST_YEAR = 2022

const count = (sql: string, ...params: unknown[]): number =>
  (db.prepare(sql).get(...params) as { n: number | null }).n ?? 0

/** Procedência de um agregado: só é "da Steam" se tudo que entrou nele veio dela. */
function aggregateSource(column: 'playtime_source' | 'game_status_source', where: string): DataSource {
  const row = db.prepare(`
    SELECT COUNT(*) AS total, SUM(CASE WHEN ${column} = 'steam' THEN 1 ELSE 0 END) AS steam
      FROM media_items WHERE type = 'game' AND ${where}
  `).get() as { total: number; steam: number | null }
  return row.total > 0 && row.steam === row.total ? 'steam' : 'shelf'
}

export async function buildProfile(
  options: { now?: Date; fetchSteamSummary?: () => Promise<SteamPlayerSummary | null> } = {},
): Promise<ProfileView> {
  const now = options.now ?? new Date()
  const year = now.getFullYear()
  const yearStr = String(year)

  const profile = db.prepare('SELECT display_name, avatar_url, created_at FROM profile WHERE id = 1').get() as
    { display_name: string; avatar_url: string | null; created_at: string } | undefined
  const firstItem = (db.prepare('SELECT MIN(added_at) AS at FROM media_items').get() as { at: string | null }).at

  const steam = await steamAccount(options.fetchSteamSummary ?? fetchPlayerSummary)
  const ownAvatar = profile?.avatar_url ?? null
  const avatar_url = ownAvatar ?? steam?.avatar_url ?? null

  // Mesma conta que o painel antigo do Perfil fazia: biblioteca por ano de entrada.
  const byYear = new Map(
    (db.prepare(`
      SELECT strftime('%Y', added_at) AS added_year,
             COUNT(*) AS total,
             SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
             SUM(CASE WHEN status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress
        FROM media_items WHERE ${LIBRARY_STATUS_PREDICATE}
       GROUP BY added_year
    `).all() as { added_year: string; total: number; completed: number; in_progress: number }[])
      .map(row => [Number(row.added_year), row]),
  )
  const shelf_by_year = Array.from({ length: Math.max(0, year - FIRST_YEAR + 1) }, (_, i) => year - i).map(y => ({
    year: y,
    total: byYear.get(y)?.total ?? 0,
    completed: byYear.get(y)?.completed ?? 0,
    in_progress: byYear.get(y)?.in_progress ?? 0,
  }))

  const finished = "game_status IN ('zerado', 'platinado')"
  const playedSeconds = count("SELECT SUM(playtime_seconds) AS n FROM media_items WHERE type = 'game'")

  return {
    user: {
      display_name: profile?.display_name ?? 'Você',
      avatar_url,
      avatar_source: ownAvatar ? 'shelf' : steam?.avatar_url ? 'steam' : null,
      member_since: [profile?.created_at, firstItem].filter((v): v is string => !!v).sort()[0] ?? now.toISOString(),
    },
    accounts: { steam: steam ? { ...steam, source: 'steam' } : null },
    totals: {
      library: count(`SELECT COUNT(*) AS n FROM media_items WHERE ${LIBRARY_STATUS_PREDICATE}`),
      wishlist: count(`SELECT COUNT(*) AS n FROM media_items WHERE ${QUEUE_PREDICATE.wishlist}`),
      backlog: count(`SELECT COUNT(*) AS n FROM media_items WHERE ${QUEUE_PREDICATE.backlog}`),
      diary: count('SELECT COUNT(*) AS n FROM diary_entries'),
      rated: count(`SELECT COUNT(*) AS n FROM media_items WHERE rating > 0 AND ${LIBRARY_STATUS_PREDICATE}`),
    },
    shelf_by_year,
    games: {
      year,
      played_hours: Math.round(playedSeconds / 3600),
      played_source: aggregateSource('playtime_source', 'playtime_seconds > 0'),
      playing: count("SELECT COUNT(*) AS n FROM media_items WHERE type = 'game' AND game_status = 'jogando'"),
      backlog: count(`SELECT COUNT(*) AS n FROM media_items WHERE type = 'game' AND ${QUEUE_PREDICATE.backlog}`),
      completed_total: count(`SELECT COUNT(*) AS n FROM media_items WHERE type = 'game' AND ${finished}`),
      platinum_total: count("SELECT COUNT(*) AS n FROM media_items WHERE type = 'game' AND game_status = 'platinado'"),
      completed_this_year: count(
        `SELECT COUNT(*) AS n FROM media_items WHERE type = 'game' AND ${finished} AND strftime('%Y', completed_at) = ?`, yearStr,
      ),
      platinum_this_year: count(
        "SELECT COUNT(*) AS n FROM media_items WHERE type = 'game' AND game_status = 'platinado' AND strftime('%Y', completed_at) = ?", yearStr,
      ),
      completed_source: aggregateSource('game_status_source', finished),
      achievements_unlocked: count('SELECT COUNT(*) AS n FROM steam_achievements WHERE achieved = 1'),
      rarest_achievement: (db.prepare(`
        SELECT a.name, m.title AS game, m.id AS media_item_id, a.global_percent AS percent
          FROM steam_achievements a JOIN media_items m ON m.steam_appid = a.appid AND m.type = 'game'
         WHERE a.achieved = 1 AND a.global_percent IS NOT NULL
         ORDER BY a.global_percent ASC, a.unlocked_at ASC
         LIMIT 1
      `).get() as ProfileView['games']['rarest_achievement'] | undefined) ?? null,
    },
    favorites: db.prepare(`
      SELECT id, type, title, cover_url, favorite FROM media_items
       WHERE favorite > 0
       ORDER BY favorite DESC, type, title COLLATE NOCASE
       LIMIT 25
    `).all() as ProfileView['favorites'],
    recent_ratings: db.prepare(`
      SELECT d.id, d.media_item_id, m.type, m.title, m.cover_url, d.rating, d.watched_at
        FROM diary_entries d JOIN media_items m ON m.id = d.media_item_id
       WHERE d.rating > 0
       ORDER BY d.watched_at DESC, d.id DESC
       LIMIT 8
    `).all() as ProfileView['recent_ratings'],
    // Música gera dezenas de eventos por dia; no Perfil ela apagaria o resto.
    activity: db.prepare(`
      SELECT id, source, event_type, media_type, title, subtitle, cover_url, rating, occurred_at
        FROM activity_events WHERE media_type != 'music'
       ORDER BY occurred_at DESC LIMIT 10
    `).all() as ProfileView['activity'],
  }
}

/* ─────────────────────────────────── Edição ──────────────────────────────── */

export type ProfileUpdate = { display_name?: string; avatar_url?: string | null }

/** Valida a edição do perfil; devolve a mensagem de erro ou os campos limpos. */
export function parseProfileUpdate(body: unknown): { ok: true; update: ProfileUpdate } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Corpo inválido.' }
  const input = body as Record<string, unknown>
  const update: ProfileUpdate = {}

  if ('display_name' in input) {
    const name = typeof input.display_name === 'string' ? input.display_name.trim().replace(/\s+/g, ' ') : ''
    if (!name || name.length > 60) return { ok: false, error: 'O nome precisa ter de 1 a 60 caracteres.' }
    update.display_name = name
  }
  if ('avatar_url' in input) {
    if (input.avatar_url === null || input.avatar_url === '') update.avatar_url = null
    else {
      try {
        const url = new URL(String(input.avatar_url))
        if (url.protocol !== 'https:') throw new Error()
        update.avatar_url = url.toString()
      } catch {
        return { ok: false, error: 'O avatar precisa ser um link https.' }
      }
    }
  }
  if (Object.keys(update).length === 0) return { ok: false, error: 'Nada para atualizar.' }
  return { ok: true, update }
}

export function applyProfileUpdate(update: ProfileUpdate): void {
  if (update.display_name !== undefined) {
    db.prepare("UPDATE profile SET display_name = ?, updated_at = datetime('now') WHERE id = 1").run(update.display_name)
  }
  if (update.avatar_url !== undefined) {
    db.prepare("UPDATE profile SET avatar_url = ?, updated_at = datetime('now') WHERE id = 1").run(update.avatar_url)
  }
}
