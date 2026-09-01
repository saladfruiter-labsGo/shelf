import { useState, useRef } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import { StarRating } from '../components/StarRating'
import type { MediaType } from '../types'
import { TYPE_LABEL, formatRuntime } from '../lib/utils'

const TYPE_COLOR_HEX: Record<MediaType, string> = {
  movie:  '#D94444',
  series: '#8A5FE8',
  game:   '#20C97A',
  book:   '#C47A0A',
}

const TYPE_EMOJI: Record<MediaType, string> = {
  movie:  '🎬',
  series: '📺',
  game:   '🎮',
  book:   '📚',
}

export function Wrap() {
  const now = new Date()
  const [period, setPeriod]   = useState<'annual' | 'monthly'>('annual')
  const [year,   setYear]     = useState(now.getFullYear())
  const [month,  setMonth]    = useState(now.getMonth() + 1)
  const canvasRef = useRef<HTMLCanvasElement>(null)

  const { data, isLoading } = useQuery({
    queryKey: ['wrap', period, year, month],
    queryFn: () => api.wrap({ period, year, month: period === 'monthly' ? month : undefined }),
  })

  const MONTHS = ['Jan','Fev','Mar','Abr','Mai','Jun','Jul','Ago','Set','Out','Nov','Dez']

  const maxActivity = data?.activity.reduce((m, a) => Math.max(m, a.count), 0) ?? 1

  const generateStory = () => {
    const canvas = canvasRef.current
    if (!canvas || !data) return
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    canvas.width  = 1080
    canvas.height = 1920

    // Background
    ctx.fillStyle = '#0C1118'
    ctx.fillRect(0, 0, 1080, 1920)

    // Gradient overlay
    const grad = ctx.createLinearGradient(0, 0, 1080, 1920)
    grad.addColorStop(0, '#0C1118EE')
    grad.addColorStop(0.5, '#141C28AA')
    grad.addColorStop(1, '#0C1118EE')
    ctx.fillStyle = grad
    ctx.fillRect(0, 0, 1080, 1920)

    // Decorative circles
    ctx.save()
    ctx.globalAlpha = 0.08
    ctx.fillStyle = '#E8A030'
    ctx.beginPath()
    ctx.arc(900, 200, 400, 0, Math.PI * 2)
    ctx.fill()
    ctx.fillStyle = '#8A5FE8'
    ctx.beginPath()
    ctx.arc(150, 1700, 350, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()

    // App name
    ctx.fillStyle = '#E8A030'
    ctx.font = 'bold 52px serif'
    ctx.textAlign = 'center'
    ctx.fillText('Shelf', 540, 180)

    // Period label
    ctx.fillStyle = '#94A8C0'
    ctx.font = '36px sans-serif'
    const periodLabel = period === 'annual'
      ? `Wrap ${year}`
      : `${MONTHS[month - 1]} ${year}`
    ctx.fillText(periodLabel, 540, 240)

    // Total
    ctx.fillStyle = '#EDF2F8'
    ctx.font = 'bold 120px sans-serif'
    ctx.fillText(String(data.total), 540, 420)
    ctx.fillStyle = '#5A7090'
    ctx.font = '38px sans-serif'
    ctx.fillText('itens concluídos', 540, 476)

    // By type bars
    let y = 580
    const types: MediaType[] = ['movie', 'series', 'game', 'book']
    const maxCount = Math.max(...(data.byType.map((b) => b.count) ?? [1]), 1)

    for (const t of types) {
      const entry = data.byType.find((b) => b.type === t)
      const count = entry?.count ?? 0
      const barW  = count > 0 ? (count / maxCount) * 600 : 0

      ctx.fillStyle = '#283548'
      ctx.beginPath()
      ctx.roundRect(180, y, 700, 52, 10)
      ctx.fill()

      if (barW > 0) {
        ctx.fillStyle = TYPE_COLOR_HEX[t]
        ctx.globalAlpha = 0.85
        ctx.beginPath()
        ctx.roundRect(180, y, barW, 52, 10)
        ctx.fill()
        ctx.globalAlpha = 1
      }

      ctx.fillStyle = '#EDF2F8'
      ctx.font = '30px sans-serif'
      ctx.textAlign = 'left'
      ctx.fillText(`${TYPE_EMOJI[t]} ${TYPE_LABEL[t]}s`, 196, y + 34)

      ctx.textAlign = 'right'
      ctx.fillText(String(count), 860, y + 34)

      y += 76
    }

    // Runtime
    if (data.totalRuntimeMinutes > 0) {
      y += 30
      ctx.fillStyle = '#5A7090'
      ctx.font = '32px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`⏱ ${formatRuntime(data.totalRuntimeMinutes)} consumidos`, 540, y)
    }

    // Top genre
    if (data.dominantGenre) {
      y += 56
      ctx.fillStyle = '#E8A030'
      ctx.font = 'bold 34px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText(`🏷 Gênero favorito: ${data.dominantGenre}`, 540, y)
    }

    // Activity mini chart
    if (data.activity.length > 0) {
      y += 80
      ctx.fillStyle = '#94A8C0'
      ctx.font = '28px sans-serif'
      ctx.textAlign = 'center'
      ctx.fillText('Atividade', 540, y)

      y += 20
      const chartW = 700
      const chartH = 120
      const x0 = (1080 - chartW) / 2
      const barCount = data.activity.length
      const bw = (chartW / barCount) - 4

      data.activity.forEach((a, i) => {
        const h = Math.max((a.count / maxActivity) * chartH, 4)
        ctx.fillStyle = '#E8A030'
        ctx.globalAlpha = 0.7
        ctx.beginPath()
        ctx.roundRect(x0 + i * (chartW / barCount), y + chartH - h, bw, h, 3)
        ctx.fill()
        ctx.globalAlpha = 1
      })
    }

    // Footer
    ctx.fillStyle = '#3A4E68'
    ctx.font = '26px sans-serif'
    ctx.textAlign = 'center'
    ctx.fillText('shelf · sua coleção pessoal', 540, 1870)

    // Download
    canvas.toBlob((blob) => {
      if (!blob) return
      const a = document.createElement('a')
      a.href = URL.createObjectURL(blob)
      a.download = `shelf-wrap-${period === 'annual' ? year : `${year}-${String(month).padStart(2, '0')}`}.png`
      a.click()
      URL.revokeObjectURL(a.href)
    }, 'image/png')
  }

  return (
    <div className="px-6 py-8 max-w-4xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-primary mb-1">Wrap</h1>
        <p className="text-muted text-sm">Seu resumo de consumo de mídia</p>
      </div>

      {/* Period controls */}
      <div className="flex flex-wrap items-center gap-3 mb-8">
        <div className="flex rounded-lg overflow-hidden border border-border">
          {(['annual', 'monthly'] as const).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                period === p ? 'bg-accent text-bg' : 'text-muted hover:text-primary'
              }`}
            >
              {p === 'annual' ? 'Anual' : 'Mensal'}
            </button>
          ))}
        </div>

        <select
          value={year}
          onChange={(e) => setYear(parseInt(e.target.value))}
          className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-primary outline-none"
        >
          {Array.from({ length: 5 }, (_, i) => now.getFullYear() - i).map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>

        {period === 'monthly' && (
          <select
            value={month}
            onChange={(e) => setMonth(parseInt(e.target.value))}
            className="bg-card border border-border rounded-lg px-3 py-2 text-sm text-primary outline-none"
          >
            {MONTHS.map((m, i) => (
              <option key={i + 1} value={i + 1}>{m}</option>
            ))}
          </select>
        )}
      </div>

      {isLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-20 bg-card rounded-xl animate-pulse" />
          ))}
        </div>
      ) : data ? (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-8">
            <div className="bg-surface border border-border rounded-xl p-4 col-span-2 md:col-span-1">
              <p className="text-3xl font-bold text-primary font-display">{data.total}</p>
              <p className="text-xs text-muted mt-1">itens concluídos</p>
            </div>
            {data.byType.map((b) => (
              <div key={b.type} className="bg-surface border border-border rounded-xl p-4">
                <p className="text-2xl font-bold text-primary">{b.count}</p>
                <p className="text-xs text-muted mt-1">
                  {TYPE_EMOJI[b.type as MediaType]} {TYPE_LABEL[b.type as MediaType]}s
                </p>
              </div>
            ))}
          </div>

          {/* Runtime */}
          {data.totalRuntimeMinutes > 0 && (
            <div className="bg-surface border border-border rounded-xl p-4 mb-4 flex items-center gap-3">
              <span className="text-2xl">⏱</span>
              <div>
                <p className="font-semibold text-primary">{formatRuntime(data.totalRuntimeMinutes)}</p>
                <p className="text-xs text-muted">consumidos</p>
              </div>
            </div>
          )}

          {/* Top genre */}
          {data.dominantGenre && (
            <div className="bg-surface border border-border rounded-xl p-4 mb-4 flex items-center gap-3">
              <span className="text-2xl">🏷</span>
              <div>
                <p className="font-semibold text-primary">{data.dominantGenre}</p>
                <p className="text-xs text-muted">gênero dominante</p>
              </div>
            </div>
          )}

          {/* Activity chart */}
          {data.activity.length > 0 && (
            <div className="bg-surface border border-border rounded-xl p-4 mb-8">
              <p className="text-sm font-medium text-secondary mb-3">
                {period === 'monthly' ? 'Atividade por dia' : 'Atividade por mês'}
              </p>
              <div className="flex items-end gap-1 h-24">
                {data.activity.map((a, i) => (
                  <div key={i} className="flex-1 flex flex-col items-center gap-1">
                    <div
                      className="w-full bg-accent rounded-sm opacity-70"
                      style={{ height: `${(a.count / maxActivity) * 80}px`, minHeight: a.count > 0 ? 4 : 0 }}
                    />
                    {data.activity.length <= 12 && (
                      <span className="text-[9px] text-muted">
                        {period === 'monthly'
                          ? a.period_key
                          : MONTHS[parseInt(a.period_key) - 1]}
                      </span>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Top items by type */}
          <div className="mb-8 space-y-6">
            {(['movie', 'series', 'game', 'book'] as MediaType[]).map((t) => {
              const items = data.topByType[t] ?? []
              if (items.length === 0) return null
              const avgEntry = data.avgRating.find((r) => r.type === t)
              return (
                <div key={t}>
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-primary">
                      {TYPE_EMOJI[t]} Top {TYPE_LABEL[t]}s
                    </h3>
                    {avgEntry && (
                      <span className="text-sm text-muted">
                        Média: <span className="text-accent font-medium">{avgEntry.avg}★</span>
                      </span>
                    )}
                  </div>
                  <div className="space-y-2">
                    {items.map((item, i) => (
                      <div key={item.id} className="flex items-center gap-3 bg-surface rounded-lg p-2.5">
                        <span className="text-muted text-sm w-5">{i + 1}</span>
                        {item.cover_url && (
                          <img src={item.cover_url} alt="" className="w-8 h-12 object-cover rounded" />
                        )}
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-primary truncate">{item.title}</p>
                          {item.year && <p className="text-xs text-muted">{item.year}</p>}
                        </div>
                        {item.rating > 0 && <StarRating value={item.rating} readonly size="sm" />}
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>

          {/* Stories generator */}
          <div className="border border-border rounded-xl p-6 bg-surface">
            <div className="flex items-start justify-between mb-4">
              <div>
                <h2 className="font-display text-xl font-semibold text-primary mb-1">Stories</h2>
                <p className="text-sm text-muted">Gere uma arte 1080×1920 para compartilhar</p>
              </div>
              <button
                onClick={generateStory}
                className="flex items-center gap-2 px-4 py-2.5 bg-accent text-bg rounded-lg font-medium text-sm hover:opacity-90 transition-opacity"
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                </svg>
                Baixar PNG
              </button>
            </div>

            {/* Preview */}
            <div className="bg-card rounded-lg overflow-hidden" style={{ maxWidth: 270 }}>
              <div
                className="relative text-white p-5"
                style={{
                  background: 'linear-gradient(135deg, #0C1118 0%, #141C28 50%, #0C1118 100%)',
                  aspectRatio: '9/16',
                }}
              >
                <p className="font-display text-lg font-bold text-accent">Shelf</p>
                <p className="text-xs text-secondary mb-4">
                  {period === 'annual' ? `Wrap ${year}` : `${MONTHS[month - 1]} ${year}`}
                </p>
                <p className="font-display text-5xl font-bold">{data.total}</p>
                <p className="text-xs text-secondary mb-3">itens concluídos</p>
                {(['movie', 'series', 'game', 'book'] as MediaType[]).map((t) => {
                  const entry = data.byType.find((b) => b.type === t)
                  return (
                    <div key={t} className="flex items-center gap-2 mb-1.5">
                      <div
                        className="h-1.5 rounded-full flex-1"
                        style={{
                          background: TYPE_COLOR_HEX[t],
                          width: `${((entry?.count ?? 0) / Math.max(data.total, 1)) * 100}%`,
                          opacity: 0.85,
                        }}
                      />
                      <span className="text-[9px] text-secondary w-8 text-right">
                        {TYPE_EMOJI[t]} {entry?.count ?? 0}
                      </span>
                    </div>
                  )
                })}
                {data.dominantGenre && (
                  <p className="text-[10px] text-accent mt-3">🏷 {data.dominantGenre}</p>
                )}
                <p className="absolute bottom-3 inset-x-5 text-[8px] text-center" style={{ color: '#3A4E68' }}>
                  shelf · sua coleção pessoal
                </p>
              </div>
            </div>
          </div>
        </>
      ) : null}

      {/* Hidden canvas for generation */}
      <canvas ref={canvasRef} className="hidden" />
    </div>
  )
}
