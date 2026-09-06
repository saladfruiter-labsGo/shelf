import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { NowPlayingItem } from '../types'

const COLOR: Record<string, string> = {
  movie:  'var(--movies)',
  series: 'var(--series)',
  music:  'var(--music)',
}

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

export function NowPlayingBar() {
  const { data } = useQuery({
    queryKey: ['now-playing'],
    queryFn: api.integrations.nowPlaying,
    refetchInterval: 5000,
    refetchIntervalInBackground: true,
  })

  const plex = data?.plex ?? null
  const music = data?.music ?? null
  const active = plex ?? music
  const showProgress = !!plex && plex.duration_ms != null && plex.position_ms != null

  // Extrapola a posição do Plex entre polls (barra andando suave)
  const [pos, setPos] = useState(0)
  const base = useRef({ ms: 0, at: 0, playing: false })

  useEffect(() => {
    if (!plex || plex.position_ms == null) return
    base.current = { ms: plex.position_ms, at: performance.now(), playing: plex.state === 'playing' }
  }, [plex?.position_ms, plex?.state, plex?.title, plex?.updated_at])

  useEffect(() => {
    if (!showProgress) return
    const dur = plex!.duration_ms!
    const tick = () => {
      const b = base.current
      const elapsed = b.playing ? performance.now() - b.at : 0
      setPos(Math.min(b.ms + elapsed, dur))
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [showProgress, plex?.duration_ms])

  // Empurra o conteúdo pra baixo enquanto a barra está visível
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--npbar-h', active ? '46px' : '0px')
    return () => root.style.setProperty('--npbar-h', '0px')
  }, [active])

  if (!active) return null

  const item: NowPlayingItem = active
  const color = COLOR[item.media_type] ?? 'var(--accent)'
  const pct = showProgress ? (pos / plex!.duration_ms!) * 100 : 0

  return (
    <div
      style={{
        position: 'fixed', top: 'var(--nav-h)', left: 0, right: 0, zIndex: 90,
        height: 46, display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 32px',
        background: 'var(--surface)',
        borderBottom: '1px solid var(--border)',
        overflow: 'hidden',
      }}
    >
      {/* Indicador de estado */}
      <span style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
        <span
          className={item.state === 'playing' ? 'np-pulse' : undefined}
          style={{ width: 8, height: 8, borderRadius: '50%', background: color, flexShrink: 0 }}
        />
        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color }}>
          {plex ? (item.state === 'paused' ? 'Pausado' : 'Assistindo') : 'Ouvindo'}
        </span>
      </span>

      {/* Capa */}
      {item.cover_url && (
        <img
          src={item.cover_url}
          alt=""
          style={{ height: 30, width: item.media_type === 'music' ? 30 : 20, objectFit: 'cover', borderRadius: 3, flexShrink: 0 }}
          onError={(e) => { (e.currentTarget.style.display = 'none') }}
        />
      )}

      {/* Título */}
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, minWidth: 0, flex: 1 }}>
        <span style={{
          fontSize: 13, fontWeight: 600, color: 'var(--text-primary)',
          whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '55%',
        }}>
          {item.title}
        </span>
        {item.subtitle && (
          <span style={{
            fontSize: 12, color: 'var(--text-muted)',
            whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
          }}>
            {item.subtitle}
          </span>
        )}
      </div>

      {/* Tempo (só Plex) */}
      {showProgress && (
        <span style={{
          fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          {fmt(pos)} / {fmt(plex!.duration_ms!)}
        </span>
      )}

      {/* Barra de progresso na base */}
      {showProgress && (
        <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'var(--border)' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width .25s linear' }} />
        </div>
      )}

      <style>{`
        @keyframes np-pulse-kf { 0%,100% { opacity: 1 } 50% { opacity: .3 } }
        .np-pulse { animation: np-pulse-kf 1.4s ease-in-out infinite; }
      `}</style>
    </div>
  )
}
