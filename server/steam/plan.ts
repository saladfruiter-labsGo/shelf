/**
 * Diferença entre a wishlist da Steam e o backlog do Shelf.
 *
 * Separado do resto para ser puro e testável: decidir o que entra, o que sai e
 * para que lado é a parte perigosa do conector bidirecional (uma decisão errada
 * apaga algo em um dos dois lados).
 *
 * A regra central é o conjunto `known`: os AppIDs que a sincronização anterior
 * viu nos DOIS lados. Um item que sumiu de um lado E estava em `known` foi
 * removido de propósito — só nesse caso a remoção se propaga. Um item que
 * aparece só de um lado sem histórico é novidade, e é copiado para o outro.
 */

export interface SteamSyncOptions {
  /** Steam → Shelf: wishlist da Steam vira backlog. */
  pull: boolean
  /** Shelf → Steam: backlog vira wishlist da Steam. */
  push: boolean
  /** Propaga remoções (item retirado de um lado sai do outro). */
  removals: boolean
}

export interface SteamSyncPlan {
  /** Entram no backlog do Shelf. */
  toShelf: number[]
  /** Entram na wishlist da Steam. */
  toSteam: number[]
  /** Saem do backlog do Shelf (foram removidos na Steam). */
  removeFromShelf: number[]
  /** Saem da wishlist da Steam (foram removidos no Shelf). */
  removeFromSteam: number[]
}

export function planWishlistSync(
  steamAppIds: Iterable<number>,
  shelfAppIds: Iterable<number>,
  knownAppIds: Iterable<number>,
  opts: SteamSyncOptions,
): SteamSyncPlan {
  const steam = new Set(steamAppIds)
  const shelf = new Set(shelfAppIds)
  const known = new Set(knownAppIds)

  const plan: SteamSyncPlan = { toShelf: [], toSteam: [], removeFromShelf: [], removeFromSteam: [] }

  for (const appid of new Set([...steam, ...shelf])) {
    const onSteam = steam.has(appid)
    const onShelf = shelf.has(appid)
    if (onSteam && onShelf) continue

    if (onSteam) {
      // Sumiu do Shelf. Se já tinha sido sincronizado, foi remoção deliberada.
      if (known.has(appid)) { if (opts.removals) plan.removeFromSteam.push(appid) }
      else if (opts.pull) plan.toShelf.push(appid)
    } else {
      if (known.has(appid)) { if (opts.removals) plan.removeFromShelf.push(appid) }
      else if (opts.push) plan.toSteam.push(appid)
    }
  }

  return plan
}

/** AppIDs que ficam nos dois lados depois de aplicar o plano — o novo `known`. */
export function nextKnown(
  steamAppIds: Iterable<number>,
  shelfAppIds: Iterable<number>,
  plan: SteamSyncPlan,
): number[] {
  const result = new Set<number>()
  const steam = new Set(steamAppIds)
  const shelf = new Set(shelfAppIds)
  for (const id of plan.toShelf) shelf.add(id)
  for (const id of plan.toSteam) steam.add(id)
  for (const id of plan.removeFromShelf) shelf.delete(id)
  for (const id of plan.removeFromSteam) steam.delete(id)
  for (const id of steam) if (shelf.has(id)) result.add(id)
  return [...result]
}
