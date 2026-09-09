import { useCallback, useEffect, useRef, useState } from 'react'

/**
 * Arraste de capas por pointer events — um só caminho para mouse, caneta e
 * toque (o HTML5 drag-and-drop nativo não existe em touch).
 *
 * Quem desenha marca as áreas com `data-drop-zone="<chave>"` e cada capa com
 * `data-drag-id="<id>"`; o hook devolve a zona e o índice de inserção sob o
 * ponteiro, já descontando a capa arrastada.
 */

export interface DragPayload {
  id:    number
  title: string
  cover: string | null
}

export interface DropTarget {
  zone:  string
  /** Índice de inserção entre os itens que ficam (a capa arrastada é ignorada). */
  index: number
}

interface DragState extends DragPayload {
  x: number
  y: number
  w: number
  h: number
  dx: number
  dy: number
}

/** Distância mínima antes de virar arraste — abaixo disso ainda é um clique. */
const THRESHOLD = 6
/** Faixa nas bordas da janela que rola a página sozinha durante o arraste. */
const EDGE = 90
const EDGE_SPEED = 14

function findTarget(x: number, y: number, draggingId: number): DropTarget | null {
  const el = document.elementFromPoint(x, y)
  const zoneEl = (el as HTMLElement | null)?.closest<HTMLElement>('[data-drop-zone]')
  if (!zoneEl) return null

  const tiles = Array.from(zoneEl.querySelectorAll<HTMLElement>('[data-drag-id]'))
    .filter(t => t.dataset.dragId !== String(draggingId))

  // `data-drop-axis="y"` = fila vertical (visão em linhas); o padrão é grade.
  const vertical = zoneEl.dataset.dropAxis === 'y'
  let index = tiles.length
  for (let i = 0; i < tiles.length; i++) {
    const r = tiles[i].getBoundingClientRect()
    // Grade que quebra linha: entra antes da primeira capa cuja metade
    // esquerda já passou do ponteiro, dentro da mesma faixa vertical.
    const before = vertical
      ? y < r.top + r.height / 2
      : y < r.bottom && x < r.left + r.width / 2
    if (before) { index = i; break }
  }
  return { zone: zoneEl.dataset.dropZone!, index }
}

export function usePosterDrag(onDrop: (id: number, target: DropTarget) => void) {
  const [drag, setDrag] = useState<DragState | null>(null)
  const [over, setOver] = useState<DropTarget | null>(null)

  const pending = useRef<{ payload: DragPayload; x: number; y: number; rect: DOMRect } | null>(null)
  const state   = useRef<{ drag: DragState | null; over: DropTarget | null }>({ drag: null, over: null })
  const edge    = useRef(0)
  const raf     = useRef(0)
  const endedAt = useRef(0)

  state.current.drag = drag
  state.current.over = over

  const stopAutoScroll = useCallback(() => {
    if (raf.current) cancelAnimationFrame(raf.current)
    raf.current = 0
    edge.current = 0
  }, [])

  const finish = useCallback(() => {
    pending.current = null
    stopAutoScroll()
    if (state.current.drag) endedAt.current = Date.now()
    setDrag(null)
    setOver(null)
  }, [stopAutoScroll])

  /** O `click` do navegador ainda dispara depois de soltar — isto o ignora. */
  const justDragged = useCallback(() => Date.now() - endedAt.current < 250, [])

  useEffect(() => {
    if (!drag) return
    document.body.style.userSelect = 'none'
    const move = (e: PointerEvent) => {
      e.preventDefault()
      setDrag(d => (d ? { ...d, x: e.clientX, y: e.clientY } : d))
      setOver(findTarget(e.clientX, e.clientY, drag.id))

      const top = e.clientY < EDGE, bottom = e.clientY > window.innerHeight - EDGE
      edge.current = top ? -EDGE_SPEED : bottom ? EDGE_SPEED : 0
      if (edge.current && !raf.current) {
        const tick = () => {
          if (!edge.current) { raf.current = 0; return }
          window.scrollBy(0, edge.current)
          raf.current = requestAnimationFrame(tick)
        }
        raf.current = requestAnimationFrame(tick)
      }
    }
    const up = () => {
      const target = state.current.over
      if (target) onDrop(drag.id, target)
      finish()
    }
    const cancel = (e: KeyboardEvent) => { if (e.key === 'Escape') finish() }

    window.addEventListener('pointermove', move, { passive: false })
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', finish)
    window.addEventListener('keydown', cancel)
    return () => {
      document.body.style.userSelect = ''
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', finish)
      window.removeEventListener('keydown', cancel)
    }
  }, [drag?.id, onDrop, finish])

  /* Antes do limiar: só observa o ponteiro para decidir se é clique ou arraste. */
  useEffect(() => {
    const move = (e: PointerEvent) => {
      const p = pending.current
      if (!p) return
      if (Math.abs(e.clientX - p.x) < THRESHOLD && Math.abs(e.clientY - p.y) < THRESHOLD) return
      setDrag({
        ...p.payload,
        x: e.clientX, y: e.clientY,
        w: p.rect.width, h: p.rect.height,
        dx: p.x - p.rect.left, dy: p.y - p.rect.top,
      })
      pending.current = null
    }
    const up = () => { pending.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    return () => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
  }, [])

  const start = useCallback((e: React.PointerEvent, payload: DragPayload) => {
    if (e.button !== 0 && e.pointerType === 'mouse') return
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    pending.current = { payload, x: e.clientX, y: e.clientY, rect }
  }, [])

  return { drag, over, start, justDragged, dragging: drag !== null }
}
