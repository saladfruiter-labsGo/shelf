import { useEffect, useRef, useState } from 'react'
import { STORY_TEMPLATES, renderStory, downloadStory, type StoryTemplate, type StorySubject } from '../lib/story'

interface Props {
  open:    boolean
  subject: StorySubject | null
  onClose: () => void
}

/** Modal para escolher um modelo de Story, ver preview e baixar. */
export function StoryModal({ open, subject, onClose }: Props) {
  const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({})
  const [downloading, setDownloading] = useState<StoryTemplate | null>(null)

  // Renderiza os previews sempre que abrir (ou mudar o item)
  useEffect(() => {
    if (!open || !subject) return
    let cancelled = false
    ;(async () => {
      for (const t of STORY_TEMPLATES) {
        const el = canvasRefs.current[t.id]
        if (el && !cancelled) {
          try { await renderStory(t.id, subject, el) } catch { /* ignora */ }
        }
      }
    })()
    return () => { cancelled = true }
  }, [open, subject])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open || !subject) return null

  const handleDownload = async (t: StoryTemplate) => {
    setDownloading(t)
    try { await downloadStory(t, subject) } finally { setDownloading(null) }
  }

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center pt-12 pb-8 px-4 overflow-y-auto">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-2xl bg-surface border border-border rounded-2xl shadow-2xl animate-scale-in p-6">
        <div className="flex items-start justify-between mb-1">
          <div>
            <p className="text-xs text-muted uppercase tracking-wide mb-1">Gerar Story</p>
            <h2 className="text-lg font-bold text-primary truncate max-w-md">{subject.title}</h2>
          </div>
          <button onClick={onClose} className="text-muted hover:text-primary text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-muted mb-5">Escolha um modelo para baixar (1080×1920).</p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {STORY_TEMPLATES.map(t => (
            <button
              key={t.id}
              onClick={() => handleDownload(t.id)}
              disabled={downloading !== null}
              className="group flex flex-col items-stretch text-left rounded-xl border border-border hover:border-accent bg-card overflow-hidden transition-colors disabled:opacity-60"
            >
              <div className="relative aspect-[9/16] bg-black/40">
                <canvas
                  ref={el => { canvasRefs.current[t.id] = el }}
                  className="w-full h-full object-cover"
                  style={{ display: 'block' }}
                />
                <div className="absolute inset-0 flex items-center justify-center bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity">
                  <span className="text-xs font-semibold text-white">
                    {downloading === t.id ? 'Gerando...' : '↓ Baixar'}
                  </span>
                </div>
              </div>
              <div className="px-2.5 py-2">
                <p className="text-xs font-semibold text-primary">{t.label}</p>
                <p className="text-[10px] text-muted leading-tight">{t.desc}</p>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
