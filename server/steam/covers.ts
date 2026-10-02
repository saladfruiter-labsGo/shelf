/**
 * Capas dos jogos ligados à Steam: arte vertical oficial (capa da biblioteca)
 * no lugar da capa da RAWG, que costuma ser uma screenshot em paisagem e fica
 * cortada nos cards 2:3 da biblioteca e do resumo.
 *
 * Os endereços vêm do `IStoreBrowseService/GetItems` (sem chave, em lote):
 * jogos lançados depois de 2025 só têm arte em caminhos com hash
 * (`store_item_assets/steam/apps/<appid>/<hash>/library_capsule_2x.jpg`), e o
 * endereço antigo `steam/apps/<appid>/library_600x900_2x.jpg` — e até o
 * `header.jpg` — responde 404 para eles. Se a API não responder, cai no
 * endereço antigo, conferido com HEAD.
 *
 * - Capa escolhida à mão (`cover_custom = 1`) nunca é trocada.
 * - Jogo sem arte vertical na Steam mantém a capa atual (ou ganha o header,
 *   se a capa atual era um endereço da Steam que não existe); a tentativa fica
 *   guardada por 30 dias para não repetir a cada leitura.
 */
import { db } from '../db.js'
import { cfg, setCfg } from '../integrations/config.js'

// V2: as falhas guardadas antes só conheciam o endereço antigo — muitas eram falsas.
const MISSES_KEY = 'STEAM_COVER_MISSES_V2'
const RETRY_MS = 30 * 24 * 3_600_000
const ASSET_BASE = 'https://shared.akamai.steamstatic.com/store_item_assets/'
const BATCH = 50

/** Endereço antigo da arte vertical — só existe para jogos anteriores a 2025. */
export function steamVerticalCover(appid: number): string {
  return `https://cdn.cloudflare.steamstatic.com/steam/apps/${appid}/library_600x900_2x.jpg`
}

export function isSteamVerticalCover(url: string | null | undefined): boolean {
  return !!url && /\/steam\/apps\/\d+\/(?:[0-9a-f]+\/)?library_(?:600x900|capsule)/.test(url)
}

function isSteamCdn(url: string | null | undefined): boolean {
  return !!url && /^https:\/\/[a-z.-]*steamstatic\.com\//.test(url)
}

export interface SteamArt {
  vertical: string | null
  header: string | null
}

/**
 * Arte oficial de cada AppID, pela API da loja. AppID que a API não conhece ou
 * lote que falhou fica fora do mapa (quem chama decide o fallback).
 */
