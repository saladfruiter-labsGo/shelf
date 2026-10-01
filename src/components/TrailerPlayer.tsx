import { useEffect, useRef, useState } from 'react'
import type HlsType from 'hls.js'
// O hls.js (~186 KB gzip) vai como arquivo estático e só é baixado ao apertar ▶:
// não entra no JS inicial nem em chunk de página.
import hlsModuleUrl from 'hls.js/dist/hls.min.mjs?url'
import { imageUrl } from '../lib/images'
import type { SteamStorePage } from '../types'

type Movie = SteamStorePage['movies'][number]

/**
 * Trailer da Steam. A Steam entrega quase tudo em HLS, que só o Safari toca
 * nativamente; nos outros navegadores o hls.js é carregado sob demanda (arquivo
 * estático, só quando alguém aperta ▶). MP4/WebM de fichas antigas tocam
 * direto. Sem formato tocável — ou se o vídeo falhar — a capa leva à loja.
 */
export function TrailerPlayer({ movie, poster, storeUrl }: { movie: Movie; poster: string | null; storeUrl: string }) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const hlsRef = useRef<HlsType | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'playing' | 'failed'>('idle')
  const image = imageUrl(poster ?? movie.thumbnail, 1024)
  const playable = !!(movie.hls || movie.mp4 || movie.webm)

  useEffect(() => () => { hlsRef.current?.destroy(); hlsRef.current = null }, [])

  async function start() {
    const video = videoRef.current
    if (!video) return
    setState('loading')
    try {
      if (movie.mp4 || movie.webm) {
        video.src = (movie.mp4 ?? movie.webm)!
      } else if (movie.hls && video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = movie.hls
      } else if (movie.hls) {
        const { default: Hls } = await import(/* @vite-ignore */ hlsModuleUrl) as typeof import('hls.js')
        if (!Hls.isSupported()) throw new Error('HLS não suportado')
        const hls = new Hls({ capLevelToPlayerSize: true })
        hlsRef.current = hls
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) { hls.destroy(); hlsRef.current = null; setState('failed') }
        })
        hls.loadSource(movie.hls)
        hls.attachMedia(video)
      }
      await video.play()
      setState('playing')
    } catch {
      setState(s => (s === 'playing' ? s : 'failed'))
    }
  }

  if (!playable || state === 'failed') {
    return (
      <a href={storeUrl} target="_blank" rel="noopener noreferrer" aria-label={`Assistir ${movie.name} na Steam`}
        className="block rounded-xl overflow-hidden border border-border hover:border-border-strong transition-colors"
        style={{ position: 'relative', aspectRatio: '16/9', background: '#000' }}>
        {image && <img src={image} alt="" loading="lazy" style={{ width: '100%', height: '100%', objectFit: 'cover', opacity: 0.75 }} />}
        <span style={{ position: 'absolute', left: 12, bottom: 10, right: 12, color: '#fff', fontSize: 14, fontWeight: 600, textShadow: '0 1px 4px rgba(0,0,0,.8)' }}>
          {state === 'failed' ? 'Não deu para tocar aqui · ' : ''}{movie.name} · assistir na Steam ↗
        </span>
      </a>
    )
  }

  return (
    <figure style={{ margin: 0 }}>
      <div style={{ position: 'relative', aspectRatio: '16/9', borderRadius: 10, overflow: 'hidden', background: '#000' }}>
        <video ref={videoRef} controls={state === 'playing'} preload="none" playsInline poster={image ?? undefined}
          style={{ width: '100%', height: '100%', display: 'block' }} />
        {state !== 'playing' && (
          <button type="button" onClick={start} disabled={state === 'loading'} aria-label={`Assistir ${movie.name}`}
            style={{ position: 'absolute', inset: 0, background: 'transparent', border: 'none', cursor: state === 'loading' ? 'progress' : 'pointer' }}>
            <span aria-hidden="true" style={{
              position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)',
              width: 68, height: 68, borderRadius: '50%', background: 'rgba(0,0,0,.65)', color: '#fff',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, border: '1px solid rgba(255,255,255,.4)',
            }}>
              {state === 'loading' ? '…' : '▶'}
            </span>
          </button>
        )}
      </div>
      <figcaption className="text-sm text-muted mt-2">{movie.name}</figcaption>
    </figure>
  )
}
