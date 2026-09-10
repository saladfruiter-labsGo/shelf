/**
 * Conector da Steam: sincronização bidirecional do backlog e importação da
 * biblioteca.
 *
 * O casamento entre um jogo do Shelf e um da Steam é sempre pelo **AppID**,
 * guardado em `media_items.steam_appid`. Título é só o último recurso, e apenas
 * quando bate exatamente depois de normalizado — casar errado aqui adicionaria
 * o jogo errado na wishlist da conta do usuário.
 *
 * O sentido Shelf → Steam depende dos cookies da loja (ver `client.ts`). Sem
 * eles a sincronização continua funcionando, só de mão única, e o relatório diz
 * quantos itens ficaram esperando.
 */
import { db } from '../db.js'
import { normalizeTitle, steamAppIdFromRawg } from '../prices/matcher.js'
import { rawgLookup } from '../routes/search.js'
import { planWishlistSync, nextKnown, type SteamSyncOptions } from './plan.js'
import * as steam from './client.js'

const getSetting = db.prepare('SELECT value FROM settings WHERE key = ?')
const setSetting = db.prepare(
  'INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
)

function cfg(key: string): string {
  const row = getSetting.get(key) as { value: string } | undefined
  return row?.value?.trim() || process.env[key] || ''
}

/* ─────────────────────────────────── Estado ──────────────────────────────── */

interface SteamState {
  /** AppIDs vistos nos dois lados na última sincronização — base das remoções. */
  known: number[]
}

function readState(): SteamState {
  try {
    const parsed = JSON.parse(cfg('STEAM_STATE') || '{}')
    return { known: Array.isArray(parsed.known) ? parsed.known.map(Number) : [] }
  } catch {
    return { known: [] }
  }
}
function writeState(s: SteamState) { setSetting.run('STEAM_STATE', JSON.stringify(s)) }

export interface SteamSyncResult {
  at: string
  pulled: number
  pushed: number
  removed_shelf: number
  removed_steam: number
  /** Jogos do backlog cujo AppID não foi descoberto (não sobem para a Steam). */
  unmatched: string[]
  pending_push: number
  can_write: boolean
  errors: string[]
}

export function lastSync(): SteamSyncResult | null {
  try { return JSON.parse(cfg('STEAM_LAST_SYNC') || 'null') } catch { return null }
}

/* ────────────────────────────── Jogos do Shelf ───────────────────────────── */

interface ShelfGame {
  id: number
  external_id: string
  title: string
  status: string
  game_status: string | null
  steam_appid: number | null
}

function backlogGames(): ShelfGame[] {
  return db.prepare(
    `SELECT id, external_id, title, status, game_status, steam_appid
       FROM media_items WHERE type = 'game' AND status = 'wishlist'`,
  ).all() as ShelfGame[]
}

const setAppId = db.prepare('UPDATE media_items SET steam_appid = ? WHERE id = ?')
const findByAppId = db.prepare("SELECT * FROM media_items WHERE type = 'game' AND steam_appid = ?")

/** Jogo do Shelf com o mesmo título normalizado (para adotar um AppID sem duplicar). */
function findGameByTitle(title: string): ShelfGame | undefined {
  const target = normalizeTitle(title)
  const rows = db.prepare(
    "SELECT id, external_id, title, status, game_status, steam_appid FROM media_items WHERE type = 'game'",
  ).all() as ShelfGame[]
  return rows.find(r => normalizeTitle(r.title) === target)
}

/**
 * Descobre o AppID de um jogo do Shelf: coluna → lojas da RAWG → busca na loja
 * por título exato. Grava o resultado para não repetir a busca.
 */
async function resolveAppId(game: ShelfGame): Promise<number | null> {
  if (game.steam_appid) return game.steam_appid

  const fromRawg = await steamAppIdFromRawg(game.external_id).catch(() => null)
  if (fromRawg) { setAppId.run(fromRawg, game.id); return fromRawg }

  const target = normalizeTitle(game.title)
  const hits = await steam.searchStore(game.title).catch(() => [])
  const exact = hits.find(h => normalizeTitle(h.name) === target)
  if (exact) { setAppId.run(exact.appid, game.id); return exact.appid }

  return null
}

/* ───────────────────────── Criação de itens vindos da Steam ──────────────── */

// O conector só cria item de backlog: `nunca_jogado` (que o Shelf deriva para
// `wishlist`). O que foi jogado é assunto do Playnite, não da Steam.
const insertBacklogGame = db.prepare(`
  INSERT INTO media_items
    (external_id, type, title, cover_url, year, genre, creators, publisher, synopsis, release_date,
     status, game_status, library, steam_appid)
  VALUES
    (@external_id, 'game', @title, @cover_url, @year, @genre, @creators, @publisher, @synopsis, @release_date,
     'wishlist', 'nunca_jogado', 'Steam', @steam_appid)
  ON CONFLICT(external_id, type) DO UPDATE SET
    steam_appid = COALESCE(media_items.steam_appid, excluded.steam_appid),
    cover_url   = COALESCE(media_items.cover_url, excluded.cover_url),
    year        = COALESCE(media_items.year, excluded.year),
    genre       = COALESCE(media_items.genre, excluded.genre),
    creators    = COALESCE(media_items.creators, excluded.creators),
    publisher   = COALESCE(media_items.publisher, excluded.publisher),
    synopsis    = COALESCE(media_items.synopsis, excluded.synopsis),
    library     = COALESCE(media_items.library, 'Steam'),
    updated_at  = datetime('now')
`)

