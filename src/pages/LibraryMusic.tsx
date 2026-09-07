import { useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { api } from '../lib/api'

function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('pt-BR', {
    day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function formatDuration(ms: number | null): string | null {
  if (!ms || ms <= 0) return null
  const totalSeconds = Math.round(ms / 1000)
  const m = Math.floor(totalSeconds / 60)
  const s = totalSeconds % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export function LibraryMusic() {
  const navigate = useNavigate()

  // Cada execução (scrobble Plex/Last.fm) é o seu próprio registro — a
  // biblioteca de músicas é o histórico de execuções, não um item por faixa.
  const { data: rawEvents = [], isLoading } = useQuery({
    queryKey: ['integrations', 'activity', 'music'],
    queryFn: () => api.integrations.activity({ limit: 500, media_type: 'music' }),
  })

  const plays = rawEvents.filter(e => e.event_type === 'scrobble' || e.event_type === 'listen')

  return (
    <div style={{ background: 'var(--bg)', color: 'var(--text-primary)', minHeight: '100vh' }}>
      {/* Header */}
      <div style={{ padding: '64px var(--page-x) 48px', maxWidth: 1280, margin: '0 auto', display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <div>
          <button
            onClick={() => navigate('/library')}
            className="link-accent"
            style={{ fontSize: 12, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', marginBottom: 16, letterSpacing: '0.5px' }}
          >
            ← Biblioteca
          </button>
          <p style={{ fontSize: 11, fontWeight: 600, letterSpacing: '3px', textTransform: 'uppercase', color: 'var(--music)', marginBottom: 16 }}>
            Músicas
          </p>
          <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(40px,5vw,72px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--text-primary)' }}>
            Minhas músicas
          </h1>
        </div>
        <p style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 13, color: 'var(--text-muted)', paddingBottom: 8 }}>
          {plays.length} {plays.length === 1 ? 'execução' : 'execuções'}
        </p>
      </div>

      {/* List — one row per play */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 var(--page-x) 80px' }}>
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} style={{ height: 64, background: 'var(--card)', borderRadius: 8, margin: '4px -16px', marginBottom: 0, borderBottom: '1px solid var(--border)' }} />
            ))
          : plays.map(play => {
              const duration = formatDuration(play.duration_ms)
              return (
                <div
                  key={play.id}
                  className="row-hover"
                  style={{
                    display: 'grid', gridTemplateColumns: '48px 1fr auto auto',
                    alignItems: 'center', gap: 16, padding: '16px 16px',
                    borderBottom: '1px solid var(--border)', borderRadius: 8, margin: '0 -16px',
                  }}
                >
                  <div style={{
                    width: 48, height: 48, borderRadius: 8, background: 'var(--card)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    fontSize: 20, overflow: 'hidden', border: '1px solid var(--border)', flexShrink: 0,
                  }}>
                    {play.cover_url
                      ? <img src={play.cover_url} alt={play.title} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : '🎵'
                    }
                  </div>
                  <div style={{ minWidth: 0 }}>
                    <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {play.title}
                    </p>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {play.subtitle ?? '—'}
                    </p>
                  </div>
                  <span style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
                    {formatWhen(play.occurred_at)}
                  </span>
                  <span style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 12, color: 'var(--text-muted)', minWidth: 40, textAlign: 'right' }}>
                    {duration ?? '—'}
                  </span>
                </div>
              )
            })
        }

        {plays.length === 0 && !isLoading && (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, color: 'var(--border-strong)', marginBottom: 12 }}>Vazio</p>
            <p style={{ color: 'var(--text-muted)' }}>Nenhuma faixa ouvida ainda</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 13, marginTop: 8 }}>
              Conecte o Plex ou o Last.fm nos ajustes para registrar automaticamente o que você ouve.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
