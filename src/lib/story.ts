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
  /** Capa do provedor quando `cover_url` é uma arte personalizada — o Story deixa escolher entre as duas. */
  default_cover_url?: string | null
  year:      number | null
  genre:     string | null
  author?:   string | null
  creators?: string | null
  rating:    number
  comment?:  string | null
  /** Selo do registro (ex.: "Temporada", "Jogo zerado"); sem isso o selo mostra o tipo da mídia. */
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

function metaLine(s: StorySubject): string {
  return [
    s.author ?? (s.creators ? s.creators.split(',')[0].trim() : null),
    s.year ? String(s.year) : null,
  ].filter(Boolean).join(' · ')
}

// ─── Capa no formato da arte ─────────────────────────────────────────

async function loadCover(url: string | null): Promise<HTMLImageElement | null> {
  if (!url) return null
  try { return await loadImage(url) } catch { return null }
}

/**
 * Proporção (largura/altura) da caixa da capa. Segue a arte carregada — a capa
 * padrão de jogo é paisagem (header da Steam, screenshot da RAWG) e recortá-la
 * em pôster deixa só um pedaço ampliado, sem o logo.
 */
function coverAspect(img: HTMLImageElement | null, type: MediaType): number {
  if (img?.naturalWidth && img.naturalHeight) return img.naturalWidth / img.naturalHeight
  return type === 'music' ? 1 : 2 / 3
}

/** Maior caixa com a proporção dada que cabe em `maxW`×`maxH`. */
function fitBox(aspect: number, maxW: number, maxH: number): { w: number; h: number } {
  const w = Math.min(maxW, maxH * aspect)
  return { w: Math.round(w), h: Math.round(w / aspect) }
}

function paintCover(
  ctx: CanvasRenderingContext2D, img: HTMLImageElement | null,
  dx: number, dy: number, dw: number, dh: number, r: number,
) {
  if (!img) return // mantém o placeholder
  ctx.save(); roundedPath(ctx, dx, dy, dw, dh, r); ctx.clip()
  drawCover(ctx, img, dx, dy, dw, dh); ctx.restore()
}

// ─── Pilha centralizada ──────────────────────────────────────────────

/** Faixa vertical útil: abaixo da margem do topo e acima da marca "Shelf". */
const CONTENT_TOP = 90
const CONTENT_BOTTOM = STORY_H - 190

/** Trecho da arte com altura conhecida antes de desenhar. */
interface Block { h: number; draw: (y: number) => void }

const gap = (h: number): Block => ({ h, draw: () => {} })

/**
 * Desenha os blocos em sequência, com o conjunto centralizado na vertical.
 * Medir antes de desenhar mantém a arte equilibrada com título longo, alcance
 * ou capa em paisagem, em vez de tudo partir do topo e sobrar vazio embaixo.
 */
function drawStack(blocks: (Block | null)[], top = CONTENT_TOP, bottom = CONTENT_BOTTOM) {
  const list = blocks.filter((b): b is Block => b !== null)
  const total = list.reduce((sum, b) => sum + b.h, 0)
  let y = top + Math.max(0, (bottom - top - total) / 2)
  for (const b of list) { b.draw(y); y += b.h }
}

/** Texto quebrado em linhas, alinhado conforme o `textAlign` atual. */
function linesBlock(
  ctx: CanvasRenderingContext2D, text: string, font: string, color: string,
  x: number, maxW: number, maxLines: number, lineH: number, after = 0,
): Block | null {
  ctx.font = font
  const lines = wrapText(ctx, text, maxW, maxLines)
  if (!lines.length) return null
  return {
    h: lines.length * lineH + after,
    draw: y => {
      ctx.font = font; ctx.fillStyle = color
      lines.forEach((l, i) => ctx.fillText(l, x, y + i * lineH))
    },
  }
}

/** Alcance do registro (temporada/episódio) abaixo do título; sem alcance, nada. */
function scopeBlock(
  ctx: CanvasRenderingContext2D, s: StorySubject, x: number,
  maxW: number, size: number, color: string,
): Block | null {
  const text = s.subtitle?.trim()
  if (!text) return null
  return linesBlock(ctx, text, `600 ${size}px system-ui, sans-serif`, color, x, maxW, 2, size * 1.25, size * 0.3)
}

