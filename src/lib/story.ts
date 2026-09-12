import type { MediaType } from '../types'

// ─── Modelos disponíveis ─────────────────────────────────────────────
export type StoryTemplate = 'poster' | 'minimal' | 'gradient' | 'polaroid'

export const STORY_TEMPLATES: { id: StoryTemplate; label: string; desc: string }[] = [
  { id: 'poster',   label: 'Pôster',    desc: 'Capa grande e centralizada' },
  { id: 'minimal',  label: 'Minimalista', desc: 'Fundo sólido, tipografia' },
  { id: 'gradient', label: 'Gradiente',  desc: 'Cor vibrante da categoria' },
  { id: 'polaroid', label: 'Polaroid',   desc: 'Moldura com seu comentário' },
]

export interface StorySubject {
  title:     string
  type:      MediaType
  cover_url: string | null
  year:      number | null
  genre:     string | null
  author?:   string | null
  creators?: string | null
  rating:    number
  comment?:  string | null
  /** Selo do registro (ex.: "Temporada"); sem isso o selo mostra o tipo da mídia. */
  badge?:    string | null
  /** Alcance do registro (ex.: "T2E5 · O Encontro"), impresso abaixo do título. */
  subtitle?: string | null
}

const TYPE_HEX: Record<MediaType, string> = {
  movie:  '#D94444',
  series: '#8A5FE8',
  game:   '#20C97A',
  book:   '#C47A0A',
  music:  '#8B5CF6',
}

const TYPE_LABEL_STORY: Record<MediaType, string> = {
  movie: 'FILME', series: 'SÉRIE', game: 'JOGO', book: 'LIVRO', music: 'MÚSICA',
}

export const STORY_W = 1080
export const STORY_H = 1920

// ─── Canvas helpers ──────────────────────────────────────────────────

/** Rota capas remotas pelo proxy da mesma origem, evitando canvas "tainted". */
function proxiedCover(url: string): string {
  return /^https?:\/\//i.test(url) ? `/api/img?url=${encodeURIComponent(url)}&width=1024` : url
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => res(img)
    img.onerror = rej
    img.src = proxiedCover(url)
  })
}

function drawCover(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement,
  dx: number, dy: number, dw: number, dh: number,
) {
  const scale = Math.max(dw / img.naturalWidth, dh / img.naturalHeight)
  const sw = dw / scale, sh = dh / scale
  const sx = (img.naturalWidth - sw) / 2, sy = (img.naturalHeight - sh) / 2
  ctx.drawImage(img, sx, sy, sw, sh, dx, dy, dw, dh)
}

function roundedPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y); ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r); ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h); ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r); ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

function star5pt(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, color: string) {
  ctx.fillStyle = color
  ctx.beginPath()
  for (let i = 0; i < 10; i++) {
    const rad = i % 2 === 0 ? r : r * 0.42
    const angle = (i * Math.PI) / 5 - Math.PI / 2
    const x = cx + Math.cos(angle) * rad, y = cy + Math.sin(angle) * rad
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y)
  }
  ctx.closePath(); ctx.fill()
}

function ratingStars(ctx: CanvasRenderingContext2D, cx: number, topY: number, rating: number, size: number, empty = '#283548', full = '#E8A030') {
  const gap = size * 0.25
  const total = 5 * size + 4 * gap
  let x = cx - total / 2
  for (let i = 1; i <= 5; i++) {
    const scx = x + size / 2, scy = topY + size / 2
    star5pt(ctx, scx, scy, size / 2, empty)
    if (rating >= i) {
      star5pt(ctx, scx, scy, size / 2, full)
    } else if (rating >= i - 0.5) {
      ctx.save(); ctx.beginPath(); ctx.rect(x, topY, size / 2, size); ctx.clip()
      star5pt(ctx, scx, scy, size / 2, full); ctx.restore()
    }
    x += size + gap
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
    } else line = test
  }
  if (line && lines.length < maxLines) lines.push(line)
  return lines
}

/** Texto do selo: o escopo do registro quando existe, senão o tipo da mídia. */
function badgeText(s: StorySubject): string {
  return (s.badge?.trim() || TYPE_LABEL_STORY[s.type]).toUpperCase()
}

/**
 * Imprime o alcance do registro (temporada/episódio) abaixo do título e devolve
 * o novo `y`. Sem alcance, a arte segue falando da obra inteira.
 */
