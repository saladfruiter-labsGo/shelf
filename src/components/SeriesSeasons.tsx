import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { SeriesView, SeriesSeason } from '../types'

const FONT = 'Space Grotesk, sans-serif'

function pct(v: number) { return Math.round(v * 100) }

/** Barra de progresso minimalista reutilizável. */
export function ProgressBar({ value, height = 4 }: { value: number; height?: number }) {
  return (
    <div style={{ height, background: 'var(--border)', borderRadius: 999, overflow: 'hidden', width: '100%' }}>
      <div style={{
        height: '100%', borderRadius: 999, background: 'var(--series)',
        width: `${pct(value)}%`, transition: 'width .4s ease',
      }} />
    </div>
  )
}

function SeasonRow({
  mediaId, season, onMutate,
}: {
  mediaId: number
  season: SeriesSeason
  onMutate: (data: SeriesView) => void
}) {
  const [open, setOpen] = useState(false)
  const qc = useQueryClient()

  const invalidate = () => {
    qc.invalidateQueries({ queryKey: ['media'] })
    qc.invalidateQueries({ queryKey: ['recent'] })
  }

  const toggleEp = useMutation({
    mutationFn: (v: { ep: number; watched: boolean }) =>
      api.series.toggleEpisode(mediaId, season.season_number, v.ep, v.watched),
    onSuccess: (data) => { onMutate(data); invalidate() },
  })
  const toggleSeason = useMutation({
    mutationFn: (watched: boolean) => api.series.toggleSeason(mediaId, season.season_number, watched),
    onSuccess: (data) => { onMutate(data); invalidate() },
  })

  const done = season.episode_count > 0 && season.watched_count >= season.episode_count
  const frac = season.episode_count > 0 ? season.watched_count / season.episode_count : 0
  const allWatched = season.episodes.length > 0 && season.episodes.every(e => e.watched)

  return (
    <div style={{ borderBottom: '1px solid var(--border)' }}>
      {/* Cabeçalho da temporada */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 4px' }}>
        <button
          onClick={() => setOpen(o => !o)}
          aria-label={open ? 'Recolher' : 'Expandir'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
            fontSize: 16, lineHeight: 1, padding: 4, transform: open ? 'rotate(90deg)' : 'none',
            transition: 'transform .2s ease', flexShrink: 0,
          }}
        >
          ▶
        </button>

        <button
          onClick={() => setOpen(o => !o)}
          style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', flex: 1, minWidth: 0 }}
        >
          <p style={{ fontFamily: FONT, fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', margin: 0 }}>
            {season.title || `Temporada ${season.season_number}`}
            {done && <span style={{ color: 'var(--series)', marginLeft: 8, fontSize: 14 }}>✓</span>}
          </p>
          <p style={{ fontFamily: FONT, fontSize: 13, color: 'var(--text-muted)', margin: '4px 0 0' }}>
            {season.watched_count}/{season.episode_count || season.episodes.length} episódios
          </p>
        </button>

        <div style={{ width: 90, flexShrink: 0 }}>
          <ProgressBar value={frac} />
        </div>

        <button
          onClick={() => toggleSeason.mutate(!allWatched)}
          disabled={toggleSeason.isPending || season.episodes.length === 0}
          style={{
            flexShrink: 0, fontFamily: FONT, fontSize: 12, fontWeight: 600, cursor: 'pointer',
            padding: '6px 12px', borderRadius: 999, border: '1px solid var(--border)',
            background: allWatched ? 'var(--series)' : 'transparent',
            color: allWatched ? '#fff' : 'var(--text-muted)',
            opacity: season.episodes.length === 0 ? 0.4 : 1,
          }}
        >
          {allWatched ? 'Vista' : 'Marcar tudo'}
        </button>
      </div>

      {/* Episódios (colapsados) */}
      {open && (
        <div style={{ padding: '0 4px 12px 32px' }}>
          {season.episodes.length === 0 ? (
            <p style={{ fontFamily: FONT, fontSize: 14, color: 'var(--text-muted)', padding: '4px 0' }}>
              Episódios ainda não catalogados.
            </p>
          ) : (
            season.episodes.map(ep => (
              <button
                key={ep.episode_number}
                onClick={() => toggleEp.mutate({ ep: ep.episode_number, watched: !ep.watched })}
                disabled={toggleEp.isPending}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12, width: '100%',
                  background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                  padding: '9px 8px', borderRadius: 8,
                }}
                className="episode-row"
              >
                <span style={{
                  flexShrink: 0, width: 22, height: 22, borderRadius: 6, display: 'grid', placeItems: 'center',
                  border: `1.5px solid ${ep.watched ? 'var(--series)' : 'var(--border-strong)'}`,
                  background: ep.watched ? 'var(--series)' : 'transparent',
                  color: '#fff', fontSize: 13,
                }}>
                  {ep.watched ? '✓' : ''}
                </span>
                <span style={{
                  fontFamily: FONT, fontSize: 13, color: 'var(--text-muted)', flexShrink: 0, width: 34,
                }}>
                  E{ep.episode_number}
                </span>
                <span style={{
                  fontFamily: FONT, fontSize: 16, flex: 1, minWidth: 0,
                  color: ep.watched ? 'var(--text-muted)' : 'var(--text-primary)',
                  textDecoration: ep.watched ? 'line-through' : 'none',
                  overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                }}>
                  {ep.title || `Episódio ${ep.episode_number}`}
                </span>
              </button>
            ))
          )}
        </div>
      )}
    </div>
  )
}

export function SeriesSeasons({ mediaId }: { mediaId: number }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['series', mediaId],
    queryFn: () => api.series.get(mediaId),
  })

  const setData = (v: SeriesView) => qc.setQueryData(['series', mediaId], v)

  if (isLoading) {
    return (
      <div style={{ padding: '8px 0' }}>
        {[0, 1, 2].map(i => (
          <div key={i} style={{ height: 56, background: 'var(--card)', borderRadius: 8, marginBottom: 8, opacity: 0.6 }} />
        ))}
      </div>
    )
  }

  if (!data || data.seasons.length === 0) {
    return (
      <p style={{ fontFamily: FONT, fontSize: 16, color: 'var(--text-muted)', padding: '16px 0' }}>
        Nenhuma temporada catalogada ainda. Assista a um episódio no Plex ou verifique a chave do TMDB.
      </p>
    )
  }

  return (
    <div>
      {/* Progresso geral */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <div style={{ flex: 1 }}><ProgressBar value={data.percent} height={5} /></div>
        <span style={{ fontFamily: FONT, fontSize: 13, fontWeight: 600, color: 'var(--series)', flexShrink: 0 }}>
          {pct(data.percent)}% · {data.watched}/{data.total}
        </span>
      </div>

      {data.seasons.map(s => (
        <SeasonRow key={s.season_number} mediaId={mediaId} season={s} onMutate={setData} />
      ))}

      <style>{`.episode-row:hover { background: var(--card-hover) !important; }`}</style>
    </div>
  )
}