/**
 * Cria no backlog o jogo que veio da wishlist da Steam.
 *
 * O `external_id` tenta ser o id da RAWG — é o mesmo que a busca manual e o
 * Playnite usam, então o card criado aqui é o mesmo card depois. Sem RAWG
 * disponível, cai para `steam:<appid>`, que continua estável.
 *
 * Um jogo que já existe (por AppID ou por título) **não muda de status**: só
 * adota o AppID. Isso protege a regra de a wishlist nunca rebaixar algo que já
 * está na biblioteca — um jogo que você zerou e ainda tem na wishlist da Steam
 * continua zerado aqui.
 */
async function upsertBacklogGame(
  appid: number,
  name: string,
  coverUrl?: string | null,
): Promise<{ id: number; created: boolean } | null> {
  const existing = findByAppId.get(appid) as { id: number } | undefined
  if (existing) return { id: existing.id, created: false }

  const byTitle = findGameByTitle(name)
  if (byTitle) {
    setAppId.run(appid, byTitle.id)
    return { id: byTitle.id, created: false }
  }

  const details = await steam.fetchAppDetails(appid).catch(() => null)
  const rawg = await rawgLookup(name).catch(() => null)

  const external_id = rawg?.external_id ?? `steam:${appid}`
  insertBacklogGame.run({
    external_id,
    title: details?.name || name,
    cover_url: coverUrl ?? rawg?.cover_url ?? details?.cover_url ?? steam.headerImage(appid),
    year: details?.year ?? rawg?.year ?? null,
    genre: details?.genre ?? rawg?.genre ?? null,
    creators: details?.developers ?? null,
    publisher: details?.publisher ?? null,
    synopsis: details?.synopsis ?? null,
    release_date: details?.release_date ?? rawg?.release_date ?? null,
    steam_appid: appid,
  })
  const row = db.prepare("SELECT id FROM media_items WHERE external_id = ? AND type = 'game'").get(external_id) as { id: number } | undefined
  if (!row) return null
  setAppId.run(appid, row.id)
  return { id: row.id, created: true }
}

/* ──────────────────────────── Sincronização do backlog ───────────────────── */

export function syncOptions(): SteamSyncOptions {
  const mode = cfg('STEAM_SYNC_MODE') || 'both'
  return {
    pull: mode === 'pull' || mode === 'both',
    push: (mode === 'push' || mode === 'both') && steam.steamCanWrite(),
    removals: cfg('STEAM_SYNC_REMOVALS') === '1',
  }
}

let running = false
export function syncRunning(): boolean { return running }

interface RunOptions {
  /** Exige o conector ligado. A importação avulsa roda só com o SteamID. */
  requireEnabled: boolean
  /** Grava o resultado como "última sincronização" no card de Integrações. */
  persistLastSync: boolean
}

