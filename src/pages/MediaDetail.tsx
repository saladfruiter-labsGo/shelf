import { useParams, useNavigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useEffect } from 'react'
import { api } from '../lib/api'
import { CategoryTag } from '../components/CategoryTag'
import { StarRating } from '../components/StarRating'
import type { MediaItem, MediaStatus, MediaType } from '../types'
import { STATUS_LABEL, formatRuntime, formatDate } from '../lib/utils'

const STATUSES: MediaStatus[] = ['wishlist', 'in_progress', 'completed', 'dropped']

const TYPE_HEX: Record<MediaType, string> = {
  movie:  '#D94444',
  series: '#8A5FE8',
  game:   '#20C97A',
  book:   '#C47A0A',
}

// ─── Story generator ────────────────────────────────────────────────
async function generateItemStory(item: MediaItem): Promise<void> {
  const canvas = document.createElement('canvas')
  canvas.width  = 1080
  canvas.height = 1920
  const ctx = canvas.getContext('2d')!

  const typeColor = TYPE_HEX[item.type]

  // Background
  const grad = ctx.createLinearGradient(0, 0, 1080, 1920)
  grad.addColorStop(0, '#0C1118')
  grad.addColorStop(0.6, '#141C28')
  grad.addColorStop(1, '#0C1118')
  ctx.fillStyle = grad
  ctx.fillRect(0, 0, 1080, 1920)

  // Decorative glow
  ctx.save()
  ctx.globalAlpha = 0.18
  ctx.fillStyle = typeColor
  ctx.beginPath()
  ctx.arc(540, 700, 600, 0, Math.PI * 2)
  ctx.fill()
  ctx.restore()

  // Cover image
  if (item.cover_url) {
    try {
      const img = await new Promise<HTMLImageElement>((res, rej) => {
        const i = new Image()
        i.crossOrigin = 'anonymous'
        i.onload = () => res(i)
        i.onerror = rej
        i.src = item.cover_url!
      })
      const cw = 480, ch = 720
      const cx = (1080 - cw) / 2, cy = 220
      ctx.save()
      ctx.shadowColor = typeColor
      ctx.shadowBlur  = 60
      ctx.drawImage(img, cx, cy, cw, ch)
      ctx.restore()
    } catch {}
  }

  // Type pill
  ctx.fillStyle = typeColor
  ctx.globalAlpha = 0.9
  const pillW = 180, pillH = 48
  ctx.beginPath()
  ctx.roundRect((1080 - pillW) / 2, 980, pillW, pillH, 24)
  ctx.fill()
  ctx.globalAlpha = 1
  ctx.fillStyle = '#0C1118'
  ctx.font = 'bold 26px sans-serif'
  ctx.textAlign = 'center'
  const typeLabel: Record<MediaType, string> = { movie: 'FILME', series: 'SÉRIE', game: 'JOGO', book: 'LIVRO' }
  ctx.fillText(typeLabel[item.type], 540, 1012)

  // Title
  ctx.fillStyle = '#EDF2F8'
  ctx.font = 'bold 72px serif'
  ctx.textAlign = 'center'
  const words = item.title.split(' ')
  let line = '', y = 1100
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > 900 && line) {
      ctx.fillText(line, 540, y); y += 82; line = word
    } else { line = test }
  }
  ctx.fillText(line, 540, y)

  // Subtitle (author/year)
  y += 56
  ctx.fillStyle = '#94A8C0'
  ctx.font = '36px sans-serif'
  const sub = [item.author, item.year ? String(item.year) : null].filter(Boolean).join(' · ')
  if (sub) ctx.fillText(sub, 540, y)

  // Rating stars — sempre visível
  y += 64
  const filled = Math.min(5, Math.max(0, Math.round(item.rating)))
  ctx.fillStyle = '#E8A030'
  ctx.font = '52px sans-serif'
  ctx.fillText('★'.repeat(filled) + '☆'.repeat(5 - filled), 540, y)

  // Shelf branding
  ctx.fillStyle = '#E8A030'
  ctx.font = 'bold 40px serif'
  ctx.textAlign = 'center'
  ctx.fillText('Shelf', 540, 1820)
  ctx.fillStyle = '#3A4E68'
  ctx.font = '24px sans-serif'
  ctx.fillText('sua coleção pessoal', 540, 1858)

  canvas.toBlob(blob => {
    if (!blob) return
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `shelf-story-${item.title.slice(0, 30).replace(/\s+/g, '-').toLowerCase()}.png`
    a.click()
    URL.revokeObjectURL(a.href)
  }, 'image/png')
}

