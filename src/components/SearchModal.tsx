import { useState, useEffect, useRef, useCallback } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from 'react-router-dom'
import { api } from '../lib/api'
import type { MediaStatus, MediaType, SearchResult, SeriesPreviewSeason } from '../types'
import { CategoryTag } from './CategoryTag'
import { StarRating } from './StarRating'
import { TYPE_LABEL, todayISODate } from '../lib/utils'

interface Props {
  open:    boolean
  onClose: () => void
}

type AddAction = 'seen' | 'watchlist' | 'diary'

interface AddOpts {
  action:   AddAction
  rating:   number
  date:     string                                              // YYYY-MM-DD (conclusão/registro; editável)
  comment:  string                                              // comentário do registro no diário (opcional)
  hours:    number                                              // games (opcional); 0 = não informado
  episodes: { season_number: number; episode_number: number }[] // séries
}

const TYPE_FILTERS: { label: string; value: MediaType; tag: string; emoji: string }[] = [
  { label: 'Filmes',  value: 'movie',  tag: '/filmes',  emoji: '🎬' },
  { label: 'Séries',  value: 'series', tag: '/series',  emoji: '📺' },
  { label: 'Jogos',   value: 'game',   tag: '/jogos',   emoji: '🎮' },
  { label: 'Livros',  value: 'book',   tag: '/livros',  emoji: '📚' },
]

const TAG_MAP: Record<string, MediaType> = {
  filmes: 'movie', filme: 'movie', movie: 'movie', movies: 'movie',
  series: 'series', serie: 'series', série: 'series', tv: 'series',
  jogos: 'game', jogo: 'game', game: 'game', games: 'game',
  livros: 'book', livro: 'book', book: 'book', books: 'book',
}

function parseInput(raw: string): { tagType: MediaType | null; q: string } {
  const m = raw.match(/^\/(\w+)\s*(.*)/)
  if (!m) return { tagType: null, q: raw }
  const tagType = TAG_MAP[m[1].toLowerCase()] ?? null
  return { tagType, q: m[2].trim() }
}

// ─── Confirmation panel ────────────────────────────────────────────────
interface ConfirmProps {
  result:    SearchResult
  onBack:    () => void
  onAdd:     (opts: AddOpts) => void
  isPending: boolean
}

const epKey = (s: number, e: number) => `${s}-${e}`

const CREATOR_LABEL: Record<MediaType, string> = {
  movie:  'Direção',
  series: 'Criação',
  game:   'Desenvolvedora',
  book:   'Editora',
  music:  'Artista',
}

