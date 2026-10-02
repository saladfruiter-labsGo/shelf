/**
 * Relançamentos da Steam: quando uma editora republica um jogo num AppID novo
 * (a SEGA fez isso com Yakuza Kiwami), o antigo passa a se chamar
 * "<nome> (Legacy)" e quem tinha o antigo ganha o novo — a conta passa a ter
 * os dois. Para o Shelf é um jogo só: os dois AppIDs viram um card, com o
 * tempo de jogo somado.
 *
 * Só junta quando a Steam marca explicitamente "(Legacy)". Nomes apenas
 * parecidos ou iguais ("Dead Space" de 2008 e o remake de 2023) continuam
 * separados.
 */
import { db } from '../db.js'
import { cfg, setCfg } from '../integrations/config.js'
import { normalizeTitle } from '../prices/matcher.js'
import type { OwnedGameInput } from './library-plan.js'

const LEGACY = /\s*\(legacy\)\s*$/i

/** "Yakuza Kiwami (Legacy)" → "Yakuza Kiwami"; sem a marca, null. */
export function legacyBaseName(name: string): string | null {
  return LEGACY.test(name) ? name.replace(LEGACY, '').trim() || null : null
}

export interface OwnedGroup<T extends OwnedGameInput> {
  /** O jogo como o Shelf o enxerga: AppID principal, nome atual e tempo somado. */
  game: T
  /** Todos os AppIDs do grupo, o principal primeiro. */
  appids: number[]
  /** Tempo (s) de cada AppID, para o estado da leitura. */
  seconds: Record<number, number>
}

const latest = (a: string | null, b: string | null) =>
  !a ? b : !b ? a : Date.parse(a) >= Date.parse(b) ? a : b

/**
 * Agrupa cada "X (Legacy)" com o "X" da mesma conta. O AppID principal é o
 * de mais tempo jogado (onde estão as conquistas do usuário); empate fica com
 * o relançamento.
 */
export function groupLegacyRelistings<T extends OwnedGameInput>(owned: T[]): OwnedGroup<T>[] {
  const current = new Map<string, T[]>()
  for (const game of owned) {
    if (legacyBaseName(game.name)) continue
    const key = normalizeTitle(game.name)
    current.set(key, [...(current.get(key) ?? []), game])
  }

  const absorbed = new Set<number>()
  const partners = new Map<number, T>()
  for (const game of owned) {
    const base = legacyBaseName(game.name)
    if (!base) continue
    const matches = current.get(normalizeTitle(base)) ?? []
    // Só com um par inequívoco.
    if (matches.length !== 1 || partners.has(matches[0].appid)) continue
    partners.set(matches[0].appid, game)
    absorbed.add(game.appid)
  }

  const groups: OwnedGroup<T>[] = []
  for (const game of owned) {
    if (absorbed.has(game.appid)) continue
    const legacy = partners.get(game.appid)
    const seconds = (g: T) => Math.max(0, Math.round(g.playtime_minutes * 60))
    if (!legacy) {
      groups.push({ game, appids: [game.appid], seconds: { [game.appid]: seconds(game) } })
      continue
    }
    const primary = legacy.playtime_minutes > game.playtime_minutes ? legacy : game
    const other = primary === game ? legacy : game
    groups.push({
      game: {
        ...primary,
        name: game.name,
        playtime_minutes: game.playtime_minutes + legacy.playtime_minutes,
        last_played_at: latest(game.last_played_at, legacy.last_played_at),
      },
      appids: [primary.appid, other.appid],
      seconds: { [game.appid]: seconds(game), [legacy.appid]: seconds(legacy) },
    })
  }
  return groups
}

/* ─────────────────────────── Fusão de cards repetidos ─────────────────────── */

interface CardRow { id: number; external_id: string }

/**
 * Card que fica numa fusão: o que não foi criado pela leitura da Steam (tem o
 * histórico do Playnite, a nota, as listas); entre iguais, o mais antigo.
 */
export function pickKeeper<T extends CardRow>(cards: T[]): T {
  return [...cards].sort((a, b) =>
    Number(a.external_id.startsWith('steam:')) - Number(b.external_id.startsWith('steam:')) || a.id - b.id)[0]
}

/**
 * Junta `duplicateId` em `keeperId` e apaga o repetido: diário, progresso,
 * listas, preços e atividade passam para o card que fica; campo vazio do que
 * fica é preenchido pelo repetido. Precisa rodar dentro de uma transação.
 */
export function mergeGameCards(keeperId: number, duplicateId: number): void {
  if (keeperId === duplicateId) return
  const keeper = db.prepare('SELECT external_id FROM media_items WHERE id = ?').get(keeperId) as { external_id: string } | undefined
  const dup = db.prepare('SELECT external_id FROM media_items WHERE id = ?').get(duplicateId) as { external_id: string } | undefined
  if (!keeper || !dup) return

  for (const table of ['diary_entries', 'diary_progress', 'list_items', 'game_price_products']) {
    // OR IGNORE: o que colide com uma linha do card que fica é apagado junto com o repetido.
    db.prepare(`UPDATE OR IGNORE ${table} SET media_item_id = ? WHERE media_item_id = ?`).run(keeperId, duplicateId)
  }
  db.prepare("UPDATE OR IGNORE activity_events SET external_ref = ? WHERE media_type = 'game' AND external_ref = ?")
    .run(keeper.external_id, dup.external_id)

  db.prepare(`
    UPDATE media_items AS k SET
      cover_url            = COALESCE(k.cover_url, d.cover_url),
      year                 = COALESCE(k.year, d.year),
      genre                = COALESCE(k.genre, d.genre),
      synopsis             = COALESCE(k.synopsis, d.synopsis),
      creators             = COALESCE(k.creators, d.creators),
      publisher            = COALESCE(k.publisher, d.publisher),
      notes                = COALESCE(k.notes, d.notes),
      completed_at         = COALESCE(k.completed_at, d.completed_at),
      rating               = CASE WHEN COALESCE(k.rating, 0) > 0 THEN k.rating ELSE d.rating END,
      favorite             = MAX(COALESCE(k.favorite, 0), COALESCE(d.favorite, 0)),
      added_at             = MIN(k.added_at, d.added_at),
      updated_at           = datetime('now')
    FROM (SELECT * FROM media_items WHERE id = ?) AS d
    WHERE k.id = ?
  `).run(duplicateId, keeperId)
  db.prepare('DELETE FROM media_items WHERE id = ?').run(duplicateId)

  // O Playnite lembra o card de cada jogo pelo external_id: aponta para o que ficou,
  // senão o próximo webhook recriaria o repetido.
  try {
    const state = JSON.parse(cfg('PLAYNITE_STATE') || '{}') as Record<string, { externalId?: string }>
    let changed = false
    for (const entry of Object.values(state)) {
      if (entry?.externalId === dup.external_id) { entry.externalId = keeper.external_id; changed = true }
    }
    if (changed) setCfg('PLAYNITE_STATE', JSON.stringify(state))
  } catch {
    // Estado ilegível: o Playnite já o trata como vazio.
  }
}