function scopeLine(
  ctx: CanvasRenderingContext2D, s: StorySubject, x: number, y: number,
  maxW: number, size: number, color: string,
): number {
  const text = s.subtitle?.trim()
  if (!text) return y
  ctx.font = `600 ${size}px system-ui, sans-serif`
  ctx.fillStyle = color
  let cur = y
  for (const line of wrapText(ctx, text, maxW, 2)) { ctx.fillText(line, x, cur); cur += size * 1.25 }
  return cur + size * 0.3
}

function metaLine(s: StorySubject): string {
  return [
    s.author ?? (s.creators ? s.creators.split(',')[0].trim() : null),
    s.year ? String(s.year) : null,
  ].filter(Boolean).join(' · ')
}

async function tryCover(ctx: CanvasRenderingContext2D, url: string | null, dx: number, dy: number, dw: number, dh: number, r: number) {
  if (!url) return
  try {
    const img = await loadImage(url)
    ctx.save(); roundedPath(ctx, dx, dy, dw, dh, r); ctx.clip()
    drawCover(ctx, img, dx, dy, dw, dh); ctx.restore()
  } catch { /* mantém placeholder */ }
}

// ─── Templates ───────────────────────────────────────────────────────

async function drawPoster(ctx: CanvasRenderingContext2D, s: StorySubject) {
  const W = STORY_W, H = STORY_H
  const typeColor = TYPE_HEX[s.type]

  ctx.fillStyle = '#0C1118'; ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 520, 0, W / 2, 520, 720)
  glow.addColorStop(0, typeColor + '35'); glow.addColorStop(0.6, typeColor + '10'); glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H)

  const CW = 460, CH = 690, CX = (W - CW) / 2, CY = 130, CR = 28
  ctx.save(); ctx.shadowColor = typeColor; ctx.shadowBlur = 80; ctx.shadowOffsetY = 24
  roundedPath(ctx, CX, CY, CW, CH, CR); ctx.fillStyle = '#1C2838'; ctx.fill(); ctx.restore()
  await tryCover(ctx, s.cover_url, CX, CY, CW, CH, CR)

  ctx.font = 'bold 26px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  const badge = badgeText(s)
  const badgeW = ctx.measureText(badge).width + 52, badgeH = 52, badgeX = (W - badgeW) / 2, badgeY = CY + CH + 44
  roundedPath(ctx, badgeX, badgeY, badgeW, badgeH, 26); ctx.fillStyle = typeColor; ctx.fill()
  ctx.fillStyle = '#0C1118'; ctx.fillText(badge, W / 2, badgeY + badgeH / 2)

  let curY = badgeY + badgeH + 50
  const len = s.title.length
  const titleSz = len > 35 ? 56 : len > 22 ? 66 : 78
  ctx.font = `bold ${titleSz}px Georgia, serif`; ctx.textBaseline = 'top'; ctx.fillStyle = '#EDF2F8'
  for (const l of wrapText(ctx, s.title, 940, 3)) { ctx.fillText(l, W / 2, curY); curY += titleSz * 1.18 }

  curY += 14
  curY = scopeLine(ctx, s, W / 2, curY, 900, 38, typeColor)

  curY += 12
  const meta = metaLine(s)
  if (meta) { ctx.font = '34px system-ui, sans-serif'; ctx.fillStyle = '#5A7090'; ctx.fillText(meta, W / 2, curY); curY += 52 }

  curY += 20
  ratingStars(ctx, W / 2, curY, s.rating, 56); curY += 72
  ctx.font = '28px system-ui, sans-serif'; ctx.fillStyle = '#3A4E68'
  ctx.fillText(s.rating > 0 ? `${s.rating} / 5` : 'Sem avaliação', W / 2, curY)

  const vig = ctx.createLinearGradient(0, H - 300, 0, H)
  vig.addColorStop(0, 'transparent'); vig.addColorStop(1, '#060C12')
  ctx.fillStyle = vig; ctx.fillRect(0, H - 300, W, 300)
  brand(ctx)
}