export async function fetchSteamArt(appids: number[], fetchImpl: typeof fetch = fetch): Promise<Map<number, SteamArt>> {
  const art = new Map<number, SteamArt>()
  const unique = [...new Set(appids.filter(id => Number.isInteger(id) && id > 0))]
  for (let i = 0; i < unique.length; i += BATCH) {
    const input = {
      ids: unique.slice(i, i + BATCH).map(appid => ({ appid })),
      context: { language: 'english', country_code: 'US' },
      data_request: { include_assets: true },
    }
    const url = `https://api.steampowered.com/IStoreBrowseService/GetItems/v1/?input_json=${encodeURIComponent(JSON.stringify(input))}`
    const ctrl = new AbortController()
    const timer = setTimeout(() => ctrl.abort(), 10_000)
    try {
      const res = await fetchImpl(url, { signal: ctrl.signal })
      if (!res.ok) continue
      const data = await res.json() as { response?: { store_items?: any[] } }
      for (const item of data.response?.store_items ?? []) {
        const appid = Number(item?.appid ?? item?.id)
        const assets = item?.assets
        if (item?.success !== 1 || !appid || typeof assets?.asset_url_format !== 'string') continue
        const build = (file: unknown) => typeof file === 'string' && file
          ? ASSET_BASE + assets.asset_url_format.replace('${FILENAME}', file)
          : null
        art.set(appid, {
          vertical: build(assets.library_capsule_2x) ?? build(assets.library_capsule),
          header: build(assets.header),
        })
      }
    } catch {
      // Lote sem resposta: esses AppIDs usam o endereço antigo.
    } finally {
      clearTimeout(timer)
    }
  }
  return art
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

/** Melhor capa da Steam para um AppID novo: vertical, senão header. */
export async function steamCoverFor(appid: number, art: SteamArt | undefined, fetchImpl: typeof fetch = fetch): Promise<string | null> {
  if (art) return art.vertical ?? art.header
  const legacy = steamVerticalCover(appid)
  return await exists(legacy, fetchImpl) ? legacy : null
}

const setCover = db.prepare(`
  UPDATE media_items SET cover_url = ?, updated_at = datetime('now')
   WHERE id = ? AND COALESCE(cover_custom, 0) = 0
`)

function readMisses(): Record<string, number> {
  try { return JSON.parse(cfg(MISSES_KEY) || '{}') } catch { return {} }
}

type CoverGame = { id: number; steam_appid: number; cover_url: string | null; cover_custom?: number | null }

async function applyCover(
  game: CoverGame,
  art: SteamArt | undefined,
  misses: Record<string, number>,
  fetchImpl: typeof fetch,
): Promise<boolean> {
  const vertical = art ? art.vertical : (await exists(steamVerticalCover(game.steam_appid), fetchImpl) ? steamVerticalCover(game.steam_appid) : null)
  if (vertical) return setCover.run(vertical, game.id).changes > 0

  misses[String(game.steam_appid)] = Date.now()
  // Sem arte vertical: uma capa que aponta para a Steam (e talvez nem exista mais) vira o header oficial.
  if (art?.header && (!game.cover_url || isSteamCdn(game.cover_url)) && game.cover_url !== art.header) {
    return setCover.run(art.header, game.id).changes > 0
  }
  return false
}

function needsCover(game: CoverGame, misses: Record<string, number>): boolean {
  if (game.cover_custom || isSteamVerticalCover(game.cover_url)) return false
  const missedAt = misses[String(game.steam_appid)]
  return !(missedAt && Date.now() - missedAt < RETRY_MS)
}

/** Troca a capa de um jogo pela arte vertical da Steam, se ela existir. */
export async function ensureSteamCover(game: CoverGame, fetchImpl: typeof fetch = fetch): Promise<boolean> {
  const misses = readMisses()
  if (!needsCover(game, misses)) return false
  const art = (await fetchSteamArt([game.steam_appid], fetchImpl)).get(game.steam_appid)
  const changed = await applyCover(game, art, misses, fetchImpl)
  setCfg(MISSES_KEY, JSON.stringify(misses))
  return changed
}

let running: Promise<number> | null = null

/** Passa por todos os jogos ligados à Steam com capa de outra fonte. */
export function refreshSteamCovers(limit = 150, fetchImpl: typeof fetch = fetch): Promise<number> {
  if (running) return running
  running = (async () => {
    const misses = readMisses()
    const games = (db.prepare(`
      SELECT id, steam_appid, cover_url, cover_custom FROM media_items
       WHERE type = 'game' AND steam_appid IS NOT NULL AND COALESCE(cover_custom, 0) = 0
    `).all() as CoverGame[])
      .filter(g => needsCover(g, misses))
      .slice(0, limit)
    if (games.length === 0) return 0

    const art = await fetchSteamArt(games.map(g => g.steam_appid), fetchImpl)
    let changed = 0
    const queue = [...games]
    await Promise.all(Array.from({ length: 6 }, async () => {
      for (let game = queue.shift(); game; game = queue.shift()) {
        if (await applyCover(game, art.get(game.steam_appid), misses, fetchImpl)) changed++
      }
    }))
    setCfg(MISSES_KEY, JSON.stringify(misses))
    return changed
  })().finally(() => { running = null })
  return running
}

export async function stopSteamCovers(): Promise<void> {
  await running?.catch(() => {})
}