// ─── Add to list dropdown ───────────────────────────────────────────
function AddToListDropdown({ itemId }: { itemId: number }) {
  const qc = useQueryClient()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const { data: checks = [] } = useQuery({
    queryKey: ['list-check', itemId],
    queryFn: () => api.lists.check(itemId),
    enabled: open,
  })

  const toggleMutation = useMutation({
    mutationFn: ({ listId, contains }: { listId: number; contains: boolean }) =>
      contains ? api.lists.removeItem(listId, itemId) : api.lists.addItem(listId, itemId),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['list-check', itemId] }),
  })

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-lg text-sm text-secondary hover:border-border-strong hover:text-primary transition-colors"
      >
        <span>♡</span> Adicionar à lista
        <span className="text-muted">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-surface border border-border rounded-xl shadow-xl z-20 animate-fade-in overflow-hidden">
          {checks.length === 0 ? (
            <p className="text-center text-muted text-sm py-4 px-3">
              Nenhuma lista criada.<br />
              <a href="/lists" className="text-accent underline text-xs">Criar lista</a>
            </p>
          ) : (
            checks.map(l => (
              <button
                key={l.id}
                onClick={() => toggleMutation.mutate({ listId: l.id, contains: l.contains === 1 })}
                className="w-full flex items-center gap-2 px-3 py-2.5 hover:bg-card transition-colors text-left text-sm"
              >
                <span className={l.contains ? 'text-accent' : 'text-muted'}>
                  {l.contains ? '♥' : '♡'}
                </span>
                <span className={l.contains ? 'text-primary' : 'text-secondary'}>{l.name}</span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────
export function MediaDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: item, isLoading } = useQuery({
    queryKey: ['media', id],
    queryFn: () => api.media.get(parseInt(id!)),
    enabled: !!id,
  })

  const [notes, setNotes] = useState('')
  const [editNotes, setEditNotes] = useState(false)
  const [releaseInput, setReleaseInput] = useState('')
  const [editRelease, setEditRelease] = useState(false)
  const [generatingStory, setGeneratingStory] = useState(false)

  const { data: details, isLoading: loadingDetails } = useQuery({
    queryKey: ['details', item?.type, item?.external_id],
    queryFn: async () => {
      const d = await api.details(item!.type, item!.external_id)
      qc.invalidateQueries({ queryKey: ['media', id] })
      return d
    },
    enabled: !!item && !item.synopsis,
    staleTime: Infinity,
  })

  const synopsis = item?.synopsis ?? details?.synopsis
  const creators = item?.creators ?? details?.creators
  const author   = item?.author   ?? details?.author

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.media.update>[1]) =>
      api.media.update(parseInt(id!), data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', id] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.media.remove(parseInt(id!)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      navigate(-1)
    },
  })

  if (isLoading) return (
    <div className="px-6 py-8 animate-pulse">
      <div className="h-4 bg-card rounded w-20 mb-6" />
      <div className="flex gap-8">
        <div className="w-48 aspect-[2/3] bg-card rounded-lg" />
        <div className="flex-1 space-y-3">
          {[80, 60, 40, 90, 50].map((w, i) => (
            <div key={i} className="h-4 bg-card rounded" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    </div>
  )

  if (!item) return <div className="px-6 py-8 text-muted">Item não encontrado.</div>

  return (
    <div className="px-6 py-8 max-w-3xl">
      <button onClick={() => navigate(-1)} className="text-muted hover:text-primary text-sm mb-6 flex items-center gap-1 transition-colors">
        ← Voltar
      </button>

      <div className="flex gap-6 md:gap-10">
        {/* Cover */}
        <div className="flex-shrink-0 w-40 md:w-52">
          <div className="w-full aspect-[2/3] rounded-lg overflow-hidden bg-card border border-border">
            {item.cover_url
              ? <img src={item.cover_url} alt={item.title} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-muted text-4xl">
                  {item.type === 'movie' ? '🎬' : item.type === 'series' ? '📺' : item.type === 'game' ? '🎮' : '📚'}
                </div>
            }
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <CategoryTag type={item.type} />
          <h1 className="font-display text-2xl md:text-3xl font-bold text-primary mt-2 mb-0.5 leading-tight">
            {item.title}
          </h1>
          <p className="text-muted text-sm mb-3">
            {[item.year, item.genre].filter(Boolean).join(' · ')}
          </p>

          {/* Rating */}
          <div className="mb-4">
            <p className="text-xs text-muted uppercase tracking-wide mb-1">Avaliação</p>
            <StarRating value={item.rating} size="lg" onChange={v => updateMutation.mutate({ rating: v })} />
          </div>

          {/* Status */}
          <div className="mb-4">
            <p className="text-xs text-muted uppercase tracking-wide mb-2">Status</p>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map(s => (
                <button
                  key={s}
                  onClick={() => updateMutation.mutate({ status: s })}
                  className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                    item.status === s ? 'bg-accent text-bg' : 'bg-card text-muted hover:text-primary border border-border'
                  }`}
                >
                  {STATUS_LABEL[s]}
                </button>
              ))}
            </div>
          </div>

          {/* Hype toggle */}
          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={() => updateMutation.mutate({ hype: item.hype ? 0 : 1 })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                item.hype
                  ? 'bg-accent-bg border-accent text-accent'
                  : 'bg-card border-border text-muted hover:text-primary'
              }`}
            >
              🔥 Hype
            </button>

            {/* Release date */}
            {editRelease ? (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={releaseInput}
                  onChange={e => setReleaseInput(e.target.value)}
                  className="bg-card border border-border rounded px-2 py-1 text-xs text-primary outline-none focus:border-accent"
                />
                <button
                  onClick={() => { updateMutation.mutate({ release_date: releaseInput || null as any }); setEditRelease(false) }}
                  className="text-xs text-accent hover:underline"
                >Salvar</button>
                <button onClick={() => setEditRelease(false)} className="text-xs text-muted hover:text-primary">×</button>
              </div>
            ) : (
              <button
                onClick={() => { setReleaseInput(item.release_date ?? ''); setEditRelease(true) }}
                className="text-xs text-muted hover:text-primary transition-colors"
              >
                {item.release_date ? `📅 ${formatDate(item.release_date)}` : '+ Data de lançamento'}
              </button>
            )}
          </div>

          {/* Runtime / author */}
          <div className="flex flex-wrap gap-4 mb-4 text-sm text-muted">
            {item.runtime && <span>⏱ {formatRuntime(item.runtime)}</span>}
            {author       && <span>✍ {author}</span>}
          </div>
        </div>
      </div>

      {/* Synopsis */}
      <div className="mt-6">
        {loadingDetails && !synopsis && (
          <div className="h-4 bg-card rounded w-3/4 animate-pulse mb-2" />
        )}
        {synopsis && (
          <div className="mb-6">
            <p className="text-xs text-muted uppercase tracking-wide mb-2">Sinopse</p>
            <p className="text-sm text-secondary leading-relaxed">{synopsis}</p>
          </div>
        )}

        {creators && (
          <div className="mb-6">
            <p className="text-xs text-muted uppercase tracking-wide mb-1">
              {item.type === 'movie' ? 'Direção' : item.type === 'series' ? 'Criação' : item.type === 'game' ? 'Desenvolvedor' : 'Editora'}
            </p>
            <p className="text-sm text-secondary">{creators}</p>
          </div>
        )}
      </div>

      {/* Notes */}
      <div className="mb-6">
        <p className="text-xs text-muted uppercase tracking-wide mb-2">Notas pessoais</p>
        {editNotes ? (
          <div>
            <textarea
              className="w-full bg-card border border-border rounded-md p-3 text-sm text-primary placeholder:text-muted outline-none focus:border-accent resize-none"
              rows={4}
              value={notes}
              onChange={e => setNotes(e.target.value)}
              placeholder="Suas anotações..."
            />
            <div className="flex gap-2 mt-2">
              <button
                onClick={() => { updateMutation.mutate({ notes }); setEditNotes(false) }}
                className="px-3 py-1.5 bg-accent text-bg rounded text-xs font-medium"
              >Salvar</button>
              <button onClick={() => setEditNotes(false)} className="px-3 py-1.5 bg-card text-muted rounded text-xs">
                Cancelar
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => { setNotes(item.notes ?? ''); setEditNotes(true) }}
            className="text-sm text-muted hover:text-primary transition-colors text-left w-full"
          >
            {item.notes || <span className="italic">Clique para adicionar notas...</span>}
          </button>
        )}
      </div>

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-border">
        <AddToListDropdown itemId={item.id} />

        <button
          onClick={async () => {
            setGeneratingStory(true)
            try { await generateItemStory(item) } finally { setGeneratingStory(false) }
          }}
          disabled={generatingStory}
          className="flex items-center gap-2 px-4 py-2 bg-surface border border-border rounded-lg text-sm text-secondary hover:border-border-strong hover:text-primary transition-colors disabled:opacity-60"
        >
          🎨 {generatingStory ? 'Gerando...' : 'Gerar Story'}
        </button>

        <button
          onClick={() => { if (confirm(`Remover "${item.title}"?`)) deleteMutation.mutate() }}
          className="ml-auto text-xs text-muted hover:text-red-400 transition-colors"
          disabled={deleteMutation.isPending}
        >
          Remover da biblioteca
        </button>
      </div>
    </div>
  )
}