function metaBlock(s: StorySubject, x: number, font: string, color: string, h: number, ctx: CanvasRenderingContext2D): Block | null {
  const meta = metaLine(s)
  if (!meta) return null
  return { h, draw: y => { ctx.font = font; ctx.fillStyle = color; ctx.fillText(meta, x, y) } }
}

// ─── Templates ───────────────────────────────────────────────────────

async function drawPoster(ctx: CanvasRenderingContext2D, s: StorySubject) {
  const W = STORY_W, H = STORY_H
  const typeColor = TYPE_HEX[s.type]
  const img = await loadCover(s.cover_url)

  ctx.fillStyle = '#0C1118'; ctx.fillRect(0, 0, W, H)
  ctx.textAlign = 'center'; ctx.textBaseline = 'top'

  const { w: CW, h: CH } = fitBox(coverAspect(img, s.type), 900, 690)
  const CX = (W - CW) / 2, CR = 28
  const cover: Block = {
    h: CH,
    draw: y => {
      const cy = y + CH / 2
      const glow = ctx.createRadialGradient(W / 2, cy, 0, W / 2, cy, 720)
      glow.addColorStop(0, typeColor + '35'); glow.addColorStop(0.6, typeColor + '10'); glow.addColorStop(1, 'transparent')
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H)
      ctx.save(); ctx.shadowColor = typeColor; ctx.shadowBlur = 80; ctx.shadowOffsetY = 24
      roundedPath(ctx, CX, y, CW, CH, CR); ctx.fillStyle = '#1C2838'; ctx.fill(); ctx.restore()
      paintCover(ctx, img, CX, y, CW, CH, CR)
    },
  }

  ctx.font = 'bold 26px system-ui, sans-serif'
  const badge = badgeText(s)
  const badgeW = ctx.measureText(badge).width + 52, badgeH = 52
  const badgeBlock: Block = {
    h: badgeH,
    draw: y => {
      roundedPath(ctx, (W - badgeW) / 2, y, badgeW, badgeH, 26); ctx.fillStyle = typeColor; ctx.fill()
      ctx.save(); ctx.font = 'bold 26px system-ui, sans-serif'; ctx.textBaseline = 'middle'
      ctx.fillStyle = '#0C1118'; ctx.fillText(badge, W / 2, y + badgeH / 2); ctx.restore()
    },
  }

  const len = s.title.length
  const titleSz = len > 35 ? 56 : len > 22 ? 66 : 78

  drawStack([
    cover, gap(44), badgeBlock, gap(50),
    linesBlock(ctx, s.title, `bold ${titleSz}px Georgia, serif`, '#EDF2F8', W / 2, 940, 3, titleSz * 1.18),
    gap(14),
    scopeBlock(ctx, s, W / 2, 900, 38, typeColor),
    gap(12),
    metaBlock(s, W / 2, '34px system-ui, sans-serif', '#5A7090', 52, ctx),
    gap(20),
    { h: 72, draw: y => ratingStars(ctx, W / 2, y, s.rating, 56) },
    {
      h: 34,
      draw: y => {
        ctx.font = '28px system-ui, sans-serif'; ctx.fillStyle = '#3A4E68'
        ctx.fillText(s.rating > 0 ? `${s.rating} / 5` : 'Sem avaliação', W / 2, y)
      },
    },
  ])

  const vig = ctx.createLinearGradient(0, H - 300, 0, H)
  vig.addColorStop(0, 'transparent'); vig.addColorStop(1, '#060C12')
  ctx.fillStyle = vig; ctx.fillRect(0, H - 300, W, 300)
  brand(ctx)
}

async function drawMinimal(ctx: CanvasRenderingContext2D, s: StorySubject) {
  const W = STORY_W, H = STORY_H
  const typeColor = TYPE_HEX[s.type]
  const img = await loadCover(s.cover_url)
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
  const scope = scopeBlock(ctx, s, 140, 820, 40, typeColor)
  if (scope) { scope.draw(curY); curY += scope.h }

  curY += 16
  const meta = metaLine(s)
  if (meta) { ctx.font = '34px system-ui, sans-serif'; ctx.fillStyle = '#7A7A88'; ctx.fillText(meta, 140, curY); curY += 70 }

  curY += 20
  ratingStars(ctx, 140 + 5 * 30 + 4 * 7.5, curY, s.rating, 60)

  // Capa pequena no canto inferior direito, no formato da arte
  const { w: CW, h: CH } = fitBox(coverAspect(img, s.type), 420, 450)
  const CX = W - CW - 90, CY = H - CH - 220, CR = 18
  ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.6)'; ctx.shadowBlur = 50; ctx.shadowOffsetY = 20
  roundedPath(ctx, CX, CY, CW, CH, CR); ctx.fillStyle = '#1A1A22'; ctx.fill(); ctx.restore()
  paintCover(ctx, img, CX, CY, CW, CH, CR)

  brand(ctx, '#F4F4F6')
}

