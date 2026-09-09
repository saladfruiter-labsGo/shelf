/**
 * Correspondência entre um jogo do Shelf e o produto comercial no provedor.
 *
 * É o ponto de maior risco funcional da integração: casar errado mostra o preço
 * de uma DLC, de uma remasterização ou de uma edição Deluxe no lugar do jogo.
 * Por isso a ordem é sempre: Steam AppID → título exato → revisão manual, e
 * qualquer dúvida vira `ambiguous` (que não exibe preço até confirmação).
 */
import { db } from '../db.js'
import { lookupByAppId, lookupByTitle, searchGames, type ItadGame } from './providers/isthereanydeal.js'

const RAWG_HOST = 'api.rawg.io'

/* ───────────────────────────── Comparação de títulos ──────────────────────── */

/** Sem acento, sem caixa, sem pontuação, sem "the/a" inicial, espaços colapsados. */
export function normalizeTitle(s: string): string {
  return s
    .normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .toLowerCase()
    .replace(/[‘’“”]/g, "'")
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9' ]+/g, ' ')
    .replace(/\b(the|a|an)\b/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Marcadores de edição/conteúdo extra. Se um lado tem e o outro não, os
 * produtos são diferentes — é o que separa "Cyberpunk 2077" de
 * "Cyberpunk 2077: Phantom Liberty" ou da "Ultimate Edition".
 */
const EDITION_MARKERS = [
  'deluxe', 'ultimate', 'premium', 'gold', 'complete', 'definitive', 'legendary',
  'collector', 'collectors', 'anniversary', 'enhanced', 'remaster', 'remastered',
  'remake', 'goty', 'game of the year', 'season pass', 'expansion', 'dlc',
  'soundtrack', 'ost', 'artbook', 'bundle', 'pack', 'upgrade', 'demo', 'beta',
  'digital extras', 'starter', 'founder',
] as const

export function editionMarkers(title: string): string[] {
  const t = normalizeTitle(title)
  return EDITION_MARKERS.filter(m => new RegExp(`\\b${m}\\b`).test(t))
}

/** Verdadeiro quando os dois títulos não descrevem a mesma edição. */
export function hasEditionMismatch(a: string, b: string): boolean {
  const ma = new Set(editionMarkers(a))
  const mb = new Set(editionMarkers(b))
  if (ma.size !== mb.size) return true
  for (const m of ma) if (!mb.has(m)) return true
  return false
}

export type Confidence = 'high' | 'low'

/**
 * Confiança do casamento por título: só é alta quando o título normalizado bate
 * exatamente, o produto é um jogo (não DLC/pacote) e as edições coincidem.
 */
export function titleConfidence(wanted: string, candidate: ItadGame): Confidence {
  if (candidate.type && candidate.type !== 'game') return 'low'
  if (hasEditionMismatch(wanted, candidate.title)) return 'low'
  return normalizeTitle(wanted) === normalizeTitle(candidate.title) ? 'high' : 'low'
}

/** Ordena candidatos da busca manual: jogos primeiro, título mais próximo antes. */
export function rankCandidates(wanted: string, candidates: ItadGame[]): ItadGame[] {
  const target = normalizeTitle(wanted)
  const score = (g: ItadGame) => {
    let s = 0
    if (normalizeTitle(g.title) === target) s += 100
    else if (normalizeTitle(g.title).startsWith(target)) s += 40
    else if (normalizeTitle(g.title).includes(target)) s += 20
    if (g.type === 'game') s += 30
    if (!hasEditionMismatch(wanted, g.title)) s += 10
    return s
  }
  return [...candidates].sort((a, b) => score(b) - score(a))
}

/* ─────────────────────────── Steam AppID via RAWG ─────────────────────────── */

/** Extrai o AppID de uma URL da loja Steam. */
export function steamAppIdFromUrl(url: string): number | null {
  const m = /store\.steampowered\.com\/app\/(\d+)/.exec(url)
  return m ? Number(m[1]) : null
}

function rawgKey(): string {
  const row = db.prepare('SELECT value FROM settings WHERE key = ?').get('RAWG_API_KEY') as { value: string } | undefined
  return row?.value?.trim() || process.env.RAWG_API_KEY || ''
}

/**
 * O `external_id` de um jogo no Shelf é o id da RAWG (busca manual e Playnite
 * usam o mesmo caminho). A RAWG expõe os links de loja, de onde sai o AppID.
 */
export async function steamAppIdFromRawg(externalId: string): Promise<number | null> {
  const key = rawgKey()
  if (!key || !/^\d+$/.test(externalId)) return null

  const url = new URL(`https://${RAWG_HOST}/api/games/${externalId}/stores`)
  url.searchParams.set('key', key)
  if (url.hostname !== RAWG_HOST) return null

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10_000)
  try {
    const res = await fetch(url, { signal: ctrl.signal })
    if (!res.ok) return null
    const data = await res.json() as { results?: { url?: string }[] }
    for (const r of data.results ?? []) {
      const appid = r.url ? steamAppIdFromUrl(r.url) : null
      if (appid) return appid
    }
    return null
  } catch {
    return null
  } finally {
    clearTimeout(timer)
  }
}

/* ──────────────────────────── Resolução automática ────────────────────────── */

export interface MatchResult {
  provider_game_id: string | null
  matched_title:    string | null
  match_method:     'steam_id' | 'exact_title' | 'manual' | null
  match_status:     'resolved' | 'ambiguous' | 'not_found'
}

/**
 * Resolve o produto do provedor para um jogo do Shelf.
 * Nunca devolve `resolved` sem confiança alta — na dúvida, `ambiguous`, que a
 * interface trata pedindo confirmação manual.
 */
export async function resolveMatch(item: { title: string; external_id: string }): Promise<MatchResult> {
  // 1. Steam AppID é o identificador mais forte: casa a edição certa.
  const appid = await steamAppIdFromRawg(item.external_id)
  if (appid) {
    const game = await lookupByAppId(appid)
    if (game) {
      return {
        provider_game_id: game.id,
        matched_title:    game.title,
        match_method:     'steam_id',
        match_status:     'resolved',
      }
    }
  }

  // 2. Sem identificador de loja, tenta o título exato.
  const byTitle = await lookupByTitle(item.title)
  if (byTitle) {
    const conf = titleConfidence(item.title, byTitle)
    return {
      provider_game_id: byTitle.id,
      matched_title:    byTitle.title,
      match_method:     'exact_title',
      match_status:     conf === 'high' ? 'resolved' : 'ambiguous',
    }
  }

  // 3. Ainda existe algo parecido? Então é ambíguo, não "não encontrado".
  const candidates = rankCandidates(item.title, await searchGames(item.title, 10))
  if (candidates.length > 0) {
    const best = candidates[0]
    const conf = titleConfidence(item.title, best)
    return {
      provider_game_id: best.id,
      matched_title:    best.title,
      match_method:     'exact_title',
      match_status:     conf === 'high' ? 'resolved' : 'ambiguous',
    }
  }

  return { provider_game_id: null, matched_title: null, match_method: null, match_status: 'not_found' }
}
