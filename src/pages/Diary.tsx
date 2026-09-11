import { useMemo, useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type { DiaryEntry } from '../types'
import { StoryModal } from '../components/StoryModal'
import { DiaryEntryModal, type DiaryEntryValues } from '../components/DiaryEntryModal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useIsMobile } from '../hooks/useIsMobile'
import { useMediaPreview } from '../components/MediaSummaryModal'
import type { StorySubject } from '../lib/story'
import { formatPlaytime } from '../lib/utils'

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

/**
 * Interpreta o watched_at. Strings só-data ("YYYY-MM-DD") são tratadas como
 * data LOCAL (evita o deslocamento de -1 dia ao renderizar em fusos negativos);
 * datetimes completos usam o parser nativo.
 */
function parseLocal(iso: string): Date {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/)
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
  return new Date(iso)
}

function formatDiaryDate(iso: string): string {
  return parseLocal(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' })
}

/** Chave de dia local (YYYY-MM-DD) para agrupar registros. */
function dayKey(iso: string): string {
  const d = parseLocal(iso)
  if (isNaN(d.getTime())) return iso.slice(0, 10)
  return new Date(d.getTime() - d.getTimezoneOffset() * 60_000).toISOString().slice(0, 10)
}

/** Cabeçalho de um grupo de dia: "sexta-feira, 08 de setembro de 2026". */
function formatDayHeader(iso: string): string {
  const s = parseLocal(iso).toLocaleDateString('pt-BR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })
  return s.charAt(0).toUpperCase() + s.slice(1)
}

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
]

type SortField = 'watched_at' | 'rating' | 'title' | 'year'
type SortDir = 'asc' | 'desc'

const SORT_LABEL: Record<SortField, string> = {
  watched_at: 'Data de execução',
  rating:     'Nota',
  title:      'Nome',
  year:       'Ano de lançamento',
}

function subjectOf(e: DiaryEntry): StorySubject {
  return {
    title: e.title, type: e.type, cover_url: e.cover_url,
    year: e.year, genre: e.genre, rating: e.rating ?? 0, comment: e.comment,
  }
}

function progressLabel(entry: DiaryEntry): string | null {
  if (entry.progress_value == null || !entry.progress_unit) return null
  if (entry.progress_unit === 'pages') {
    return `até a pág. ${entry.progress_value}${entry.progress_total ? ` / ${entry.progress_total}` : ''}`
  }
  return `${formatPlaytime(entry.progress_value)} acumulados`
}

export function Diary() {
  const { openMedia } = useMediaPreview()
  const qc = useQueryClient()
  const isMobile = useIsMobile()

  const [storyFor, setStoryFor]   = useState<DiaryEntry | null>(null)
  const [editing, setEditing]     = useState<DiaryEntry | null>(null)
  const [removing, setRemoving]   = useState<DiaryEntry | null>(null)

  // Filtros e ordenação
  const [nameQ, setNameQ]         = useState('')
  const [month, setMonth]         = useState('')   // '' = todos; '1'..'12'
  const [execYear, setExecYear]   = useState('')   // ano da execução (watched_at)
  const [releaseYear, setRelYear] = useState('')   // ano de lançamento (mídia)
  const [sortField, setSortField] = useState<SortField>('watched_at')
  const [sortDir, setSortDir]     = useState<SortDir>('desc')

  const { data: items = [], isLoading } = useQuery({
    queryKey: ['diary'],
    queryFn: () => api.diary.list(),
  })

  // Anos disponíveis para os selects (a partir dos registros)
  const { execYears, releaseYears } = useMemo(() => {
    const ex = new Set<number>()
    const rel = new Set<number>()
    for (const e of items) {
      const y = new Date(e.watched_at).getFullYear()
      if (!isNaN(y)) ex.add(y)
      if (e.year) rel.add(e.year)
    }
    return {
      execYears:    [...ex].sort((a, b) => b - a),
      releaseYears: [...rel].sort((a, b) => b - a),
    }
  }, [items])

  const filtered = useMemo(() => {
    const q = nameQ.trim().toLowerCase()
    const out = items.filter(e => {
      if (q && !e.title.toLowerCase().includes(q)) return false
      const d = new Date(e.watched_at)
      if (month && d.getMonth() + 1 !== Number(month)) return false
      if (execYear && d.getFullYear() !== Number(execYear)) return false
      if (releaseYear && e.year !== Number(releaseYear)) return false
      return true
    })
    const dir = sortDir === 'asc' ? 1 : -1
    out.sort((a, b) => {
      let cmp = 0
      switch (sortField) {
        case 'title':
          cmp = a.title.localeCompare(b.title, 'pt-BR')
          break
        case 'rating':
          cmp = (a.rating ?? 0) - (b.rating ?? 0)
          break
        case 'year':
          cmp = (a.year ?? 0) - (b.year ?? 0)
          break
        default: // watched_at
          cmp = new Date(a.watched_at).getTime() - new Date(b.watched_at).getTime()
      }
      if (cmp === 0) cmp = a.id - b.id
      return cmp * dir
    })
    return out
  }, [items, nameQ, month, execYear, releaseYear, sortField, sortDir])

  const hasFilters = !!(nameQ || month || execYear || releaseYear)
  const clearFilters = () => { setNameQ(''); setMonth(''); setExecYear(''); setRelYear('') }

  // Agrupa os registros já ordenados por dia (separadores orgânicos, dia a dia).
  const groups = useMemo(() => {
    const out: { key: string; label: string; entries: DiaryEntry[] }[] = []
    for (const e of filtered) {
      const key = dayKey(e.watched_at)
      const last = out[out.length - 1]
      if (last && last.key === key) last.entries.push(e)
      else out.push({ key, label: formatDayHeader(e.watched_at), entries: [e] })
    }
    return out
  }, [filtered])

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
      <div style={{ padding: '64px var(--page-x) 48px', maxWidth: 1280, margin: '0 auto' }}>
        <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2.5px', color: 'var(--dim)', marginBottom: 16 }}>
          Histórico
        </p>
        <h1 style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: 'clamp(40px,5vw,64px)', fontWeight: 800, letterSpacing: '-2px', lineHeight: 1, color: 'var(--text-primary)' }}>
          Diário
        </h1>
        <p style={{ marginTop: 16, fontSize: 15, color: 'var(--text-muted)' }}>
          {isLoading
            ? '…'
            : hasFilters
              ? `${filtered.length} de ${items.length} registro${items.length !== 1 ? 's' : ''}`
              : `${items.length} registro${items.length !== 1 ? 's' : ''}`}
        </p>
      </div>

      {/* Barra de filtros e ordenação */}
      {!isLoading && items.length > 0 && (
        <div
          className="diary-filters"
          style={{ maxWidth: 1280, margin: '0 auto', padding: '0 var(--page-x) 24px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}
        >
          <input
            value={nameQ}
            onChange={e => setNameQ(e.target.value)}
            placeholder="Buscar por nome…"
            className="diary-input"
            style={{ flex: '1 1 220px', minWidth: 180 }}
          />
          <select value={month} onChange={e => setMonth(e.target.value)} className="diary-input">
            <option value="">Mês (todos)</option>
            {MONTHS.map((m, i) => <option key={i} value={i + 1}>{m}</option>)}
          </select>
          <select value={execYear} onChange={e => setExecYear(e.target.value)} className="diary-input">
            <option value="">Ano de execução</option>
            {execYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>
          <select value={releaseYear} onChange={e => setRelYear(e.target.value)} className="diary-input">
            <option value="">Ano de lançamento</option>
            {releaseYears.map(y => <option key={y} value={y}>{y}</option>)}
          </select>

          <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginLeft: 'auto' }}>
            <span style={{ fontSize: 11, color: 'var(--dim)', textTransform: 'uppercase', letterSpacing: '1px' }}>Ordenar</span>
            <select value={sortField} onChange={e => setSortField(e.target.value as SortField)} className="diary-input">
              {(Object.keys(SORT_LABEL) as SortField[]).map(f => (
                <option key={f} value={f}>{SORT_LABEL[f]}</option>
              ))}
            </select>
            <button
              onClick={() => setSortDir(d => (d === 'asc' ? 'desc' : 'asc'))}
              className="diary-input diary-sortdir"
              title={sortDir === 'asc' ? 'Crescente' : 'Decrescente'}
            >
              {sortDir === 'asc' ? '↑' : '↓'}
            </button>
          </div>

          {hasFilters && (
            <button onClick={clearFilters} className="diary-input diary-clear">Limpar</button>
          )}
        </div>
      )}

      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 var(--page-x) 80px' }}>
        {isLoading ? (
          Array.from({ length: 6 }).map((_, i) => (
            <div key={i} style={{ height: 72, borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 16 }}>
              <div style={{ width: 96, height: 14, background: 'var(--card)', borderRadius: 4 }} />
              <div style={{ width: 36, height: 36, background: 'var(--card)', borderRadius: '50%' }} />
              <div style={{ flex: 1, height: 14, background: 'var(--card)', borderRadius: 4, maxWidth: 240 }} />
            </div>
          ))
        ) : groups.length > 0 ? (
          groups.map(group => (
            <section key={group.key} className="diary-group">
              {/* Separador de data — as mídias do dia ficam aninhadas abaixo */}
              <header className="diary-day">
                <span className="diary-day-bar" aria-hidden />
                <span className="diary-day-label">{group.label}</span>
                <span className="diary-day-count">
                  {group.entries.length} {group.entries.length === 1 ? 'registro' : 'registros'}
                </span>
              </header>

              <div className="diary-day-items">
                {group.entries.map(entry => {
                  const cat = CAT_STYLE[entry.type] ?? { bg: 'rgba(106,106,136,.1)', color: 'var(--text-muted)', label: entry.type }
                  return (
                    <div key={entry.id} className="row-fade diary-item">
                      <div
                        className="diary-item-cover"
                        onClick={() => openMedia(entry.media_item_id)}
                        role="button"
                        tabIndex={0}
                        aria-label={`Abrir resumo de ${entry.title}`}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMedia(entry.media_item_id) }
                        }}
                      >
                        {entry.cover_url
                          ? <img src={entry.cover_url} alt="" loading="lazy" />
                          : <span>{TYPE_EMOJI[entry.type] ?? '📌'}</span>}
                      </div>

                      <div
                        className="diary-item-main"
                        onClick={() => openMedia(entry.media_item_id)}
                        role="button"
                        tabIndex={0}
                        aria-label={`Abrir resumo de ${entry.title}`}
                        onKeyDown={event => {
                          if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); openMedia(entry.media_item_id) }
                        }}
                      >
                        <p className="diary-item-title">
                          {entry.title}
                          {entry.season_number != null && entry.episode_number != null && (
                            <span className="diary-item-ep">T{entry.season_number}E{entry.episode_number}</span>
                          )}
                          {entry.source === 'plex' && <span className="diary-item-plex">Plex</span>}
                        </p>
                        <p className="diary-item-meta">
                          {entry.year ?? '—'}{entry.genre ? ` · ${entry.genre}` : ''}
                          {progressLabel(entry) && <span> · {progressLabel(entry)}</span>}
                          {entry.rating && entry.rating > 0 && (
                            <span className="diary-item-rating"> · ★ {entry.rating}</span>
                          )}
                        </p>
                        {entry.comment && (
                          <p className="diary-item-comment">“{entry.comment}”</p>
                        )}
                      </div>

                      <div className="diary-item-side">
                        <span className="diary-item-tag" style={{ background: cat.bg, color: cat.color }}>
                          {cat.label}
                        </span>
                        <div className="diary-item-actions">
                          {isMobile && (
                            <button onClick={() => setStoryFor(entry)} title="Gerar Story" className="diary-action">🎨</button>
                          )}
                          <button onClick={() => setEditing(entry)} title="Editar" className="diary-action">✎</button>
                          <button onClick={() => setRemoving(entry)} title="Remover" className="diary-action diary-action-danger">🗑</button>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </section>
          ))
        ) : (
          <div style={{ textAlign: 'center', padding: '80px 0' }}>
            <p style={{ fontFamily: 'Space Grotesk, sans-serif', fontSize: '3rem', fontWeight: 800, color: 'var(--border)', marginBottom: 12 }}>Vazio</p>
            <p style={{ color: 'var(--text-muted)', fontSize: 14 }}>
              {hasFilters ? 'Nenhum registro para os filtros selecionados' : 'Nenhum registro ainda'}
            </p>
            {hasFilters && (
              <button onClick={clearFilters} className="diary-input diary-clear" style={{ marginTop: 16 }}>Limpar filtros</button>
            )}
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
        .diary-group { margin-bottom: 30px; }

        .diary-day {
          display: flex; align-items: center; gap: 12px;
          padding: 0 4px 12px;
          margin-bottom: 6px;
          border-bottom: 1px solid var(--border);
        }
        .diary-day-bar {
          width: 4px; height: 22px; border-radius: 999px;
          background: var(--accent); flex-shrink: 0;
        }
        .diary-day-label {
          font-family: 'Space Grotesk', sans-serif;
          font-size: 17px; font-weight: 700; letter-spacing: -.3px;
          color: var(--text-secondary);
        }
        .diary-day-count {
          margin-left: auto; flex-shrink: 0;
          font-size: 11px; font-weight: 600; letter-spacing: .2px;
          color: var(--text-muted); background: var(--card);
          padding: 4px 11px; border-radius: 999px;
        }

        .diary-day-items { display: flex; flex-direction: column; gap: 2px; }
        .diary-item {
          display: grid; grid-template-columns: 44px 1fr auto;
          align-items: center; gap: 14px;
          padding: 10px; border-radius: 12px;
          transition: background .15s;
        }
        .diary-item:hover { background: var(--card); }
        .diary-item-cover {
          width: 44px; height: 44px; border-radius: 9px; overflow: hidden;
          background: var(--card-hover); border: 1px solid var(--border);
          display: grid; place-items: center; font-size: 20px;
          cursor: pointer; flex-shrink: 0;
        }
        .diary-item-cover img { width: 100%; height: 100%; object-fit: cover; }
        .diary-item-main { min-width: 0; cursor: pointer; }
        .diary-item-title {
          font-family: 'Space Grotesk', sans-serif; font-size: 15px; font-weight: 600;
          color: var(--text-primary); line-height: 1.3;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .diary-item-ep { margin-left: 8px; font-size: 11px; font-weight: 700; color: var(--series); }
        .diary-item-plex {
          margin-left: 8px; font-size: 10px; font-weight: 600;
          color: var(--dim); text-transform: uppercase; letter-spacing: .5px;
        }
        .diary-item-meta { font-size: 12px; color: var(--text-muted); margin-top: 2px; }
        .diary-item-rating { color: var(--accent); font-weight: 600; }
        .diary-item-comment {
          font-size: 12px; color: var(--text-secondary); font-style: italic;
          margin-top: 3px; line-height: 1.4;
          overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        }
        .diary-item-side { display: flex; align-items: center; gap: 10px; }
        .diary-item-tag {
          font-size: 10px; font-weight: 600; letter-spacing: .5px; text-transform: uppercase;
          padding: 3px 8px; border-radius: 5px; white-space: nowrap;
        }
        .diary-item-actions { display: flex; align-items: center; gap: 4px; }

        .diary-action {
          background: none; border: none; cursor: pointer;
          font-size: 15px; line-height: 1; padding: 6px; border-radius: 8px;
          opacity: .55; transition: opacity .15s, background .15s;
        }
        .diary-action:hover { opacity: 1; background: var(--card); }
        .diary-action-danger:hover { background: rgba(220,60,60,.15); }

        .diary-input {
          background: var(--card); border: 1px solid var(--border);
          color: var(--text-primary); font-size: 13px;
          padding: 8px 12px; border-radius: 8px; outline: none;
          transition: border-color .15s;
        }
        .diary-input:hover { border-color: var(--border-strong, var(--dim)); }
        .diary-input:focus { border-color: var(--accent); }
        select.diary-input { cursor: pointer; }
        .diary-sortdir { cursor: pointer; font-weight: 700; padding: 8px 12px; }
        .diary-clear { cursor: pointer; color: var(--text-muted); }
        .diary-clear:hover { color: var(--text-primary); }
        @media (max-width: 640px) {
          .diary-filters { flex-direction: column; align-items: stretch !important; }
          .diary-filters > div { margin-left: 0 !important; }
        }
      `}</style>
    </div>
  )
}