/** Seletor de temporadas/episódios para séries (Série › Temporada › Episódio). */
function SeasonPicker({
  seasons, selected, onToggleEp, onToggleSeason,
}: {
  seasons:       SeriesPreviewSeason[]
  selected:      Set<string>
  onToggleEp:    (s: number, e: number) => void
  onToggleSeason: (season: SeriesPreviewSeason) => void
}) {
  const [open, setOpen] = useState<Set<number>>(() => new Set(seasons.length === 1 ? [seasons[0].season_number] : []))
  const toggleOpen = (n: number) => setOpen(prev => {
    const next = new Set(prev); next.has(n) ? next.delete(n) : next.add(n); return next
  })

  return (
    <div className="border border-border rounded-lg divide-y divide-border overflow-hidden">
      {seasons.map(season => {
        const keys    = season.episodes.map(ep => epKey(season.season_number, ep.episode_number))
        const selCount = keys.filter(k => selected.has(k)).length
        const allSel   = keys.length > 0 && selCount === keys.length
        const isOpen   = open.has(season.season_number)
        return (
          <div key={season.season_number}>
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button
                type="button"
                onClick={() => toggleOpen(season.season_number)}
                className="text-muted hover:text-primary text-xs w-4 flex-shrink-0 transition-transform"
                style={{ transform: isOpen ? 'rotate(90deg)' : 'none' }}
                aria-label={isOpen ? 'Recolher' : 'Expandir'}
              >▶</button>
              <button
                type="button"
                onClick={() => toggleOpen(season.season_number)}
                className="flex-1 min-w-0 text-left"
              >
                <p className="text-sm font-medium text-primary truncate">
                  {season.title || `Temporada ${season.season_number}`}
                </p>
                <p className="text-xs text-muted">{selCount}/{season.episodes.length || season.episode_count} selecionados</p>
              </button>
              <button
                type="button"
                onClick={() => onToggleSeason(season)}
                disabled={keys.length === 0}
                className={`flex-shrink-0 text-xs font-medium px-2.5 py-1 rounded-full border transition-colors ${
                  allSel ? 'bg-accent text-bg border-accent' : 'bg-card text-muted border-border hover:text-primary'
                } disabled:opacity-40`}
              >
                {allSel ? 'Tudo' : 'Marcar tudo'}
              </button>
            </div>

            {isOpen && (
              <div className="px-3 pb-2 pl-9">
                {season.episodes.length === 0 ? (
                  <p className="text-xs text-muted py-1">Episódios não catalogados.</p>
                ) : season.episodes.map(ep => {
                  const k = epKey(season.season_number, ep.episode_number)
                  const on = selected.has(k)
                  return (
                    <button
                      key={ep.episode_number}
                      type="button"
                      onClick={() => onToggleEp(season.season_number, ep.episode_number)}
                      className="flex items-center gap-2.5 w-full text-left py-1.5 hover:bg-card rounded px-1 transition-colors"
                    >
                      <span
                        className="flex-shrink-0 w-4 h-4 rounded grid place-items-center text-[10px] text-bg border"
                        style={{
                          borderColor: on ? 'var(--accent)' : 'var(--border-strong)',
                          background:  on ? 'var(--accent)' : 'transparent',
                        }}
                      >{on ? '✓' : ''}</span>
                      <span className="text-xs text-muted flex-shrink-0 w-7">E{ep.episode_number}</span>
                      <span className={`text-sm min-w-0 truncate ${on ? 'text-primary' : 'text-secondary'}`}>
                        {ep.title || `Episódio ${ep.episode_number}`}
                      </span>
                    </button>
                  )
                })}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}

function ConfirmPanel({ result, onBack, onAdd, isPending }: ConfirmProps) {
  const [rating, setRating]     = useState(0)
  const [date, setDate]         = useState(todayISODate())
  const [comment, setComment]   = useState('')
  const [hours, setHours]       = useState('')
  const [selected, setSelected] = useState<Set<string>>(() => new Set())
  const [pending, setPending]   = useState<AddAction | null>(null)

  const isSeries = result.type === 'series'
  const isGame   = result.type === 'game'

  const { data: preview, isFetching: loadingPreview } = useQuery({
    queryKey: ['series-preview', result.external_id],
    queryFn:  () => api.series.preview(result.external_id),
    enabled:  isSeries,
    staleTime: 5 * 60_000,
  })
  const seasons = preview?.seasons ?? []

  // Sinopse + diretor/criação: confirma visualmente que a mídia certa foi selecionada
  const { data: details } = useQuery({
    queryKey: ['details', result.type, result.external_id],
    queryFn:  () => api.details(result.type, result.external_id),
    staleTime: 5 * 60_000,
  })

  const toggleEp = (s: number, e: number) => setSelected(prev => {
    const next = new Set(prev); const k = epKey(s, e)
    next.has(k) ? next.delete(k) : next.add(k); return next
  })
  const toggleSeason = (season: SeriesPreviewSeason) => setSelected(prev => {
    const next = new Set(prev)
    const keys = season.episodes.map(ep => epKey(season.season_number, ep.episode_number))
    const allSel = keys.length > 0 && keys.every(k => next.has(k))
    for (const k of keys) allSel ? next.delete(k) : next.add(k)
    return next
  })

  const episodesPayload = () => [...selected].map(k => {
    const [s, e] = k.split('-').map(Number)
    return { season_number: s, episode_number: e }
  })

  const submit = (action: AddAction) => {
    setPending(action)
    onAdd({
      action,
      rating,
      date:    date || todayISODate(),
      comment: comment.trim(),
      hours:   hours.trim() ? Math.max(0, parseFloat(hours.replace(',', '.')) || 0) : 0,
      episodes: episodesPayload(),
    })
  }

  // Séries: "Visto"/"Diário" exigem ao menos um episódio marcado (o diário é sempre por episódio).
  const needsEpisodes = isSeries && selected.size === 0
  const emoji = TYPE_FILTERS.find(f => f.value === result.type)?.emoji

  const btnBusy = (a: AddAction) => isPending && pending === a

  return (
    <div className="p-4 max-h-[70vh] overflow-y-auto">
      {/* Selected item preview — imagem grande + sinopse/diretor para confirmar a escolha */}
      <div className="flex gap-3 mb-4 p-3 bg-card rounded-lg border border-border">
        <div className="w-20 h-28 flex-shrink-0 rounded overflow-hidden bg-surface border border-border">
          {result.cover_url
            ? <img src={result.cover_url} alt="" className="w-full h-full object-cover" />
            : <div className="w-full h-full flex items-center justify-center text-3xl text-muted">{emoji}</div>}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2">
            <p className="text-sm font-semibold text-primary leading-snug">{result.title}</p>
            <button onClick={onBack} className="text-muted hover:text-primary text-lg leading-none flex-shrink-0">←</button>
          </div>
          <p className="text-xs text-muted mt-0.5">
            {[result.year, details?.creators ? `${CREATOR_LABEL[result.type]}: ${details.creators}` : (result.author ? `${CREATOR_LABEL.book}: ${result.author}` : null)]
              .filter(Boolean).join(' · ')}
          </p>
          {details?.synopsis && (
            <p className="text-xs text-secondary mt-2 leading-relaxed line-clamp-4">{details.synopsis}</p>
          )}
        </div>
      </div>

      {/* Rating */}
      <div className="mb-4">
        <p className="text-xs text-muted uppercase tracking-wide mb-2">Avaliação <span className="text-dim normal-case">(opcional)</span></p>
        <StarRating value={rating} onChange={setRating} size="lg" />
      </div>

      {/* Data (conclusão / registro no diário — editável, permite dias anteriores) */}
      <div className="mb-4">
        <p className="text-xs text-muted uppercase tracking-wide mb-2">Data</p>
        <input
          type="date"
          value={date}
          max={todayISODate()}
          onChange={e => setDate(e.target.value)}
          className="bg-card border border-border rounded-md px-3 py-1.5 text-sm text-primary outline-none focus:border-accent w-full"
        />
      </div>

      {/* Comentário (vai para o registro no diário) */}
      <div className="mb-4">
        <p className="text-xs text-muted uppercase tracking-wide mb-2">Comentário <span className="text-dim normal-case">(opcional)</span></p>
        <textarea
          value={comment}
          onChange={e => setComment(e.target.value)}
          rows={2}
          placeholder="O que você achou?"
          className="bg-card border border-border rounded-md px-3 py-1.5 text-sm text-primary placeholder:text-muted outline-none focus:border-accent w-full resize-none"
        />
      </div>

      {/* Séries: seletor de temporadas/episódios */}
      {isSeries && (
        <div className="mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs text-muted uppercase tracking-wide">Episódios</p>
            {selected.size > 0 && <span className="text-xs text-accent">{selected.size} selecionado{selected.size !== 1 ? 's' : ''}</span>}
          </div>
          {loadingPreview ? (
            <div className="space-y-2">
              {[0, 1, 2].map(i => <div key={i} className="h-11 bg-card rounded-lg animate-pulse" />)}
            </div>
          ) : seasons.length === 0 ? (
            <p className="text-xs text-muted py-2">Não foi possível carregar as temporadas (verifique a chave do TMDB). Você ainda pode adicionar ao Backlog.</p>
          ) : (
            <>
              <SeasonPicker seasons={seasons} selected={selected} onToggleEp={toggleEp} onToggleSeason={toggleSeason} />
              <p className="text-[11px] text-dim mt-2">No diário, cada episódio marcado vira um registro próprio.</p>
            </>
          )}
        </div>
      )}

      {/* Games: horas jogadas (opcional) */}
      {isGame && (
        <div className="mb-4">
          <p className="text-xs text-muted uppercase tracking-wide mb-2">Horas jogadas <span className="text-dim normal-case">(opcional)</span></p>
          <input
            type="number"
            min={0}
            step="0.5"
            inputMode="decimal"
            value={hours}
            onChange={e => setHours(e.target.value)}
            placeholder="Ex.: 12"
            className="bg-card border border-border rounded-md px-3 py-1.5 text-sm text-primary placeholder:text-muted outline-none focus:border-accent w-full"
          />
        </div>
      )}

      {/* Ações */}
      <div className="flex gap-2 mb-2">
        <button
          onClick={() => submit('seen')}
          disabled={isPending || needsEpisodes}
          className="flex-1 py-2 rounded-lg text-sm font-semibold border border-border text-primary bg-card hover:border-border-strong transition-colors disabled:opacity-50"
          title={isSeries ? 'Marca os episódios como vistos na biblioteca, sem entrar no diário' : 'Adiciona à biblioteca sem registrar no diário'}
        >
          {btnBusy('seen') ? '...' : '✓ Visto'}
        </button>
        <button
          onClick={() => submit('watchlist')}
          disabled={isPending}
          className="flex-1 py-2 rounded-lg text-sm font-semibold border border-border text-primary bg-card hover:border-border-strong transition-colors disabled:opacity-50"
          title="Envia para o Backlog (quero ver/ouvir/ler/jogar depois)"
        >
          {btnBusy('watchlist') ? '...' : '♡ Backlog'}
        </button>
      </div>
      <button
        onClick={() => submit('diary')}
        disabled={isPending || needsEpisodes}
        className="w-full py-2 bg-accent text-bg rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-50"
        title="Registra no diário e adiciona à biblioteca"
      >
        {btnBusy('diary') ? 'Registrando...' : '✎ Registrar no Diário'}
      </button>
      {needsEpisodes && seasons.length > 0 && (
        <p className="text-[11px] text-dim mt-2 text-center">Selecione ao menos um episódio para "Visto" ou "Registrar no Diário".</p>
      )}
    </div>
  )
}

// ─── Main modal ────────────────────────────────────────────────────────
export function SearchModal({ open, onClose }: Props) {
  const [rawInput,    setRawInput]    = useState('')
  const [manualType,  setManualType]  = useState<MediaType | null>(null)
  const [debouncedQ,  setDebouncedQ]  = useState('')
  const [confirming,  setConfirming]  = useState<SearchResult | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const navigate  = useNavigate()
  const qc        = useQueryClient()

  const { tagType, q: cleanQ } = parseInput(rawInput)
  const activeType: MediaType | null = tagType ?? manualType

  useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(cleanQ), 350)
    return () => clearTimeout(t)
  }, [cleanQ])

  useEffect(() => {
    if (open) {
      setRawInput('')
      setDebouncedQ('')
      setManualType(null)
      setConfirming(null)
      setTimeout(() => inputRef.current?.focus(), 60)
    }
  }, [open])

  const handleKey = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (confirming) { setConfirming(null); return }
      onClose()
    }
  }, [onClose, confirming])
  useEffect(() => {
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [handleKey])

  const searchEnabled = debouncedQ.length >= 2

  const { data, isFetching } = useQuery({
    queryKey: ['search', debouncedQ, activeType],
    queryFn:  () => api.search(debouncedQ, activeType ?? undefined),
    enabled:  searchEnabled,
    staleTime: 30_000,
  })

  const addMutation = useMutation({
    mutationFn: async ({ result, action, rating, date, comment, hours, episodes }: { result: SearchResult } & AddOpts) => {
      const isSeries = result.type === 'series'
      const when     = date || todayISODate()
      const note     = comment.trim() ? comment.trim() : null

      // Status base: Backlog → wishlist; séries entram como "em andamento"
      // (os episódios marcados recomputam para "concluído" se completarem);
      // demais tipos vistos/registrados entram como "concluído".
      const status: MediaStatus =
        action === 'watchlist' ? 'wishlist'
        : isSeries             ? 'in_progress'
        : 'completed'

      const item = await api.media.add({
        external_id:  result.external_id,
        type:         result.type,
        title:        result.title,
        cover_url:    result.cover_url,
        year:         result.year,
        genre:        result.genre,
        runtime:      null,
        status,
        rating,
        notes:        null,
        synopsis:     null,
        creators:     null,
        author:       result.author,
        release_date: result.release_date,
        completed_at: (!isSeries && action !== 'watchlist') ? when : null,
      })

      // Games: horas jogadas (opcional) → playtime_seconds
      if (result.type === 'game' && action !== 'watchlist' && hours > 0) {
        await api.media.update(item.id, { playtime_seconds: Math.round(hours * 3600) })
      }

      // Séries: marca os episódios escolhidos (e registra no diário por episódio, se for o caso)
      if (isSeries && action !== 'watchlist' && episodes.length > 0) {
        await api.series.watchedBatch(item.id, {
          episodes,
          diary:      action === 'diary',
          watched_at: when,
          rating:     rating > 0 ? rating : null,
          comment:    action === 'diary' ? note : null,
        })
      }

      // Não-séries + "Registrar no Diário" → cria o registro no diário
      if (!isSeries && action === 'diary') {
        await api.diary.create({
          media_item_id: item.id,
          watched_at:    when,
          rating:        rating > 0 ? rating : null,
          comment:       note,
        })
      }

      return item
    },
    onSuccess: (item) => {
      qc.invalidateQueries({ queryKey: ['media'] })
      qc.invalidateQueries({ queryKey: ['recent'] })
      qc.invalidateQueries({ queryKey: ['upcoming'] })
      qc.invalidateQueries({ queryKey: ['diary'] })
      qc.invalidateQueries({ queryKey: ['series', item.id] })
      onClose()
      navigate(`/media/${item.id}`)
    },
  })

  const clearTag = () => {
    setRawInput(cleanQ)
    setManualType(null)
    inputRef.current?.focus()
  }

  const selectManual = (type: MediaType) => {
    if (tagType) setRawInput(cleanQ)
    setManualType(prev => prev === type ? null : type)
    inputRef.current?.focus()
  }

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-24 px-4">
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={onClose} />
      <div className="relative w-full max-w-xl bg-surface border border-border rounded-xl shadow-2xl animate-scale-in overflow-hidden">

        {/* Confirmation panel — replaces results */}
        {confirming ? (
          <ConfirmPanel
            result={confirming}
            onBack={() => setConfirming(null)}
            isPending={addMutation.isPending}
            onAdd={(opts) => addMutation.mutate({ result: confirming, ...opts })}
          />
        ) : (
          <>
            {/* Input row */}
            <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
              <svg className="w-5 h-5 text-muted flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>

              {tagType && (
                <span className="flex items-center gap-1 flex-shrink-0 bg-accent-bg text-accent text-xs px-2 py-1 rounded-full font-medium">
                  {TYPE_FILTERS.find(f => f.value === tagType)?.emoji} {TYPE_LABEL[tagType]}
                  <button onClick={clearTag} className="ml-1 leading-none hover:text-primary">×</button>
                </span>
              )}

              <input
                ref={inputRef}
                value={rawInput}
                onChange={e => setRawInput(e.target.value)}
                placeholder={
                  activeType
                    ? `Buscar ${TYPE_LABEL[activeType].toLowerCase()}s...`
                    : 'Buscar em todas as categorias...'
                }
                className="flex-1 bg-transparent text-primary placeholder:text-muted outline-none text-base min-w-0"
              />

              {isFetching && <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin flex-shrink-0" />}
              <kbd className="hidden sm:block text-xs text-muted bg-card px-1.5 py-0.5 rounded border border-border flex-shrink-0">Esc</kbd>
            </div>

            {/* Type selector */}
            <div className="flex gap-1 px-3 py-2 border-b border-border">
              {TYPE_FILTERS.map(f => {
                const active = activeType === f.value
                return (
                  <button
                    key={f.value}
                    onClick={() => selectManual(f.value)}
                    className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors ${
                      active ? 'bg-accent text-bg' : 'bg-card text-muted hover:text-primary'
                    }`}
                  >
                    {f.emoji} {f.label}
                  </button>
                )
              })}
            </div>

            {/* Results / hints */}
            <div className="max-h-80 overflow-y-auto">
              {debouncedQ.length < 2 ? (
                <div className="px-4 py-6">
                  <p className="text-xs text-muted uppercase tracking-wide mb-3">
                    {activeType ? 'Categoria selecionada' : 'Filtrar por categoria (opcional)'}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {TYPE_FILTERS.map(f => {
                      const active = activeType === f.value
                      return (
                        <button
                          key={f.value}
                          onClick={() => selectManual(f.value)}
                          className={`flex items-center gap-2 px-3 py-2.5 rounded-lg text-sm transition-colors text-left ${
                            active
                              ? 'bg-accent text-bg'
                              : 'bg-card text-secondary hover:text-primary hover:bg-card-hover'
                          }`}
                        >
                          <span className="text-lg">{f.emoji}</span>
                          <div>
                            <p className="font-medium">{f.label}</p>
                            <p className={`text-xs font-mono ${active ? 'text-bg/70' : 'text-muted'}`}>{f.tag}</p>
                          </div>
                        </button>
                      )
                    })}
                  </div>
                  <p className="text-center text-muted text-sm mt-4">
                    Digite para buscar{activeType ? ` ${TYPE_LABEL[activeType].toLowerCase()}s` : ' em todas as categorias'}...
                  </p>
                </div>
              ) : data?.results && data.results.length > 0 ? (
                <ul>
                  {data.results.map(result => (
                    <li key={`${result.type}-${result.external_id}`}>
                      <button
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-card transition-colors text-left"
                        onClick={() => setConfirming(result)}
                      >
                        <div className="w-10 h-14 flex-shrink-0 rounded overflow-hidden bg-card border border-border">
                          {result.cover_url
                            ? <img src={result.cover_url} alt="" className="w-full h-full object-cover" />
                            : <div className="w-full h-full flex items-center justify-center text-muted text-lg">
                                {TYPE_FILTERS.find(f => f.value === result.type)?.emoji}
                              </div>
                          }
                        </div>
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-primary truncate">{result.title}</p>
                          <div className="flex items-center gap-2 mt-1 flex-wrap">
                            <CategoryTag type={result.type} size="sm" />
                            {result.year && <span className="text-xs text-muted">{result.year}</span>}
                            {result.type === 'book' && result.author
                              ? <span className="text-xs text-muted truncate">{result.author}</span>
                              : result.genre
                              ? <span className="text-xs text-muted truncate">{result.genre}</span>
                              : null
                            }
                          </div>
                        </div>
                        <span className="text-xs text-accent flex-shrink-0">Selecionar →</span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : !isFetching ? (
                <p className="text-center text-muted text-sm py-8">Nenhum resultado para "{debouncedQ}"</p>
              ) : null}
            </div>
          </>
        )}
      </div>
    </div>
  )
}