async function runSync(opts: SteamSyncOptions, run: RunOptions): Promise<SteamSyncResult> {
  const result: SteamSyncResult = {
    at: new Date().toISOString(),
    pulled: 0, pushed: 0, removed_shelf: 0, removed_steam: 0,
    unmatched: [], pending_push: 0, can_write: steam.steamCanWrite(), errors: [],
  }
  if (running) { result.errors.push('Uma sincronização já está em andamento.'); return result }
  if (run.requireEnabled && !steam.steamEnabled()) {
    result.errors.push('Conector da Steam desativado ou sem SteamID.')
    return result
  }
  if (!steam.cfg('STEAM_ID')) { result.errors.push('SteamID não configurado.'); return result }

  running = true
  try {
    const wishlist = await steam.fetchWishlist()
    const steamIds = wishlist.map(w => w.appid)

    // Jogo já comprado não pode ir para a wishlist (a Steam recusa), e o backlog
    // do Shelf inclui os "nunca jogados" da biblioteca importada. Com a API key
    // disponível, esses saem da conta antes de qualquer envio.
    const owned = new Set<number>()
    if (steam.cfg('STEAM_API_KEY')) {
      for (const g of await steam.fetchOwnedGames().catch(() => [])) owned.add(g.appid)
    }

    // Backlog do Shelf com AppID resolvido (o resto não tem como subir).
    const games = backlogGames()
    const shelfIds: number[] = []
    const byAppId = new Map<number, ShelfGame>()
    for (const g of games) {
      const appid = await resolveAppId(g)
      if (appid == null) { result.unmatched.push(g.title); continue }
      if (owned.has(appid) && !steamIds.includes(appid)) continue
      shelfIds.push(appid)
      byAppId.set(appid, g)
    }

    const state = readState()

    // Wishlist vazia com histórico é ambígua: pode ser perfil que ficou privado
    // ou uma resposta capenga da Steam. Propagar remoções aqui esvaziaria o
    // backlog inteiro, então nesse caso a sincronização vira só-leitura.
    let effective = opts
    if (steamIds.length === 0 && state.known.length > 0) {
      effective = { ...opts, removals: false }
      result.errors.push('A Steam devolveu a wishlist vazia — remoções não foram propagadas. Confira se o perfil ainda está público.')
    }

    const plan = planWishlistSync(steamIds, shelfIds, state.known, effective)

    // Steam → Shelf
    for (const appid of plan.toShelf) {
      const entry = wishlist.find(w => w.appid === appid)
      const details = await steam.fetchAppDetails(appid).catch(() => null)
      const name = details?.name || `App ${appid}`
      try {
        const game = await upsertBacklogGame(appid, name, details?.cover_url ?? steam.headerImage(appid))
        // Preserva a data em que o jogo entrou na wishlist da Steam — mas só no
        // card recém-criado. Reescrever o `added_at` de um item que já existia
        // mudaria a ordem da biblioteca e as estatísticas por ano do Perfil.
        if (game?.created && entry?.added_at) {
          db.prepare('UPDATE media_items SET added_at = ? WHERE id = ?').run(entry.added_at, game.id)
        }
        result.pulled++
      } catch (e) {
        result.errors.push(`${name}: ${(e as Error).message}`)
      }
    }

    // Shelf → Steam
    if (effective.push) {
      for (const appid of plan.toSteam) {
        try { await steam.addToWishlist(appid); result.pushed++ }
        catch (e) { result.errors.push(`${byAppId.get(appid)?.title ?? appid}: ${(e as Error).message}`) }
      }
    } else {
      result.pending_push = plan.toSteam.length
    }

    // Remoções (só para o que já estava sincronizado dos dois lados)
    for (const appid of plan.removeFromShelf) {
      const row = findByAppId.get(appid) as { id: number; status: string } | undefined
      if (row && row.status === 'wishlist') {
        db.prepare('DELETE FROM media_items WHERE id = ?').run(row.id)
        result.removed_shelf++
      }
    }
    if (effective.push) {
      for (const appid of plan.removeFromSteam) {
        try { await steam.removeFromWishlist(appid); result.removed_steam++ }
        catch (e) { result.errors.push(`remover ${appid}: ${(e as Error).message}`) }
      }
    }

    // Numa leitura suspeita, o estado antigo é mais confiável que o novo.
    if (effective === opts) writeState({ known: nextKnown(steamIds, shelfIds, plan) })
  } catch (e) {
    result.errors.push((e as Error).message)
  } finally {
    running = false
  }

  if (run.persistLastSync) setSetting.run('STEAM_LAST_SYNC', JSON.stringify(result))
  return result
}

/** Sincronização completa: o que o agendador e o botão em Integrações rodam. */
export function syncSteamBacklog(): Promise<SteamSyncResult> {
  return runSync(syncOptions(), { requireEnabled: true, persistLastSync: true })
}

/**
 * Importação avulsa da tela de Importação/Exportação: uma passada só de leitura
 * (wishlist da Steam → backlog), sem exigir o conector ligado e sem se anunciar
 * como "última sincronização".
 */
export function importSteamWishlist(): Promise<SteamSyncResult> {
  return runSync({ pull: true, push: false, removals: false }, { requireEnabled: false, persistLastSync: false })
}

/* ──────────────────────────────── Agendamento ────────────────────────────── */

const FIRST_RUN_DELAY_MS = 60_000
const INTERVAL_MS = 6 * 3_600_000
let firstRunTimer: NodeJS.Timeout | null = null
let intervalTimer: NodeJS.Timeout | null = null

/** Sincroniza o backlog logo após o boot e a cada 6 h, quando o conector está ativo. */
export function startSteamSync(): void {
  if (firstRunTimer || intervalTimer) return
  const tick = () => { if (steam.steamEnabled()) syncSteamBacklog().catch(() => {}) }
  firstRunTimer = setTimeout(() => { firstRunTimer = null; tick() }, FIRST_RUN_DELAY_MS)
  intervalTimer = setInterval(tick, INTERVAL_MS)
  firstRunTimer.unref()
  intervalTimer.unref()
}

/** Cancela ciclos futuros e espera uma sincronização em andamento terminar. */
export async function stopSteamSync(): Promise<void> {
  if (firstRunTimer) clearTimeout(firstRunTimer)
  if (intervalTimer) clearInterval(intervalTimer)
  firstRunTimer = null
  intervalTimer = null
  while (running) await new Promise(resolve => setTimeout(resolve, 50))
}
