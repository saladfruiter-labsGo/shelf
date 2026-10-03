import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api } from '../../lib/api'
import { useAuth } from '../../lib/auth'
import { imageUrl } from '../../lib/images'
import { CATEGORIES } from '../../lib/categories'
import { Avatar } from '../Avatar'
import type { MediaRef, SearchResult } from '../../types'

const MAX_IMAGES = 4
const MAX_REFS = 10
const emojiOf = (type: string) => CATEGORIES.find(c => c.key === type)?.emoji ?? '🎞️'

export interface ComposerValue { body: string; refs: MediaRef[]; images: File[] }

/** Busca de mídia para marcar (filmes, séries, jogos, livros). */
function MediaPicker({ onPick, onClose }: { onPick: (ref: MediaRef) => void; onClose: () => void }) {
  const [q, setQ] = useState('')
  const [debounced, setDebounced] = useState('')
  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(q.trim()), 350)
    return () => window.clearTimeout(t)
  }, [q])
  const { data, isFetching, error } = useQuery({
    queryKey: ['social-media-search', debounced],
    queryFn: () => api.search(debounced),
    enabled: debounced.length >= 2,
    staleTime: 5 * 60_000,
  })
  const results = (data?.results ?? []).slice(0, 8)
  return (
    <div className="social-popover" role="dialog" aria-label="Marcar mídia">
      <input
        autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Buscar filme, série, jogo ou livro…"
        onKeyDown={e => { if (e.key === 'Escape') onClose() }}
        className="w-full bg-card border border-border rounded-lg px-3 py-2 text-primary outline-none focus:border-accent" style={{ fontSize: 16 }}
      />
      <div className="mt-2 max-h-72 overflow-y-auto">
        {debounced.length < 2 && <p className="text-sm text-muted px-1 py-2">Digite ao menos 2 letras.</p>}
        {isFetching && <p className="text-sm text-muted px-1 py-2">Buscando…</p>}
        {error && <p className="text-sm text-movies px-1 py-2">{(error as Error).message}</p>}
        {!isFetching && debounced.length >= 2 && !results.length && !error && <p className="text-sm text-muted px-1 py-2">Nada encontrado.</p>}
        {results.map((r: SearchResult) => (
          <button key={`${r.type}:${r.external_id}`} type="button" className="social-result"
            onClick={() => onPick({ type: r.type, external_id: r.external_id, title: r.title, cover_url: r.cover_url, year: r.year })}>
            {r.cover_url
              ? <img src={imageUrl(r.cover_url, 80) ?? ''} alt="" width={32} height={48} className="rounded object-cover flex-shrink-0" style={{ width: 32, height: 48 }} />
              : <span className="w-8 h-12 rounded bg-card flex items-center justify-center flex-shrink-0" aria-hidden>{emojiOf(r.type)}</span>}
            <span className="min-w-0 text-left">
              <span className="block text-primary truncate" style={{ fontSize: 15 }}>{r.title}</span>
              <span className="block text-xs text-muted">{emojiOf(r.type)} {r.year ?? ''}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}

/**
 * Caixa de escrita do feed (posts e comentários): `@` sugere pessoas da
 * instância, "Marcar mídia" anexa obras como cartões, e posts aceitam até
 * quatro imagens (prints).
 */
export function Composer({
  placeholder, submitLabel = 'Publicar', allowImages = false, compact = false, autoFocus = false,
  initial, onSubmit, onCancel, allowEmpty = false, extraActions,
}: {
  placeholder: string
  submitLabel?: string
  allowImages?: boolean
  compact?: boolean
  autoFocus?: boolean
  initial?: Partial<ComposerValue>
  onSubmit: (value: ComposerValue) => Promise<void>
  onCancel?: () => void
  /** Permite enviar sem texto (ex.: mensagem que só leva um item anexado). */
  allowEmpty?: boolean
  /** Botões extras na barra de ações (ex.: anexar item da biblioteca). */
  extraActions?: React.ReactNode
}) {
  const { user } = useAuth()
  const [body, setBody] = useState(initial?.body ?? '')
  const [refs, setRefs] = useState<MediaRef[]>(initial?.refs ?? [])
  const [images, setImages] = useState<File[]>([])
  const [picker, setPicker] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mention, setMention] = useState<{ query: string; start: number } | null>(null)
  const [highlight, setHighlight] = useState(0)
  const textRef = useRef<HTMLTextAreaElement>(null)
  const fileRef = useRef<HTMLInputElement>(null)

  const { data: people = [] } = useQuery({ queryKey: ['users'], queryFn: api.users.list, staleTime: 5 * 60_000 })
  const suggestions = useMemo(() => {
    if (!mention) return []
    const q = mention.query.toLowerCase()
    return people
      .filter(p => p.id !== user.id && (p.username.startsWith(q) || p.display_name.toLowerCase().includes(q)))
      .slice(0, 6)
  }, [mention, people, user.id])

  const previews = useMemo(() => images.map(f => URL.createObjectURL(f)), [images])
  useEffect(() => () => previews.forEach(url => URL.revokeObjectURL(url)), [previews])

  // Cresce com o texto até um limite.
  useEffect(() => {
    const el = textRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 320)}px`
  }, [body])

  const detectMention = (value: string, caret: number) => {
    const before = value.slice(0, caret)
    const match = /(^|\s)@([a-z0-9._-]{0,32})$/i.exec(before)
    setMention(match ? { query: match[2], start: caret - match[2].length - 1 } : null)
    setHighlight(0)
  }

  const pickPerson = (username: string) => {
    if (!mention) return
    const el = textRef.current
    const caret = el?.selectionStart ?? body.length
    const next = `${body.slice(0, mention.start)}@${username} ${body.slice(caret)}`
    setBody(next)
    setMention(null)
    requestAnimationFrame(() => {
      const pos = mention.start + username.length + 2
      el?.focus()
      el?.setSelectionRange(pos, pos)
    })
  }

  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (suggestions.length) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setHighlight(h => (h + 1) % suggestions.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHighlight(h => (h - 1 + suggestions.length) % suggestions.length); return }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickPerson(suggestions[highlight].username); return }
      if (e.key === 'Escape') { setMention(null); return }
    }
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); submit() }
    if (e.key === 'Escape' && onCancel) onCancel()
  }

  const addImages = (files: FileList | null) => {
    if (!files) return
    const next = [...images, ...Array.from(files).filter(f => f.type.startsWith('image/'))]
    if (next.length > MAX_IMAGES) setError(`No máximo ${MAX_IMAGES} imagens por post.`)
    setImages(next.slice(0, MAX_IMAGES))
  }

  const submit = async () => {
    if (busy) return
    if (!allowEmpty && !body.trim() && !images.length && !refs.length) return setError('Escreva algo primeiro.')
    setBusy(true)
    setError(null)
    try {
      await onSubmit({ body: body.trim(), refs, images })
      setBody(''); setRefs([]); setImages([]); setPicker(false)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className={`social-composer ${compact ? 'is-compact' : ''}`}>
      {!compact && <Avatar name={user.display_name} url={user.avatar_url} id={user.id} size={40} />}
      <div className="flex-1 min-w-0 relative">
        <div className="relative">
        <textarea
          ref={textRef}
          value={body}
          autoFocus={autoFocus}
          rows={compact ? 1 : 2}
          placeholder={placeholder}
          aria-label={placeholder}
          onChange={e => { setBody(e.target.value); detectMention(e.target.value, e.target.selectionStart) }}
          onKeyDown={onKeyDown}
          onClick={e => detectMention(body, e.currentTarget.selectionStart)}
          className="w-full bg-card border border-border rounded-xl px-3 py-2.5 text-primary placeholder:text-muted outline-none focus:border-accent resize-none"
          style={{ fontSize: 16, lineHeight: 1.5 }}
        />
        {suggestions.length > 0 && (
          <ul role="listbox" aria-label="Mencionar" className="social-suggest">
            {suggestions.map((p, i) => (
              <li key={p.id} role="option" aria-selected={i === highlight}>
                <button type="button" onMouseDown={e => { e.preventDefault(); pickPerson(p.username) }}
                  className={`w-full flex items-center gap-2 px-3 py-2 text-left ${i === highlight ? 'bg-card-hover' : ''}`}>
                  <Avatar name={p.display_name} url={p.avatar_url} id={p.id} size={26} />
                  <span className="text-primary" style={{ fontSize: 15 }}>{p.display_name}</span>
                  <span className="text-muted text-sm">@{p.username}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
        </div>

        {refs.length > 0 && (
          <div className="flex flex-wrap gap-2 mt-2">
            {refs.map(r => (
              <span key={`${r.type}:${r.external_id}`} className="social-chip">
                {emojiOf(r.type)} {r.title}
                <button type="button" aria-label={`Remover ${r.title}`} className="ml-1 text-muted hover:text-primary"
                  onClick={() => setRefs(refs.filter(x => x !== r))}>×</button>
              </span>
            ))}
          </div>
        )}

        {previews.length > 0 && (
          <div className="flex gap-2 mt-2 flex-wrap">
            {previews.map((url, i) => (
              <div key={url} className="relative">
                <img src={url} alt="" className="w-20 h-20 object-cover rounded-lg border border-border" />
                <button type="button" aria-label="Remover imagem" onClick={() => setImages(images.filter((_, j) => j !== i))}
                  className="absolute -top-2 -right-2 w-6 h-6 rounded-full bg-surface border border-border-strong text-primary text-sm leading-none">×</button>
              </div>
            ))}
          </div>
        )}

        {error && <p role="alert" className="text-movies text-sm mt-2">{error}</p>}

        <div className="flex items-center gap-1 mt-2 flex-wrap">
          <button type="button" className="social-action" onClick={() => setPicker(p => !p)} aria-expanded={picker}
            disabled={refs.length >= MAX_REFS}>
            <span aria-hidden>🎬</span><span>Marcar mídia</span>
          </button>
          {allowImages && (
            <>
              <button type="button" className="social-action" onClick={() => fileRef.current?.click()} disabled={images.length >= MAX_IMAGES}>
                <span aria-hidden>🖼️</span><span>Imagem</span>
              </button>
              <input ref={fileRef} type="file" accept="image/*" multiple hidden onChange={e => { addImages(e.target.files); e.target.value = '' }} />
            </>
          )}
          {extraActions}
          <span className="flex-1" />
          {onCancel && (
            <button type="button" onClick={onCancel} className="px-3 py-1.5 text-sm text-muted hover:text-primary">Cancelar</button>
          )}
          <button type="button" onClick={submit} disabled={busy}
            className="px-4 py-1.5 rounded-lg bg-accent text-bg font-semibold hover:opacity-90 disabled:opacity-60" style={{ fontSize: 15 }}>
            {busy ? 'Enviando…' : submitLabel}
          </button>
        </div>

        {picker && (
          <MediaPicker
            onClose={() => setPicker(false)}
            onPick={ref => {
              if (!refs.some(r => r.type === ref.type && r.external_id === ref.external_id)) setRefs([...refs, ref].slice(0, MAX_REFS))
              setPicker(false)
            }}
          />
        )}
      </div>
    </div>
  )
}
