import { useState } from 'react'
import { ShareItemDialog } from './ShareItemDialog'

/** Botão "Enviar para um amigo" das páginas de mídia e de jogo. */
export function ShareItemButton({ mediaItemId, title }: { mediaItemId: number; title: string }) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
        className="inline-flex items-center gap-2 px-3 py-2 rounded-lg border border-border text-sm text-secondary hover:text-primary hover:border-accent">
        <span aria-hidden>✉️</span> Enviar para um amigo
      </button>
      <ShareItemDialog mediaItemId={mediaItemId} title={title} open={open} onClose={() => setOpen(false)} />
    </>
  )
}