async function drawMinimal(ctx: CanvasRenderingContext2D, s: StorySubject) {
  const W = STORY_W, H = STORY_H
  const typeColor = TYPE_HEX[s.type]
  ctx.fillStyle = '#0E0E12'; ctx.fillRect(0, 0, W, H)

  // Barra de cor da categoria à esquerda
  ctx.fillStyle = typeColor; ctx.fillRect(90, 300, 8, 360)

  ctx.textAlign = 'left'
  ctx.font = 'bold 30px system-ui, sans-serif'; ctx.fillStyle = typeColor; ctx.textBaseline = 'top'
  ctx.fillText(badgeText(s), 140, 300)

  let curY = 360
  const len = s.title.length
  const titleSz = len > 40 ? 74 : len > 24 ? 92 : 112
  ctx.font = `bold ${titleSz}px Georgia, serif`; ctx.fillStyle = '#F4F4F6'
  for (const l of wrapText(ctx, s.title, 860, 4)) { ctx.fillText(l, 138, curY); curY += titleSz * 1.1 }

  curY += 18
  curY = scopeLine(ctx, s, 140, curY, 820, 40, typeColor)

  curY += 16
  const meta = metaLine(s)
  if (meta) { ctx.font = '34px system-ui, sans-serif'; ctx.fillStyle = '#7A7A88'; ctx.fillText(meta, 140, curY); curY += 70 }

  curY += 20
  ratingStars(ctx, 140 + 5 * 30 + 4 * 7.5, curY, s.rating, 60)

  // Capa pequena no canto inferior direito
  const CW = 300, CH = 450, CX = W - CW - 90, CY = H - CH - 220, CR = 18
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20
  roundedPath(ctx, CX, CY, CW, CH, CR); ctx.fillStyle = '#1A1A22'; ctx.fill(); ctx.restore()
  await tryCover(ctx, s.cover_url, CX, CY, CW, CH, CR)

  brand(ctx, '#F4F4F6')
}

async function drawGradient(ctx: CanvasRenderingContext2D, s: StorySubject) {
  const W = STORY_W, H = STORY_H
  const typeColor = TYPE_HEX[s.type]
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, typeColor); g.addColorStop(1, '#0A0A12')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  // Camada escura para contraste
  ctx.fillStyle = 'rgba(8,8,16,.35)'; ctx.fillRect(0, 0, W, H)

  const CW = 520, CH = 780, CX = (W - CW) / 2, CY = 180, CR = 24
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 90; ctx.shadowOffsetY = 30
  roundedPath(ctx, CX, CY, CW, CH, CR); ctx.fillStyle = '#12121C'; ctx.fill(); ctx.restore()
  await tryCover(ctx, s.cover_url, CX, CY, CW, CH, CR)

  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  let curY = CY + CH + 46
  ctx.font = 'bold 28px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.85)'
  ctx.fillText(badgeText(s), W / 2, curY); curY += 46

  const len = s.title.length
  const titleSz = len > 32 ? 62 : len > 20 ? 74 : 88
  ctx.font = `bold ${titleSz}px Georgia, serif`; ctx.fillStyle = '#FFFFFF'
  for (const l of wrapText(ctx, s.title, 960, 2)) { ctx.fillText(l, W / 2, curY); curY += titleSz * 1.14 }

  curY += 12
  curY = scopeLine(ctx, s, W / 2, curY, 920, 38, 'rgba(255,255,255,.92)')

  curY += 6
  const meta = metaLine(s)
  if (meta) { ctx.font = '34px system-ui, sans-serif'; ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.fillText(meta, W / 2, curY); curY += 60 }

  curY += 26
  ratingStars(ctx, W / 2, curY, s.rating, 64, 'rgba(255,255,255,.25)', '#FFFFFF')

  brand(ctx, '#FFFFFF')
}

async function drawPolaroid(ctx: CanvasRenderingContext2D, s: StorySubject) {
  const W = STORY_W, H = STORY_H
  const typeColor = TYPE_HEX[s.type]
  ctx.fillStyle = '#12100E'; ctx.fillRect(0, 0, W, H)
  const glow = ctx.createRadialGradient(W / 2, 700, 0, W / 2, 700, 820)
  glow.addColorStop(0, typeColor + '22'); glow.addColorStop(1, 'transparent')
  ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H)

  // Moldura branca (polaroid)
  const FW = 720, FX = (W - FW) / 2, FY = 150
  const IW = FW - 60, IH = IW * 1.32, IX = FX + 30, IY = FY + 30
  const scope = s.subtitle?.trim() || ''
  // Borda inferior grande p/ legenda; o alcance do registro pede mais uma linha.
  const FH = IH + 30 + 300 + (scope ? 52 : 0)
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 24
  roundedPath(ctx, FX, FY, FW, FH, 14); ctx.fillStyle = '#F7F4EC'; ctx.fill(); ctx.restore()

  // Foto
  ctx.fillStyle = '#1A1A22'; roundedPath(ctx, IX, IY, IW, IH, 6); ctx.fill()
  await tryCover(ctx, s.cover_url, IX, IY, IW, IH, 6)

  // Legenda (título + comentário) na borda inferior
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'
  let curY = IY + IH + 40
  const len = s.title.length
  const titleSz = len > 28 ? 44 : 54
  ctx.font = `bold ${titleSz}px Georgia, serif`; ctx.fillStyle = '#1A1712'
  for (const l of wrapText(ctx, s.title, IW - 20, 2)) { ctx.fillText(l, W / 2, curY); curY += titleSz * 1.12 }

  if (scope) {
    curY += 8
    ctx.font = '600 32px system-ui, sans-serif'; ctx.fillStyle = typeColor
    for (const l of wrapText(ctx, scope, IW - 40, 1)) { ctx.fillText(l, W / 2, curY); curY += 44 }
  }

  curY += 6
  ratingStars(ctx, W / 2, curY, s.rating, 40, '#D8D2C4', '#E0A02A'); curY += 60

  const comment = s.comment?.trim()
  if (comment) {
    ctx.font = 'italic 34px Georgia, serif'; ctx.fillStyle = '#4A443A'
    for (const l of wrapText(ctx, `“${comment}”`, IW - 40, 3)) { ctx.fillText(l, W / 2, curY); curY += 46 }
  } else {
    const meta = metaLine(s)
    if (meta) { ctx.font = '32px system-ui, sans-serif'; ctx.fillStyle = '#6A6355'; ctx.fillText(meta, W / 2, curY) }
  }

  brand(ctx, '#E8A030')
}

