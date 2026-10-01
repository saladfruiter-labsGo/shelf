/**
 * Capas dos jogos ligados à Steam: arte vertical oficial (`library_600x900_2x`)
 * no lugar da capa da RAWG, que costuma ser uma screenshot em paisagem e fica
 * cortada nos cards 2:3 da biblioteca e do resumo.
 *
 * - Capa escolhida à mão (`cover_custom = 1`) nunca é trocada.
 * - Jogo sem arte vertical na Steam mantém a capa atual; a tentativa fica
 *   guardada por 30 dias para não repetir a cada leitura.
 */
import { db } from '../db.js'
import { cfg, setCfg } from '../integrations/config.js'

const MISSES_KEY = 'STEAM_COVER_MISSES'
const RETRY_MS = 30 * 24 * 3_600_000

export function steamVerticalCover(appid: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`
}

export function isSteamVerticalCover(url: string | null | undefined): boolean {
  return !!url && /\/steam\/apps\/\d+\/library_600x900/.test(url)
}

async function exists(url: string, fetchImpl: typeof fetch): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8_000)
  try {
    const res = await fetchImpl(url, { method: 'HEAD', signal: ctrl.signal })
    return res.ok
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}

const setCover = db.prepare(`
  UPDATE media_items SET cover_url = ?, updated_at = datetime('now')
   WHERE id = ? AND COALESCE(cover_custom, 0) = 0
`)

function readMisses(): Record<string, number> {
  try { return JSON.parse(cfg(MISSES_KEY) || '{}') } catch { return {} }
}

/** Troca a capa de um jogo pela arte vertical da Steam, se ela existir. */
export async function ensureSteamCover(
  game: { id: number; steam_appid: number; cover_url: string | null; cover_custom?: number | null },
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  if (game.cover_custom || isSteamVerticalCover(game.cover_url)) return false
  const misses = readMisses()
  const missedAt = misses[String(game.steam_appid)]
  if (missedAt && Date.now() - missedAt < RETRY_MS) return false

  const url = steamVerticalCover(game.steam_appid)
  if (await exists(url, fetchImpl)) {
    return setCover.run(url, game.id).changes > 0
  }
  misses[String(game.steam_appid)] = Date.now()
  setCfg(MISSES_KEY, JSON.stringify(misses))
  return false
}

let running: Promise<number> | null = null

/** Passa por todos os jogos ligados à Steam com capa de outra fonte. */
export function refreshSteamCovers(limit = 150, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (running) return running
  running = (async () => {
    const games = (db.prepare(`
      SELECT id, steam_appid, cover_url, cover_custom FROM media_items
       WHERE type = 'game' AND steam_appid IS NOT NULL AND COALESCE(cover_custom, 0) = 0
    `).all() as { id: number; steam_appid: number; cover_url: string | null; cover_custom: number }[])
      .filter(g => !isSteamVerticalCover(g.cover_url))
      .slice(0, limit)

    let changed = 0
    const queue = [...games]
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let game = queue.shift(); game; game = queue.shift()) {
        if (await ensureSteamCover(game, fetchImpl)) changed++
      }
    }))
    return changed
  })().finally(() => { running = null })
  return running
}

export async function stopSteamCovers(): Promise<void> {
  await running?.catch(() => {})
}
