import { useParams, useNavigate, Navigate } from 'react-router-dom'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useState, useRef, useEffect } from 'react'
import { api } from '../lib/api'
import { CategoryTag } from '../components/CategoryTag'
import { StarRating } from '../components/StarRating'
import { SeriesSeasons } from '../components/SeriesSeasons'
import { DiaryEntryModal, type DiaryEntryValues } from '../components/DiaryEntryModal'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { AddToListDropdown } from '../components/AddToListDropdown'
import type { MediaStatus, TmdbMediaPreview } from '../types'
import { STATUS_LABEL, formatRuntime, formatDate, fmtRating } from '../lib/utils'
import { imageUrl } from '../lib/images'
import { diaryScope, diaryScopeText } from '../lib/diary'

const STATUSES: MediaStatus[] = ['wishlist', 'in_progress', 'completed', 'dropped']

function TmdbIdentificationDialog({
  open, currentTitle, tmdbId, preview, previewError, previewBusy, applyBusy,
  onTmdbIdChange, onPreview, onApply, onCancel,
}: {
  open: boolean
  currentTitle: string
  tmdbId: string
  preview: TmdbMediaPreview | null
  previewError: string | null
  previewBusy: boolean
  applyBusy: boolean
  onTmdbIdChange: (value: string) => void
  onPreview: () => void
  onApply: () => void
  onCancel: () => void
}) {
  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onCancel])

  if (!open) return null

  const validId = /^[1-9]\d*$/.test(tmdbId.trim())

  return (
    <div className="fixed inset-0 z-[300] flex items-center justify-center px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onCancel} />
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="tmdb-identification-title"
        className="relative w-full max-w-md bg-surface border border-border rounded-2xl shadow-2xl animate-scale-in p-6"
      >
        <p className="text-xs text-muted uppercase tracking-wide mb-1">Identificação manual</p>
        <h2 id="tmdb-identification-title" className="text-lg font-bold text-primary mb-2">Corrigir no TMDB</h2>
        <p className="text-sm text-secondary leading-relaxed mb-5">
          Informe o código da mídia no TMDB para substituir os dados atuais de “{currentTitle}”.
        </p>

        <label className="block text-xs text-muted uppercase tracking-wide mb-2" htmlFor="tmdb-id-input">
          ID do TMDB
        </label>
        <div className="flex gap-2 mb-3">
          <input
            id="tmdb-id-input"
            inputMode="numeric"
            value={tmdbId}
            onChange={event => onTmdbIdChange(event.target.value)}
            onKeyDown={event => { if (event.key === 'Enter' && validId) onPreview() }}
            placeholder="Ex.: 550"
            autoFocus
            className="flex-1 min-w-0 bg-card border border-border rounded-lg px-3 py-2 text-sm text-primary placeholder:text-muted outline-none focus:border-accent"
          />
          <button
            onClick={onPreview}
            disabled={!validId || previewBusy || applyBusy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-bg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {previewBusy ? 'Buscando…' : 'Prévia'}
          </button>
        </div>

        {previewError && <p className="text-sm text-red-400 mb-4">{previewError}</p>}

        {preview && (
          <div className="flex gap-3 p-3 mb-5 rounded-xl bg-card border border-border">
            <div className="w-16 h-24 flex-shrink-0 rounded-md overflow-hidden bg-surface">
              {preview.cover_url
                ? <img src={imageUrl(preview.cover_url, 320)!} alt="" className="w-full h-full object-cover" />
                : <div className="w-full h-full flex items-center justify-center text-2xl">{preview.type === 'movie' ? '🎬' : '📺'}</div>}
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted uppercase tracking-wide mb-1">
                {preview.type === 'movie' ? 'Filme' : 'Série'} · TMDB #{preview.tmdb_id}
              </p>
              <h3 className="font-semibold text-primary leading-tight">{preview.title}</h3>
              <p className="text-xs text-muted mt-1">
                {[preview.year, preview.genre].filter(Boolean).join(' · ') || 'Sem metadados adicionais'}
              </p>
              {preview.synopsis && <p className="text-xs text-secondary leading-relaxed mt-2 line-clamp-3">{preview.synopsis}</p>}
            </div>
          </div>
        )}

        <p className="text-xs text-muted leading-relaxed mb-6">
          A confirmação substitui título, capa e metadados desta mídia. Sua avaliação, status e histórico permanecem.
        </p>

        <div className="flex justify-end gap-2">
          <button
            onClick={onCancel}
            disabled={applyBusy}
            className="px-4 py-2 rounded-lg text-sm font-medium text-muted hover:text-primary border border-border hover:border-border-strong transition-colors disabled:opacity-60"
          >
            Cancelar
          </button>
          <button
            onClick={onApply}
            disabled={!preview || previewBusy || applyBusy}
            className="px-4 py-2 rounded-lg text-sm font-semibold bg-accent text-bg hover:opacity-90 transition-opacity disabled:opacity-50"
          >
            {applyBusy ? 'Salvando…' : 'Aplicar identificação'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main component ─────────────────────────────────────────────────
export function MediaDetail() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const qc = useQueryClient()

  const { data: item, isLoading } = useQuery({
    queryKey: ['media', id],
    queryFn: () => api.media.get(parseInt(id!)),
    enabled: !!id,
  })

  const [releaseInput, setReleaseInput] = useState('')
  const [editRelease, setEditRelease] = useState(false)
  const [completionOpen, setCompletionOpen] = useState(false)
  const [confirmRemove, setConfirmRemove] = useState(false)
  const [identificationOpen, setIdentificationOpen] = useState(false)
  const [tmdbIdInput, setTmdbIdInput] = useState('')
  const [tmdbPreview, setTmdbPreview] = useState<TmdbMediaPreview | null>(null)
  const [tmdbPreviewId, setTmdbPreviewId] = useState('')
  const [tmdbPreviewError, setTmdbPreviewError] = useState<string | null>(null)

  const { data: history = [] } = useQuery({
    queryKey: ['diary', 'media', id],
    queryFn: () => api.diary.list({ media_item_id: parseInt(id!) }),
    enabled: !!id,
  })

  const { data: details, isLoading: loadingDetails } = useQuery({
    queryKey: ['details', item?.type, item?.external_id],
    queryFn: async () => {
      const d = await api.details(item!.type, item!.external_id)
      qc.invalidateQueries({ queryKey: ['media', id] })
      return d
    },
    enabled: !!item && !item.synopsis && item.type !== 'music',
    staleTime: Infinity,
  })

  const synopsis = item?.synopsis ?? details?.synopsis
  const creators = item?.creators ?? details?.creators
  const author   = item?.author   ?? details?.author

  const updateMutation = useMutation({
    mutationFn: (data: Parameters<typeof api.media.update>[1]) =>
      api.media.update(parseInt(id!), data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', id] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
    },
  })

  const previewTmdbMutation = useMutation({
    mutationFn: (tmdbId: string) => api.media.previewTmdb(parseInt(id!), tmdbId),
    onSuccess: (preview, requestedId) => { setTmdbPreview(preview); setTmdbPreviewId(requestedId); setTmdbPreviewError(null) },
    onError: error => { setTmdbPreview(null); setTmdbPreviewError(error instanceof Error ? error.message : 'Não foi possível consultar o TMDB') },
  })

  const identifyTmdbMutation = useMutation({
    mutationFn: (tmdbId: string) => api.media.identifyTmdb(parseInt(id!), tmdbId),
    onSuccess: updated => {
      qc.setQueryData(['media', id], updated)
      qc.invalidateQueries({ queryKey: ['media', id] })
      qc.invalidateQueries({ queryKey: ['details', updated.type, updated.external_id] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
      if (updated.type === 'series') qc.invalidateQueries({ queryKey: ['series', updated.id] })
      setIdentificationOpen(false)
      setTmdbPreview(null)
      setTmdbPreviewId('')
    },
    onError: error => setTmdbPreviewError(error instanceof Error ? error.message : 'Não foi possível salvar a identificação'),
  })

  // Registrar conclusão → cria um registro no diário (que também marca a mídia
  // como concluída, guarda a data e aplica a nota).
  const completeMutation = useMutation({
    mutationFn: (values: DiaryEntryValues) =>
      api.diary.create({
        media_item_id: parseInt(id!),
        watched_at: values.watched_at,
        rating: values.rating > 0 ? values.rating : null,
        comment: values.comment || null,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media', id] })
      qc.invalidateQueries({ queryKey: ['diary'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      setCompletionOpen(false)
    },
  })

  const deleteMutation = useMutation({
    mutationFn: () => api.media.remove(parseInt(id!)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      qc.invalidateQueries({ queryKey: ['diary'] })
      navigate(-1)
    },
  })

  // Clicar em "Concluído" abre o modal de conclusão (data + nota + comentário).
  // Os demais status atualizam direto.
  const onStatusClick = (s: MediaStatus) => {
    if (s === 'completed') setCompletionOpen(true)
    else updateMutation.mutate({ status: s })
  }

  const openIdentification = () => {
    if (!item || (item.type !== 'movie' && item.type !== 'series')) return
    const currentId = item.tmdb_id ?? (/^\d+$/.test(item.external_id) ? item.external_id : '')
    setTmdbIdInput(currentId)
    setTmdbPreview(null)
    setTmdbPreviewId('')
    setTmdbPreviewError(null)
    previewTmdbMutation.reset()
    identifyTmdbMutation.reset()
    setIdentificationOpen(true)
  }

  if (isLoading) return (
    <div className="px-6 py-8 animate-pulse">
      <div className="h-4 bg-card rounded w-20 mb-6" />
      <div className="flex gap-8">
        <div className="w-48 aspect-[2/3] bg-card rounded-lg" />
        <div className="flex-1 space-y-3">
          {[80, 60, 40, 90, 50].map((w, i) => (
            <div key={i} className="h-4 bg-card rounded" style={{ width: `${w}%` }} />
          ))}
        </div>
      </div>
    </div>
  )

  if (!item) return <div className="px-6 py-8 text-muted">Item não encontrado.</div>

  // Jogos têm página própria (ST-G).
  if (item.type === 'game') return <Navigate to={`/games/${item.id}`} replace />

  return (
    <div className="px-6 py-8 max-w-3xl">
      <button onClick={() => navigate(-1)} className="text-muted hover:text-primary text-sm mb-6 flex items-center gap-1 transition-colors">
        ← Voltar
      </button>

      <div className="flex gap-6 md:gap-10">
        {/* Cover */}
        <div className="flex-shrink-0 w-40 md:w-52">
          <div className="w-full aspect-[2/3] rounded-lg overflow-hidden bg-card border border-border">
            {item.cover_url
              ? <img src={imageUrl(item.cover_url, 640)!} alt={item.title} className="w-full h-full object-cover" />
              : <div className="w-full h-full flex items-center justify-center text-muted text-4xl">
                  {item.type === 'movie' ? '🎬' : item.type === 'series' ? '📺' : item.type === 'music' ? '🎵' : '📚'}
                </div>
            }
          </div>
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <CategoryTag type={item.type} />
          <h1 className="font-display text-2xl md:text-3xl font-bold text-primary mt-2 mb-0.5 leading-tight">
            {item.title}
          </h1>
          <p className="text-muted text-sm mb-3">
            {[item.year, item.genre].filter(Boolean).join(' · ')}
          </p>

          {/* Rating */}
          <div className="mb-4">
            <p className="text-xs text-muted uppercase tracking-wide mb-1">Avaliação</p>
            <StarRating value={item.rating} size="lg" onChange={v => updateMutation.mutate({ rating: v })} />
          </div>

          {/* Status */}
          <div className="mb-4">
            <p className="text-xs text-muted uppercase tracking-wide mb-2">Status</p>
            <div className="flex flex-wrap gap-1.5">
              {STATUSES.map(s => (
                  <button
                    key={s}
                    onClick={() => onStatusClick(s)}
                    className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${
                      item.status === s ? 'bg-accent text-bg' : 'bg-card text-muted hover:text-primary border border-border'
                    }`}
                  >
                    {STATUS_LABEL[s]}
                  </button>
              ))}
            </div>
          </div>

          {/* Progresso de leitura (livros, via Kavita) */}
          {item.type === 'book' && item.progress != null && (
            <div className="mb-4">
              <p className="text-xs text-muted uppercase tracking-wide mb-1">Progresso</p>
              <div className="h-1.5 bg-card rounded-full overflow-hidden mb-1.5 max-w-xs">
                <div
                  className="h-full rounded-full transition-all"
                  style={{ width: `${Math.round(item.progress * 100)}%`, background: 'var(--books)' }}
                />
              </div>
              <p className="text-xs text-muted">
                {Math.round(item.progress * 100)}% lido
                {item.pages_total ? ` · ${item.pages_read ?? 0}/${item.pages_total} páginas` : ''}
              </p>
            </div>
          )}

          {/* Hype toggle */}
          <div className="mb-4 flex items-center gap-3">
            <button
              onClick={() => updateMutation.mutate({ hype: item.hype ? 0 : 1 })}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium border transition-colors ${
                item.hype
                  ? 'bg-accent-bg border-accent text-accent'
                  : 'bg-card border-border text-muted hover:text-primary'
              }`}
            >
              🔥 Hype
            </button>

            {/* Release date */}
            {editRelease ? (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={releaseInput}
                  onChange={e => setReleaseInput(e.target.value)}
                  className="bg-card border border-border rounded px-2 py-1 text-xs text-primary outline-none focus:border-accent"
                />
                <button
                  onClick={() => { updateMutation.mutate({ release_date: releaseInput || null as any }); setEditRelease(false) }}
                  className="text-xs text-accent hover:underline"
                >Salvar</button>
                <button onClick={() => setEditRelease(false)} className="text-xs text-muted hover:text-primary">×</button>
              </div>
            ) : (
              <button
                onClick={() => { setReleaseInput(item.release_date ?? ''); setEditRelease(true) }}
                className="text-xs text-muted hover:text-primary transition-colors"
              >
                {item.release_date ? `📅 ${formatDate(item.release_date)}` : '+ Data de lançamento'}
              </button>
            )}
          </div>

          {/* Runtime / author */}
          <div className="flex flex-wrap gap-4 mb-4 text-sm text-muted">
            {item.runtime && <span>⏱ {formatRuntime(item.runtime)}</span>}
            {author       && <span>✍ {author}</span>}
          </div>
        </div>
      </div>

      {/* Synopsis */}
      <div className="mt-6">
        {loadingDetails && !synopsis && (
          <div className="h-4 bg-card rounded w-3/4 animate-pulse mb-2" />
        )}
        {synopsis && (
          <div className="mb-6">
            <p className="text-xs text-muted uppercase tracking-wide mb-2">Sinopse</p>
            <p className="text-sm text-secondary leading-relaxed">{synopsis}</p>
          </div>
        )}

        {creators && (
          <div className="mb-6">
            <p className="text-xs text-muted uppercase tracking-wide mb-1">
              {item.type === 'movie' ? 'Direção' : item.type === 'series' ? 'Criação' : 'Editora'}
            </p>
            <p className="text-sm text-secondary">{creators}</p>
          </div>
        )}

      </div>

      {/* Temporadas e episódios (apenas séries) */}
      {item.type === 'series' && (
        <div className="mb-6">
          <p className="text-xs text-muted uppercase tracking-wide mb-2">Temporadas</p>
          <SeriesSeasons mediaId={item.id} />
        </div>
      )}

      {/* Histórico no diário */}
      {history.length > 0 && (
        <div className="mb-6">
          <p className="text-xs text-muted uppercase tracking-wide mb-2">
            Histórico no diário · {history.length}
          </p>
          <div className="border-t border-border">
            {history.map(entry => (
              <div key={entry.id} className="flex gap-4 py-3 border-b border-border">
                <span className="font-display text-xs text-muted whitespace-nowrap pt-0.5 w-24 flex-shrink-0">
                  {formatDate(entry.watched_at)}
                </span>
                <div className="min-w-0 flex-1">
                  {diaryScopeText(diaryScope(entry)) && (
                    <span className="text-xs font-bold mr-2" style={{ color: 'var(--series)' }}>
                      {diaryScopeText(diaryScope(entry))}
                    </span>
                  )}
                  {entry.rating != null && entry.rating > 0 && (
                    <span className="text-sm font-medium" style={{ color: 'var(--accent)' }}>
                      ★ {fmtRating(entry.rating)}
                    </span>
                  )}
                  {entry.comment && (
                    <p className="text-sm text-secondary italic leading-relaxed mt-0.5">
                      “{entry.comment}”
                    </p>
                  )}
                  {(entry.rating == null || entry.rating === 0) && !entry.comment && (
                    <span className="text-sm text-muted">Registrado</span>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Actions */}
      <div className="flex flex-wrap items-center gap-3 pt-4 border-t border-border">
        <AddToListDropdown itemId={item.id} />

        {(item.type === 'movie' || item.type === 'series') && (
          <button
            onClick={openIdentification}
            className="px-4 py-2 rounded-lg text-sm text-secondary border border-border hover:border-border-strong hover:text-primary transition-colors"
          >
            ⚑ Corrigir identificação
          </button>
        )}

        <button
          onClick={() => setConfirmRemove(true)}
          className="ml-auto text-xs text-muted hover:text-red-400 transition-colors"
          disabled={deleteMutation.isPending}
        >
          Remover da biblioteca
        </button>
      </div>

      {/* Modal de conclusão (registra no diário) */}
      <DiaryEntryModal
        open={completionOpen}
        mode="create"
        title={item.title}
        subtitle="Registrar conclusão"
        initial={{ rating: item.rating }}
        busy={completeMutation.isPending}
        onCancel={() => setCompletionOpen(false)}
        onSubmit={values => completeMutation.mutate(values)}
      />

      {/* Confirmação de remoção da biblioteca */}
      <ConfirmDialog
        open={confirmRemove}
        title="Remover da biblioteca"
        message={`Remover "${item.title}" e todos os seus registros do diário? Esta ação não pode ser desfeita.`}
        confirmLabel="Remover"
        danger
        busy={deleteMutation.isPending}
        onCancel={() => setConfirmRemove(false)}
        onConfirm={() => deleteMutation.mutate()}
      />

      <TmdbIdentificationDialog
        open={identificationOpen}
        currentTitle={item.title}
        tmdbId={tmdbIdInput}
        preview={tmdbPreviewId === tmdbIdInput.trim() ? tmdbPreview : null}
        previewError={tmdbPreviewError}
        previewBusy={previewTmdbMutation.isPending}
        applyBusy={identifyTmdbMutation.isPending}
        onTmdbIdChange={value => {
          setTmdbIdInput(value)
          setTmdbPreview(null)
          setTmdbPreviewId('')
          setTmdbPreviewError(null)
          previewTmdbMutation.reset()
        }}
        onPreview={() => previewTmdbMutation.mutate(tmdbIdInput.trim())}
        onApply={() => identifyTmdbMutation.mutate(tmdbPreview!.tmdb_id)}
        onCancel={() => {
          if (identifyTmdbMutation.isPending) return
          setIdentificationOpen(false)
          setTmdbPreview(null)
          setTmdbPreviewId('')
          setTmdbPreviewError(null)
        }}
      />
    </div>
  )
}
