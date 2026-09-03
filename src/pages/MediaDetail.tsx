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

const TYPE_LABEL_STORY: Record<MediaType, string> = {
  movie: 'FILME', series: 'SÉRIE', game: 'JOGO', book: 'LIVRO',
}

// ─── Canvas helpers ──────────────────────────────────────────────────
function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = rej
    img.src = url
  })
}

function drawCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  dx: number, dy: number, dw: number, dh: number,
) {
  const scaleX = dw / img.naturalWidth
  const scaleY = dh / img.naturalHeight
  const scale  = Math.max(scaleX, scaleY)
  const sw = dw / scale
  const sh = dh / scale
  const sx = (img.naturalWidth  - sw) / 2
  const sy = (img.naturalHeight - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

function roundedClipPath(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function drawStar5pt(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42
    const angle = (i * Math.PI) / 5 - Math.PI / 2
    const x = cx + Math.cos(angle) * rad
    const y = cy + Math.sin(angle) * rad
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.closePath()
  ctx.fill()
}

function drawRatingStars(ctx: CanvasRenderingContext2D, cx: number, topY: number, rating: number, starSize: number) {
  const gap  = starSize * 0.25
  const total = 5 * starSize + 4 * gap
  let x = cx - total / 2

  for (let i = 1; i <= 5; i++) {
    const scx = x + starSize / 2
    const scy = topY + starSize / 2

    drawStar5pt(ctx, scx, scy, starSize / 2, '#283548')

    if (rating >= i) {
      drawStar5pt(ctx, scx, scy, starSize / 2, '#E8A030')
    } else if (rating >= i - 0.5) {
      ctx.save()
      ctx.beginPath()
      ctx.rect(x, topY, starSize / 2, starSize)
      ctx.clip()
      drawStar5pt(ctx, scx, scy, starSize / 2, '#E8A030')
      ctx.restore()
    }

    x += starSize + gap
  }
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, maxW: number, maxLines: number): string[] {
  const words = text.split(' ')
  const lines: string[] = []
  let line = ''
  for (const word of words) {
    const test = line ? `${line} ${word}` : word
    if (ctx.measureText(test).width > maxW && line) {
      lines.push(line)
      if (lines.length >= maxLines) return lines
      line = word
    } else {
      line = test
    }
  }
  if (line && lines.length < maxLines) lines.push(line)
  return lines
}

// ─── Story generator ────────────────────────────────────────────────
async function generateItemStory(item: MediaItem): Promise<void> {
  const W = 1080, H = 1920
  const canvas = document.createElement('canvas')
  canvas.width  = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  const typeColor = TYPE_HEX[item.type]

  // Background
  ctx.fillStyle = '#0C1118'
  ctx.fillRect(0, 0, W, H)

  // Radial glow behind cover
  const glow = ctx.createRadialGradient(W / 2, 520, 0, W / 2, 520, 720)
  glow.addColorStop(0, typeColor + '35')
  glow.addColorStop(0.6, typeColor + '10')
  glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow
  ctx.fillRect(0, 0, W, H)

  // Cover
  const CW = 460, CH = 690, CX = (W - CW) / 2, CY = 130, CR = 28

  // Shadow layer
  ctx.save()
  ctx.shadowColor = typeColor
  ctx.shadowBlur  = 80
  ctx.shadowOffsetY = 24
  roundedClipPath(ctx, CX, CY, CW, CH, CR)
  ctx.fillStyle = '#1C2838'
  ctx.fill()
  ctx.restore()

  // Image with clip
  if (item.cover_url) {
    try {
      const img = await loadImage(item.cover_url)
      ctx.save()
      roundedClipPath(ctx, CX, CY, CW, CH, CR)
      ctx.clip()
      drawCover(ctx, img, CX, CY, CW, CH)
      ctx.restore()
    } catch {
      // fallback: placeholder already drawn above
    }
  }

  // Type badge
  ctx.font = 'bold 26px system-ui, sans-serif'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const badgeText = TYPE_LABEL_STORY[item.type]
  const badgeW = ctx.measureText(badgeText).width + 52
  const badgeH = 52, badgeX = (W - badgeW) / 2
  const badgeY = CY + CH + 44
  roundedClipPath(ctx, badgeX, badgeY, badgeW, badgeH, 26)
  ctx.fillStyle = typeColor
  ctx.fill()
  ctx.fillStyle = '#0C1118'
  ctx.fillText(badgeText, W / 2, badgeY + badgeH / 2)

  // Title
  let curY = badgeY + badgeH + 50
  const titleLen = item.title.length
  const titleSz  = titleLen > 35 ? 56 : titleLen > 22 ? 66 : 78
  ctx.font = `bold ${titleSz}px Georgia, serif`
  ctx.textBaseline = 'top'
  ctx.fillStyle = '#EDF2F8'
  const titleLines = wrapText(ctx, item.title, 940, 3)
  const lineH = titleSz * 1.18
  for (const l of titleLines) {
    ctx.fillText(l, W / 2, curY)
    curY += lineH
  }

  // Author / year
  curY += 20
  const meta = [
    item.author ?? (item.creators ? item.creators.split(',')[0].trim() : null),
    item.year ? String(item.year) : null,
  ].filter(Boolean).join(' · ')

  if (meta) {
    ctx.font = '34px system-ui, sans-serif'
    ctx.fillStyle = '#5A7090'
    ctx.fillText(meta, W / 2, curY)
    curY += 52
  }

  // Stars
  curY += 20
  drawRatingStars(ctx, W / 2, curY, item.rating, 56)
  curY += 56 + 16

  // Rating label
  ctx.font = '28px system-ui, sans-serif'
  ctx.fillStyle = '#3A4E68'
  const ratingLabel = item.rating > 0 ? `${item.rating} / 5` : 'Sem avaliação'
  ctx.fillText(ratingLabel, W / 2, curY)

  // Bottom vignette
  const vignette = ctx.createLinearGradient(0, H - 300, 0, H)
  vignette.addColorStop(0, 'transparent')
  vignette.addColorStop(1, '#060C12')
  ctx.fillStyle = vignette
  ctx.fillRect(0, H - 300, W, 300)

  // Shelf branding
  ctx.textAlign = 'center'
  ctx.textBaseline = 'bottom'
  ctx.fillStyle = '#E8A030'
  ctx.font = 'bold 48px Georgia, serif'
  ctx.fillText('Shelf', W / 2, H - 72)
  ctx.fillStyle = '#3A4E68'
  ctx.font = '26px system-ui, sans-serif'
  ctx.fillText('sua coleção pessoal', W / 2, H - 30)

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
