import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { imageUrl } from '../lib/images'
import type { CoverOption, MediaItem } from '../types'

interface Props {
  open:    boolean
  mediaId: number | null
  title:   string
  onClose: () => void
}

const SOURCE_LABEL: Record<CoverOption['source'], string | null> = {
  default: 'Padrão',
  current: 'Enviada',
  tmdb:    null,
  rawg:    null,
  steam:   'Steam',
}

/**
 * Escolhe a arte de capa de um item. A capa é da mídia, não do registro: a
 * troca aparece no diário, na biblioteca e no Story de uma vez.
 */
export function CoverPickerModal({ open, mediaId, title, onClose }: Props) {
  const qc = useQueryClient()
  const fileRef = useRef<HTMLInputElement>(null)
  const [broken, setBroken] = useState<Set<string>>(new Set())

  const { data, isLoading, isError } = useQuery({
    queryKey: ['media-covers', mediaId],
    queryFn: () => api.media.covers(mediaId!),
    enabled: open && mediaId != null,
    staleTime: 5 * 60_000,
  })

  useEffect(() => { if (open) setBroken(new Set()) }, [open, mediaId])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  // A capa aparece em quase toda tela (biblioteca, diário, listas, Wrap, home):
  // mais simples e seguro revalidar tudo do que caçar cada chave.
  const done = (_item: MediaItem) => {
    qc.invalidateQueries()
    onClose()
  }

  const choose = useMutation({ mutationFn: (url: string) => api.media.setCover(mediaId!, url), onSuccess: done })
  const send   = useMutation({ mutationFn: (file: File) => api.media.uploadCover(mediaId!, file), onSuccess: done })
  const reset  = useMutation({ mutationFn: () => api.media.resetCover(mediaId!), onSuccess: done })

  if (!open || mediaId == null) return null

  const busy = choose.isPending || send.isPending || reset.isPending
  const error = choose.error ?? send.error ?? reset.error
  const options = (data?.options ?? []).filter(o => !broken.has(o.url))

  return (
    <div className="fixed inset-0 z-[300] flex items-start justify-center pt-12 pb-8 px-4 overflow-y-auto">
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Arte da capa de ${title}`}
        className="relative w-full max-w-2xl bg-surface border border-border rounded-2xl shadow-2xl animate-scale-in p-6"
      >
        <div className="flex items-start justify-between mb-1">
          <div className="min-w-0">
            <p className="text-xs text-muted uppercase tracking-wide mb-1">Arte da capa</p>
            <h2 className="text-lg font-bold text-primary truncate max-w-md">{title}</h2>
          </div>
          <button onClick={onClose} aria-label="Fechar" className="text-muted hover:text-primary text-xl leading-none">×</button>
        </div>
        <p className="text-sm text-muted mb-5">
          A arte escolhida vale para o diário, a biblioteca e o Story.
        </p>

        <div className="flex flex-wrap gap-2 mb-5">
          <button
            onClick={() => fileRef.current?.click()}
            disabled={busy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-bg hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {send.isPending ? 'Enviando…' : 'Enviar imagem'}
          </button>
          {data?.custom && (
            <button
              onClick={() => reset.mutate()}
              disabled={busy}
              className="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:text-primary border border-border hover:border-border-strong transition-colors disabled:opacity-60"
            >
              {reset.isPending ? 'Restaurando…' : 'Restaurar capa padrão'}
            </button>
          )}
          <input
            ref={fileRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif,image/avif"
            className="hidden"
            onChange={e => {
              const file = e.target.files?.[0]
              e.target.value = ''
              if (file) send.mutate(file)
            }}
          />
        </div>

        {error && <p role="alert" className="text-sm mb-4" style={{ color: 'var(--movies)' }}>{(error as Error).message}</p>}

        {isLoading ? (
          <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="aspect-[2/3] rounded-lg bg-card animate-pulse" />
            ))}
          </div>
        ) : isError ? (
          <p className="text-sm text-muted">Não foi possível carregar as artes. Você ainda pode enviar uma imagem.</p>
        ) : (
          <>
            {data?.notice && <p className="text-sm text-muted mb-4">{data.notice}</p>}
            {options.length > 0 && (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3 max-h-[60vh] overflow-y-auto pr-1">
                {options.map(option => {
                  const selected = option.url === data?.current
                  const label = SOURCE_LABEL[option.source]
                  return (
                    <button
                      key={option.url}
                      onClick={() => { if (!selected) choose.mutate(option.url) }}
                      disabled={busy}
                      aria-pressed={selected}
                      aria-label={selected ? 'Arte atual' : `Usar esta arte${label ? ` (${label})` : ''}`}
                      className={`relative aspect-[2/3] rounded-lg overflow-hidden border-2 bg-card transition-colors disabled:opacity-60 ${
                        selected ? 'border-accent' : 'border-transparent hover:border-border-strong'
                      }`}
                    >
                      <img
                        src={imageUrl(option.url, 320)!}
                        alt=""
                        loading="lazy"
                        className="w-full h-full object-cover"
                        onError={() => setBroken(prev => new Set(prev).add(option.url))}
                      />
                      {(label || selected) && (
                        <span className="absolute left-1.5 top-1.5 text-[10px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded bg-black/70 text-white">
                          {selected ? 'Atual' : label}
                        </span>
                      )}
                    </button>
                  )
                })}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
