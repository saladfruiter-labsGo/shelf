import { useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react'
import type { ListTier, MediaItem } from '../types'
import type { DropTarget } from '../hooks/usePosterDrag'
import { TIER_COLORS, tierVar } from '../lib/lists'
import { ListPosterTile } from './ListPosterTile'

interface Props {
  tiers:  ListTier[]
  /** Capas por tier; a chave `'none'` é a bandeja de quem ainda não tem tier. */
  byTier: Map<number | 'none', MediaItem[]>
  over:      DropTarget | null
  draggable: boolean
  dimSeen:   boolean
  isConsumed: (item: MediaItem) => boolean
  onOpen:      (item: MediaItem) => void
  onRemove:    (item: MediaItem) => void
  onDragStart: (e: ReactPointerEvent, item: MediaItem) => void
  onAddTier:    () => void
  onRenameTier: (tier: ListTier, name: string) => void
  onColorTier:  (tier: ListTier, color: string) => void
  onMoveTier:   (tier: ListTier, direction: -1 | 1) => void
  onDeleteTier: (tier: ListTier) => void
  onAddToTier:  (tierId: number | null) => void
}

function caretFor(over: DropTarget | null, zone: string, index: number, total: number): 'before' | 'after' | null {
  if (!over || over.zone !== zone) return null
  if (over.index === index) return 'before'
  if (over.index >= total && index === total - 1) return 'after'
  return null
}

export function ListTierBoard({
  tiers, byTier, over, draggable, dimSeen, isConsumed,
  onOpen, onRemove, onDragStart,
  onAddTier, onRenameTier, onColorTier, onMoveTier, onDeleteTier, onAddToTier,
}: Props) {
  const [editing, setEditing] = useState<number | null>(null)
  const [colorFor, setColorFor] = useState<number | null>(null)

  const renderTiles = (items: MediaItem[], zone: string) =>
    items.map((item, i) => (
      <ListPosterTile
        key={item.id}
        item={item}
        dimmed={dimSeen && isConsumed(item)}
        draggable={draggable}
        showTitle={false}
        caret={caretFor(over, zone, i, items.length)}
        onOpen={() => onOpen(item)}
        onRemove={() => onRemove(item)}
        onDragStart={e => onDragStart(e, item)}
      />
    ))

  const tray = byTier.get('none') ?? []

  return (
    <div className="tier-board">
      {tiers.map((tier, idx) => {
        const items = byTier.get(tier.id) ?? []
        const zone  = `tier:${tier.id}`
        const isOver = over?.zone === zone

        return (
          <div key={tier.id} className="tier-row" style={{ '--tier': tierVar(tier.color) } as CSSProperties}>
            <div className="tier-label">
              {editing === tier.id ? (
                <input
                  className="tier-name-input"
                  defaultValue={tier.name}
                  autoFocus
                  maxLength={24}
                  onBlur={e => { onRenameTier(tier, e.target.value); setEditing(null) }}
                  onKeyDown={e => {
                    if (e.key === 'Enter')  (e.target as HTMLInputElement).blur()
                    if (e.key === 'Escape') setEditing(null)
                  }}
                  aria-label={`Nome do tier ${tier.name}`}
                />
              ) : (
                <span className="tier-label-name">{tier.name}</span>
              )}

              {colorFor === tier.id ? (
                <div className="tier-colors">
                  {TIER_COLORS.map(c => (
                    <button
                      key={c.key}
                      type="button"
                      className={`tier-color${c.key === tier.color ? ' is-active' : ''}`}
                      style={{ background: tierVar(c.key) }}
                      title={c.label}
                      aria-label={`Cor ${c.label}`}
                      onClick={() => { onColorTier(tier, c.key); setColorFor(null) }}
                    />
                  ))}
                </div>
              ) : (
                <div className="tier-tools">
                  <button type="button" className="tier-tool" title="Adicionar mídia neste tier"
                    onClick={() => onAddToTier(tier.id)} aria-label={`Adicionar mídia no tier ${tier.name}`}>+</button>
                  <button type="button" className="tier-tool" title="Renomear"
                    onClick={() => setEditing(tier.id)} aria-label={`Renomear tier ${tier.name}`}>✎</button>
                  <button type="button" className="tier-tool" title="Cor"
                    onClick={() => setColorFor(tier.id)} aria-label={`Cor do tier ${tier.name}`}>◍</button>
                  <button type="button" className="tier-tool" title="Subir" disabled={idx === 0}
                    onClick={() => onMoveTier(tier, -1)} aria-label={`Subir tier ${tier.name}`}>↑</button>
                  <button type="button" className="tier-tool" title="Descer" disabled={idx === tiers.length - 1}
                    onClick={() => onMoveTier(tier, 1)} aria-label={`Descer tier ${tier.name}`}>↓</button>
                  <button type="button" className="tier-tool" title="Excluir tier"
                    onClick={() => onDeleteTier(tier)} aria-label={`Excluir tier ${tier.name}`}>×</button>
                </div>
              )}
            </div>

            <div className={`tier-drop${isOver ? ' is-over' : ''}`} data-drop-zone={zone}>
              {items.length === 0
                ? <span className="tier-empty">Arraste capas para cá</span>
                : renderTiles(items, zone)}
            </div>
          </div>
        )
      })}

      <button
        type="button"
        onClick={onAddTier}
        style={{
          alignSelf: 'start', padding: '8px 16px', borderRadius: 999,
          border: '1px dashed var(--border-strong)', background: 'none',
          color: 'var(--text-muted)', font: 'inherit', fontSize: 13, cursor: 'pointer',
        }}
        className="hover-surface"
      >
        + Novo tier
      </button>

      <div className="tier-tray">
        <p className="tier-tray-head">Sem tier · {tray.length}</p>
        <div
          className={`tier-drop${over?.zone === 'tier:none' ? ' is-over' : ''}`}
          data-drop-zone="tier:none"
          style={{ minHeight: 96, padding: 0 }}
        >
          {tray.length === 0
            ? <span className="tier-empty">Tudo classificado.</span>
            : renderTiles(tray, 'tier:none')}
        </div>
      </div>
    </div>
  )
}
