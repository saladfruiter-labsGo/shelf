import type { ListMode, ListTier, MediaItem } from '../types'
import type { DropTarget } from '../hooks/usePosterDrag'

export const MODE_LABEL: Record<ListMode, string> = {
  list:    'Lista',
  ranking: 'Ranking',
  tier:    'Tierlist',
}

export const MODES: ListMode[] = ['list', 'ranking', 'tier']

/** Cores de tier — chaves de token, para o tema claro e o escuro valerem juntos. */
export const TIER_COLORS: { key: string; label: string }[] = [
  { key: 'movies', label: 'Vermelho' },
  { key: 'books',  label: 'Laranja'  },
  { key: 'gold',   label: 'Amarelo'  },
  { key: 'games',  label: 'Verde'    },
  { key: 'series', label: 'Azul'     },
  { key: 'music',  label: 'Roxo'     },
  { key: 'accent', label: 'Destaque' },
]

export function tierVar(color: string): string {
  const known = TIER_COLORS.some(c => c.key === color)
  return `var(--${known ? color : 'accent'})`
}

/** Chave da área onde uma capa pode cair. Só a tierlist tem mais de uma. */
export function zoneOf(item: MediaItem, mode: ListMode): string {
  return mode === 'tier' ? `tier:${item.tier_id ?? 'none'}` : 'main'
}

/** `tier:12` → 12; `tier:none` → null. */
export function tierOfZone(zone: string): number | null {
  const raw = zone.slice('tier:'.length)
  return raw === 'none' ? null : Number(raw)
}

/**
 * Nova ordem completa da lista depois de soltar uma capa.
 *
 * A posição gravada é global (uma sequência só), então a ordem final é a
 * concatenação das zonas na ordem em que elas aparecem na tela — assim o que
 * o servidor guarda é exatamente o que se vê.
 */
export function reorderItems(
  items: MediaItem[],
  tiers: ListTier[],
  mode: ListMode,
  dragId: number,
  target: DropTarget,
): MediaItem[] {
  const dragged = items.find(i => i.id === dragId)
  if (!dragged) return items

  const moved: MediaItem = mode === 'tier'
    ? { ...dragged, tier_id: tierOfZone(target.zone) }
    : dragged

  const zones = new Map<string, MediaItem[]>()
  for (const it of items) {
    if (it.id === dragId) continue
    const key = zoneOf(it, mode)
    const bucket = zones.get(key)
    if (bucket) bucket.push(it)
    else zones.set(key, [it])
  }

  const dest = zones.get(target.zone) ?? []
  dest.splice(Math.min(target.index, dest.length), 0, moved)
  zones.set(target.zone, dest)

  const order = mode === 'tier'
    ? [...tiers.map(t => `tier:${t.id}`), 'tier:none']
    : ['main']

  return order.flatMap(key => zones.get(key) ?? [])
}

/** Payload da rota de reordenação. */
export function orderPayload(items: MediaItem[]) {
  return items.map(i => ({ media_item_id: i.id, tier_id: i.tier_id ?? null }))
}

/** "Já consumi" — o que conta para o interruptor de esmaecer e para o progresso. */
export function isConsumed(item: MediaItem): boolean {
  return item.status === 'completed'
}