function brand(ctx: CanvasRenderingContext2D, color = '#E8A030') {
  ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'
  ctx.fillStyle = color; ctx.font = 'bold 48px Georgia, serif'
  ctx.fillText('Shelf', STORY_W / 2, STORY_H - 72)
  ctx.fillStyle = 'rgba(255,255,255,.35)'; ctx.font = '26px system-ui, sans-serif'
  ctx.fillText('sua coleção pessoal', STORY_W / 2, STORY_H - 30)
}

const RENDERERS: Record<StoryTemplate, (ctx: CanvasRenderingContext2D, s: StorySubject) => Promise<void>> = {
  poster: drawPoster, minimal: drawMinimal, gradient: drawGradient, polaroid: drawPolaroid,
}

/** Renderiza um modelo no canvas informado (1080×1920). */
export async function renderStory(template: StoryTemplate, subject: StorySubject, canvas: HTMLCanvasElement): Promise<void> {
  canvas.width = STORY_W; canvas.height = STORY_H
  const ctx = canvas.getContext('2d')!
  await RENDERERS[template](ctx, subject)
}

function storyFileName(template: StoryTemplate, subject: StorySubject): string {
  const scope = subject.subtitle?.trim() ? `-${subject.subtitle.split('·')[0].trim()}` : ''
  const slug = `${subject.title.slice(0, 30)}${scope}`
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
  return `shelf-${template}-${slug}.png`
}

/** Renderiza fora da tela e retorna o PNG como Blob. */
async function renderToBlob(template: StoryTemplate, subject: StorySubject): Promise<Blob | null> {
  const canvas = document.createElement('canvas')
  await renderStory(template, subject, canvas)
  return new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/png'))
}

export function downloadImageBlob(blob: Blob, filename: string): void {
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = filename
  a.click()
  URL.revokeObjectURL(a.href)
}

/** Indica se o navegador consegue compartilhar arquivos (Web Share API nível 2). */
export function canShareStory(): boolean {
  if (typeof navigator === 'undefined' || !navigator.canShare) return false
  try {
    const probe = new File([new Blob([''], { type: 'image/png' })], 'probe.png', { type: 'image/png' })
    return navigator.canShare({ files: [probe] })
  } catch {
    return false
  }
}

/** Renderiza fora da tela e dispara o download do PNG. */
export async function downloadStory(template: StoryTemplate, subject: StorySubject): Promise<void> {
  const blob = await renderToBlob(template, subject)
  if (blob) downloadImageBlob(blob, storyFileName(template, subject))
}

export type ShareResult = 'shared' | 'downloaded' | 'cancelled'

/**
 * Compartilha o Story pela folha nativa (Instagram, etc.) via Web Share API.
 * Sem suporte, faz fallback pro download. Se o usuário fechar a folha, não baixa.
 */
export async function shareImageBlob(blob: Blob, filename: string, title?: string): Promise<ShareResult> {
  const file = new File([blob], filename, { type: 'image/png' })
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], ...(title ? { title } : {}) })
      return 'shared'
    } catch (err) {
      // Usuário fechou a folha → não força o download.
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled'
      // Qualquer outra falha cai no fallback abaixo.
    }
  }

  downloadImageBlob(blob, file.name)
  return 'downloaded'
}

export async function shareStory(template: StoryTemplate, subject: StorySubject): Promise<ShareResult> {
  const blob = await renderToBlob(template, subject)
  if (!blob) return 'cancelled'
  return shareImageBlob(blob, storyFileName(template, subject), subject.title)
}
