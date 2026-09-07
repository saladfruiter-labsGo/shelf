import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { DiaryEntry } from '../types'
import { StoryModal } from '../components/StoryModal'
import { DiaryEntryModal, type DiaryEntryValues } from '../components/DiaryEntryModal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useIsMobile } from '../hooks/useIsMobile'
import type { StorySubject } from '../lib/story'

const TYPE_EMOJI: Record<string, string> = {
  game: '🎮', book: '📚', movie: '🎬', series: '📺', music: '🎵',
}

const CAT_STYLE: Record<string, { bg: string; color: string; label: string }> = {
  game:   { bg: 'var(--games-bg)',  color: 'var(--games)',  label: 'Jogo'   },
  book:   { bg: 'var(--books-bg)',  color: 'var(--books)',  label: 'Livro'  },
  movie:  { bg: 'var(--movies-bg)', color: 'var(--movies)', label: 'Filme'  },
  series: { bg: 'var(--series-bg)', color: 'var(--series)', label: 'Série'  },
  music:  { bg: 'var(--music-bg)',  color: 'var(--music)',  label: 'Música' },
}

function formatDiaryDate(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

function subjectOf(e: DiaryEntry): StorySubject {
  return {
    title: e.title, type: e.type, cover_url: e.cover_url,
    year: e.year, genre: e.genre, rating: e.rating ?? 0, comment: e.comment,
  }
}

export function Diary() {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const isMobile = useIsMobile()

  const [storyFor, setStoryFor]   = useState<DiaryEntry | null>(null)
  const [editing, setEditing]     = useState<DiaryEntry | null>(null)
  const [removing, setRemoving]   = useState<DiaryEntry | null>(null)

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['diary'],
    queryFn: () => api.diary.list(),
  })

  const updateMutation = useMutation({
    mutationFn: ({ id, values }: { id: number; values: DiaryEntryValues }) =>
      api.diary.update(id, {
        watched_at: values.watched_at,
        rating: values.rating > 0 ? values.rating : null,
        comment: values.comment || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diary'] })
      qc.invalidateQueries({ queryKey: ['media'] })
      setEditing(null)
    },
  })

  const removeMutation = useMutation({
    mutationFn: (id: number) => api.diary.remove(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['diary'] })
      setRemoving(null)
    },
  })

  return (
    <div style={{ background: 'var(--bg)', minHeight: '100vh' }}>
      <div style={{ padding: '80px var(--page-x) 48px', maxWidth: 860, margin: '0 auto' }}>
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: 'var(--dim)', marginBottom: 16 }}>
          Histórico
        </p>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(40px,5vw,64px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--text-primary)' }}>
          Diário
        </h1>
        <p style={{ marginTop: 16, fontSize: 15, color: 'var(--text-muted)' }}>
          {isLoading ? '…' : `${items.length} registro${items.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      <div style={{ maxWidth: 860, margin: '0 auto', padding: '0 var(--page-x) 80px' }}>
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ height: 72, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 96, height: 14, background: 'var(--card)', borderRadius: 4 }} />
              <div style={{ width: 36, height: 36, background: 'var(--card)', borderRadius: '50%' }} />
              <div style={{ flex: 1, height: 14, background: 'var(--card)', borderRadius: 4, maxWidth: 240 }} />
            </div>
          ))
        ) : items.length > 0 ? (
          items.map(entry => {
            const cat = CAT_STYLE[entry.type] ?? { bg: 'rgba(106,106,136,.1)', color: 'var(--text-muted)', label: entry.type }
            return (
              <div
                key={entry.id}
                className="row-fade diary-row"
                style={{
                  display: 'grid',
                  gridTemplateColumns: '96px 34px 1fr auto',
                  alignItems: 'center', gap: 14,
                  padding: '18px 0',
                  borderBottom: '1px solid var(--border)',
                }}
              >
                <span style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                  {formatDiaryDate(entry.watched_at)}
                </span>
                <span style={{ fontSize: 20, textAlign: 'center' }}>{TYPE_EMOJI[entry.type] ?? '📌'}</span>
                <div
                  onClick={() => navigate(`/media/${entry.media_item_id}`)}
                  style={{ cursor: 'pointer', minWidth: 0 }}
                >
                  <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                    {entry.title}
                    {entry.source === 'plex' && (
                      <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 600, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '.5px' }}>Plex</span>
                    )}
                  </p>
                  <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                    {entry.year ?? '—'}{entry.genre ? ` · ${entry.genre}` : ''}
                    {entry.rating && entry.rating > 0 ? ` · ★ ${entry.rating}` : ''}
                  </p>
                  {entry.comment && (
                    <p style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 4, fontStyle: 'italic', lineHeight: 1.4 }}>
                      “{entry.comment}”
                    </p>
                  )}
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, letterSpacing: '.5px', textTransform: 'uppercase', padding: '3px 8px', borderRadius: 4, background: cat.bg, color: cat.color, whiteSpace: 'nowrap' }}>
                    {cat.label}
                  </span>
                  {isMobile && (
                    <button onClick={() => setStoryFor(entry)} title="Gerar Story" className="diary-action">🎨</button>
                  )}
                  <button onClick={() => setEditing(entry)} title="Editar" className="diary-action">✎</button>
                  <button onClick={() => setRemoving(entry)} title="Remover" className="diary-action diary-action-danger">🗑</button>
                </div>
              </div>
            )
          })
        ) : (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, color: 'var(--border)', marginBottom: 12 }}>Vazio</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>Nenhum registro ainda</p>
          </div>
        )}
      </div>

      <StoryModal open={!!storyFor} subject={storyFor ? subjectOf(storyFor) : null} onClose={() => setStoryFor(null)} />

      <DiaryEntryModal
        open={!!editing}
        mode="edit"
        title={editing?.title ?? ''}
        subtitle="Editar registro"
        initial={editing ? { watched_at: editing.watched_at, rating: editing.rating ?? 0, comment: editing.comment ?? '' } : undefined}
        busy={updateMutation.isPending}
        onCancel={() => setEditing(null)}
        onSubmit={values => { if (editing) updateMutation.mutate({ id: editing.id, values }) }}
      />

      <ConfirmDialog
        open={!!removing}
        title="Remover registro"
        message={removing ? `Remover o registro de "${removing.title}" de ${formatDiaryDate(removing.watched_at)}? A mídia continua na biblioteca.` : ''}
        confirmLabel="Remover"
        danger
        busy={removeMutation.isPending}
        onCancel={() => setRemoving(null)}
        onConfirm={() => { if (removing) removeMutation.mutate(removing.id) }}
      />

      <style>{`
        .diary-action {
          background: none; border: none; cursor: pointer;
          font-size: 15px; line-height: 1; padding: 6px; border-radius: 8px;
          opacity: .55; transition: opacity .15s, background .15s;
        }
        .diary-action:hover { opacity: 1; background: var(--card); }
        .diary-action-danger:hover { background: rgba(220,60,60,.15); }
      `}</style>
    </div>
  )
}
