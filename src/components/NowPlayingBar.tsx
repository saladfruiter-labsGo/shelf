import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { NowPlayingItem } from '../types'

const COLOR: Record<string, string> = {
  movie:  'var(--movies)',
  series: 'var(--series)',
  music:  'var(--music)',
}

const ROW_H = 46

function fmt(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`
}

/** Uma linha da barra — extrapola a posição entre polls quando há duração/posição (Plex). */
function NowPlayingRow({ item, source }: { item: NowPlayingItem; source: 'plex' | 'music' }) {
  const color = COLOR[item.media_type] ?? 'var(--accent)'
  const hasProgress = item.duration_ms != null && item.position_ms != null

  const [pos, setPos] = useState(item.position_ms ?? 0)
  const base = useRef({ ms: 0, at: 0, playing: false })

  useEffect(() => {
    if (item.position_ms == null) return
    base.current = { ms: item.position_ms, at: performance.now(), playing: item.state === 'playing' }
  }, [item.position_ms, item.state, item.title, item.updated_at])

  useEffect(() => {
    if (!hasProgress) return
    const dur = item.duration_ms!
    const tick = () => {
      const b = base.current
      const elapsed = b.playing ? performance.now() - b.at : 0
      setPos(Math.min(b.ms + elapsed, dur))
    }
    tick()
    const id = setInterval(tick, 250)
    return () => clearInterval(id)
  }, [hasProgress, item.duration_ms])

  const pct = hasProgress ? (pos / item.duration_ms!) * 100 : 0
  const label = source === 'plex'
    ? (item.state === 'paused' ? 'Pausado' : 'Assistindo')
    : 'Ouvindo'

  return (
    <div
      style={{
        position: 'relative',
        height: ROW_H, display: 'flex', alignItems: 'center', gap: 12,
        padding: '0 var(--page-x)',
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
          {label}
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

      {/* Tempo (quando há posição/duração) */}
      {hasProgress && (
        <span style={{
          fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums', flexShrink: 0,
        }}>
          {fmt(pos)} / {fmt(item.duration_ms!)}
        </span>
      )}

      {/* Barra de progresso na base */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: 0, height: 2, background: 'var(--border)' }}>
        {hasProgress ? (
          <div style={{ height: '100%', width: `${pct}%`, background: color, transition: 'width .25s linear' }} />
        ) : (
          // Sem posição (Last.fm): faixa indeterminada suave enquanto tocando
          item.state === 'playing' && <div className="np-indet" style={{ height: '100%', background: color }} />
        )}
      </div>
    </div>
  )
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

  const rows: { source: 'plex' | 'music'; item: NowPlayingItem }[] = []
  if (plex)  rows.push({ source: 'plex',  item: plex })
  if (music) rows.push({ source: 'music', item: music })

  // Empurra o conteúdo pra baixo conforme o número de linhas visíveis
  useEffect(() => {
    const root = document.documentElement
    root.style.setProperty('--npbar-h', `${rows.length * ROW_H}px`)
    return () => root.style.setProperty('--npbar-h', '0px')
  }, [rows.length])

  if (rows.length === 0) return null

  return (
    <div
      style={{
        position: 'fixed', top: 'var(--nav-h)', left: 0, right: 0, zIndex: 90,
        background: 'var(--surface)',
      }}
    >
      {rows.map(r => (
        <NowPlayingRow key={r.source} source={r.source} item={r.item} />
      ))}

      <style>{`
        @keyframes np-pulse-kf { 0%,100% { opacity: 1 } 50% { opacity: .3 } }
        .np-pulse { animation: np-pulse-kf 1.4s ease-in-out infinite; }
        @keyframes np-indet-kf { 0% { left: -35%; width: 35% } 60%,100% { left: 100%; width: 35% } }
        .np-indet { position: absolute; top: 0; left: -35%; width: 35%; animation: np-indet-kf 1.8s ease-in-out infinite; opacity: .7; }
      `}</style>
    </div>
  )
}