async function drawGradient(ctx: CanvasRenderingContext2D, s: StorySubject) {
  const W = STORY_W, H = STORY_H
  const typeColor = TYPE_HEX[s.type]
  const img = await loadCover(s.cover_url)
  const g = ctx.createLinearGradient(0, 0, W, H)
  g.addColorStop(0, typeColor); g.addColorStop(1, '#0A0A12')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  // Camada escura para contraste
  ctx.fillStyle = 'rgba(8,8,16,.35)'; ctx.fillRect(0, 0, W, H)

  ctx.textAlign = 'center'; ctx.textBaseline = 'top'

  const { w: CW, h: CH } = fitBox(coverAspect(img, s.type), 960, 780)
  const CX = (W - CW) / 2, CR = 24
  const cover: Block = {
    h: CH,
    draw: y => {
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.55)'; ctx.shadowBlur = 90; ctx.shadowOffsetY = 30
      roundedPath(ctx, CX, y, CW, CH, CR); ctx.fillStyle = '#12121C'; ctx.fill(); ctx.restore()
      paintCover(ctx, img, CX, y, CW, CH, CR)
    },
  }

  const len = s.title.length
  const titleSz = len > 32 ? 62 : len > 20 ? 74 : 88

  drawStack([
    cover, gap(46),
    linesBlock(ctx, badgeText(s), 'bold 28px system-ui, sans-serif', 'rgba(255,255,255,.85)', W / 2, 960, 1, 46),
    linesBlock(ctx, s.title, `bold ${titleSz}px Georgia, serif`, '#FFFFFF', W / 2, 960, 2, titleSz * 1.14),
    gap(12),
    scopeBlock(ctx, s, W / 2, 920, 38, 'rgba(255,255,255,.92)'),
    gap(6),
    metaBlock(s, W / 2, '34px system-ui, sans-serif', 'rgba(255,255,255,.75)', 60, ctx),
    gap(26),
    { h: 64, draw: y => ratingStars(ctx, W / 2, y, s.rating, 64, 'rgba(255,255,255,.25)', '#FFFFFF') },
  ])

  brand(ctx, '#FFFFFF')
}

async function drawPolaroid(ctx: CanvasRenderingContext2D, s: StorySubject) {
  const W = STORY_W, H = STORY_H
  const typeColor = TYPE_HEX[s.type]
  const img = await loadCover(s.cover_url)
  ctx.fillStyle = '#12100E'; ctx.fillRect(0, 0, W, H)

  // Moldura branca (polaroid); a foto acompanha o formato da arte, dentro de limites de polaroid.
  const FW = 720, FX = (W - FW) / 2
  const IW = FW - 60
  const IH = Math.round(Math.min(IW * 1.32, Math.max(IW * 0.45, IW / coverAspect(img, s.type))))
  // A polaroid não tem selo: sem alcance, um selo explícito ("Jogo zerado") vira a linha.
  const scope = s.subtitle?.trim() || s.badge?.trim() || ''
  // Borda inferior grande p/ legenda; o alcance do registro pede mais uma linha.
  const FH = IH + 30 + 300 + (scope ? 52 : 0)

  drawStack([{
    h: FH,
    draw: FY => {
      const IX = FX + 30, IY = FY + 30
      const glow = ctx.createRadialGradient(W / 2, FY + FH / 2, 0, W / 2, FY + FH / 2, 820)
      glow.addColorStop(0, typeColor + '22'); glow.addColorStop(1, 'transparent')
      ctx.fillStyle = glow; ctx.fillRect(0, 0, W, H)

      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,.5)'; ctx.shadowBlur = 60; ctx.shadowOffsetY = 24
      roundedPath(ctx, FX, FY, FW, FH, 14); ctx.fillStyle = '#F7F4EC'; ctx.fill(); ctx.restore()

      // Foto
      ctx.fillStyle = '#1A1A22'; roundedPath(ctx, IX, IY, IW, IH, 6); ctx.fill()
      paintCover(ctx, img, IX, IY, IW, IH, 6)

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
    },
  }])

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
