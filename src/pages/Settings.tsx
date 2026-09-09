import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { timeAgo } from '../lib/utils'

interface ApiEntry {
  key: string
  label: string
  description: string
  docsUrl: string
  placeholder: string
}

const API_ENTRIES: ApiEntry[] = [
  {
    key: 'TMDB_API_KEY',
    label: 'TMDB API Key',
    description: 'Usada para buscar filmes e séries. Gratuita após criar uma conta.',
    docsUrl: 'https://www.themoviedb.org/settings/api',
    placeholder: 'eyJhbGciOiJIUzI1NiJ9...',
  },
  {
    key: 'RAWG_API_KEY',
    label: 'RAWG API Key',
    description: 'Usada para buscar jogos. Gratuita, sem necessidade de OAuth.',
    docsUrl: 'https://rawg.io/apidocs',
    placeholder: 'abc123def456...',
  },
  {
    key: 'GOOGLE_BOOKS_KEY',
    label: 'Google Books API Key',
    description: 'Usada para buscar livros. Opcional — funciona sem chave com limite menor.',
    docsUrl: 'https://developers.google.com/books/docs/v1/using#APIKey',
    placeholder: 'AIzaSyB...',
  },
]

function maskKey(val: string): string {
  if (!val || val.length <= 8) return val
  return val.slice(0, 4) + '•'.repeat(Math.min(val.length - 8, 20)) + val.slice(-4)
}

export function Settings() {
  const qc = useQueryClient()

  const { data: saved = {} } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  })

  const [form, setForm] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    setForm(saved)
  }, [saved])

  const mutation = useMutation({
    mutationFn: api.settings.update,
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data)
      setForm(data)
      setToast({ msg: 'Configurações salvas!', ok: true })
      setTimeout(() => setToast(null), 3000)
    },
    onError: () => {
      setToast({ msg: 'Erro ao salvar. Tente novamente.', ok: false })
      setTimeout(() => setToast(null), 3000)
    },
  })

  const handleSave = () => {
    const toSave: Record<string, string> = {}
    for (const entry of API_ENTRIES) {
      toSave[entry.key] = form[entry.key] ?? ''
    }
    mutation.mutate(toSave)
  }

  return (
    <div className="px-6 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-primary mb-1">Configurações</h1>
        <p className="text-muted text-sm">Gerencie as chaves de API para busca de mídias</p>
      </div>

      <div className="space-y-4">
        {API_ENTRIES.map((entry) => {
          const currentVal = form[entry.key] ?? ''
          const savedVal   = saved[entry.key] ?? ''
          const isConfigured = !!savedVal
          const show = visible[entry.key] ?? false

          return (
            <div key={entry.key} className="bg-surface border border-border rounded-xl p-5">
              {/* Header */}
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-medium text-primary text-sm">{entry.label}</h2>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      isConfigured
                        ? 'bg-games-bg text-games'
                        : 'bg-card text-muted'
                    }`}
                  >
                    {isConfigured ? 'Configurada' : 'Não configurada'}
                  </span>
                </div>
                <a
                  href={entry.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline"
                >
                  Obter chave →
                </a>
              </div>

              <p className="text-xs text-muted mb-3">{entry.description}</p>

              {/* Input */}
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={currentVal}
                  onChange={(e) => setForm((f) => ({ ...f, [entry.key]: e.target.value }))}
                  placeholder={isConfigured ? maskKey(savedVal) : entry.placeholder}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2.5 pr-10 text-sm text-primary placeholder:text-muted outline-none focus:border-accent transition-colors font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setVisible((v) => ({ ...v, [entry.key]: !v[entry.key] }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors"
                  tabIndex={-1}
                >
                  {show ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Clear button */}
              {isConfigured && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, [entry.key]: '' }))}
                  className="mt-1.5 text-xs text-muted hover:text-red-400 transition-colors"
                >
                  Remover chave
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Save */}
      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={mutation.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-accent text-bg rounded-lg font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {mutation.isPending ? (
            <div className="w-4 h-4 border-2 border-bg border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          Salvar configurações
        </button>

        {toast && (
          <span className={`text-sm animate-fade-in ${toast.ok ? 'text-games' : 'text-movies'}`}>
            {toast.ok ? '✓' : '✕'} {toast.msg}
          </span>
        )}
      </div>

      {/* Info box */}
      <div className="mt-8 bg-card border border-border rounded-xl p-4 text-xs text-muted space-y-1">
        <p className="font-medium text-secondary">Sobre as chaves de API</p>
        <p>As chaves são armazenadas no banco de dados local da aplicação. Elas nunca saem do seu servidor.</p>
        <p>Você também pode configurá-las via variáveis de ambiente no arquivo <code className="bg-surface px-1 py-0.5 rounded font-mono">.env</code>. As chaves salvas aqui têm prioridade.</p>
      </div>

      {/* ─── Integrações ─── */}
      <IntegrationsSection />
    </div>
  )
}

/* ══════════════════════════════ Integrações ══════════════════════════════ */

const inputCls =
  'w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-primary placeholder:text-muted outline-none focus:border-accent transition-colors'

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      onClick={() => onChange(!on)}
      className={`relative w-10 h-6 rounded-full transition-colors ${on ? 'bg-accent' : 'bg-card border border-border'}`}
      aria-pressed={on}
    >
      <span
        className="absolute top-0.5 w-5 h-5 rounded-full bg-bg transition-transform"
        style={{ left: 2, transform: on ? 'translateX(16px)' : 'translateX(0)' }}
      />
    </button>
  )
}

type ActivityLike = { source: string; media_type: string; event_type: string; rating: number | null }

function activityEmoji(ev: ActivityLike): string {
  if (ev.source === 'kavita') return '📖'
  if (ev.source === 'lastfm') return '🎵'
  if (ev.source === 'playnite' || ev.media_type === 'game') return '🎮'
  return ev.media_type === 'movie' ? '🎬' : '📺'
}

function activityLabel(ev: ActivityLike): string {
  if (ev.event_type === 'rate') return `Avaliou ${ev.rating}★`
  if (ev.event_type === 'read' || ev.event_type === 'scrobble' || ev.event_type === 'played') return 'Concluído'
  if (ev.event_type === 'reading') return 'Lendo'
  if (ev.event_type === 'playing') return 'Jogando'
  return 'Ouviu'
}

function IntegrationsSection() {
  const qc = useQueryClient()
  const { data: status } = useQuery({ queryKey: ['integrations'], queryFn: api.integrations.status })
  const { data: stats } = useQuery({ queryKey: ['music-stats'], queryFn: api.integrations.musicStats })
  const { data: activity = [] } = useQuery({
    queryKey: ['integration-activity'],
    queryFn: () => api.integrations.activity({ limit: 15 }),
    refetchInterval: 10000,
  })

  const [form, setForm] = useState<Record<string, string | boolean>>({})
  const [copied, setCopied] = useState(false)
  const [msg, setMsg] = useState('')

  useEffect(() => {
    if (!status) return
    setForm({
      plex_enabled: status.plex.enabled,
      plex_url: status.plex.url,
      plex_user: status.plex.user,
      plex_token: '',
      lastfm_enabled: status.lastfm.enabled,
      lastfm_api_key: '',
      lastfm_user: status.lastfm.user,
      telegram_enabled: status.telegram.enabled,
      telegram_bot_token: '',
      telegram_chat_id: status.telegram.chat_id,
      telegram_thread_id: status.telegram.thread_id,
      kavita_enabled: status.kavita.enabled,
      kavita_url: status.kavita.url,
      kavita_api_key: '',
      kavita_library_id: status.kavita.library_id,
      playnite_enabled: status.playnite.enabled,
      itad_enabled: status.prices.enabled,
      itad_api_key: '',
      itad_country: status.prices.country,
    })
  }, [status])

  const save = useMutation({
    mutationFn: () => {
      const payload: Record<string, unknown> = {
        plex_enabled: form.plex_enabled,
        plex_url: form.plex_url,
        plex_user: form.plex_user,
        lastfm_enabled: form.lastfm_enabled,
        lastfm_user: form.lastfm_user,
        telegram_enabled: form.telegram_enabled,
        telegram_chat_id: form.telegram_chat_id,
        telegram_thread_id: form.telegram_thread_id,
        kavita_enabled: form.kavita_enabled,
        kavita_url: form.kavita_url,
        kavita_library_id: form.kavita_library_id,
        playnite_enabled: form.playnite_enabled,
        itad_enabled: form.itad_enabled,
        itad_country: form.itad_country,
      }
      if (form.plex_token)   payload.plex_token   = form.plex_token
      if (form.lastfm_api_key) payload.lastfm_api_key = form.lastfm_api_key
      if (form.telegram_bot_token) payload.telegram_bot_token = form.telegram_bot_token
      if (form.kavita_api_key) payload.kavita_api_key = form.kavita_api_key
      if (form.itad_api_key)   payload.itad_api_key   = form.itad_api_key
      return api.integrations.update(payload)
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      setForm(f => ({ ...f, plex_token: '', lastfm_api_key: '', kavita_api_key: '', itad_api_key: '' }))
      setMsg('Integrações salvas!')
      setTimeout(() => setMsg(''), 3000)
    },
  })

  const sync = useMutation({
    mutationFn: api.integrations.lastfmSync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integration-activity'] })
      qc.invalidateQueries({ queryKey: ['music-stats'] })
      setMsg('Sincronizado com o Last.fm.')
      setTimeout(() => setMsg(''), 3000)
    },
  })

  const kavitaSync = useMutation({
    mutationFn: api.integrations.kavitaSync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integration-activity'] })
      setMsg('Sincronizado com o Kavita.')
      setTimeout(() => setMsg(''), 3000)
    },
    onError: (e: unknown) => { setMsg('Falha ao sincronizar: ' + ((e as Error).message || '')); setTimeout(() => setMsg(''), 4000) },
  })
  const kavitaTest = useMutation({
    mutationFn: api.integrations.kavitaTest,
    onSuccess: () => { setMsg('Conexão com o Kavita OK!'); setTimeout(() => setMsg(''), 3000) },
    onError: (e: unknown) => { setMsg('Falha no teste: ' + ((e as Error).message || '')); setTimeout(() => setMsg(''), 4000) },
  })
  const itadTest = useMutation({
    mutationFn: api.integrations.itadTest,
    onSuccess: (d) => { setMsg(`Conexão com o IsThereAnyDeal OK! ${d.shops ?? 0} lojas ativas na região.`); setTimeout(() => setMsg(''), 4000) },
    onError: (e: unknown) => { setMsg('Falha no teste: ' + ((e as Error).message || '')); setTimeout(() => setMsg(''), 4000) },
  })
  const itadSync = useMutation({
    mutationFn: api.integrations.itadSync,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['integrations'] })
      qc.invalidateQueries({ queryKey: ['prices'] })
      setMsg('Preços do backlog sincronizados.')
      setTimeout(() => setMsg(''), 3000)
    },
    onError: (e: unknown) => { setMsg('Falha ao sincronizar: ' + ((e as Error).message || '')); setTimeout(() => setMsg(''), 4000) },
  })

  const [playniteCopied, setPlayniteCopied] = useState(false)
  const playniteTest = useMutation({
    mutationFn: api.integrations.playniteTest,
    onSuccess: () => { setMsg('Busca de capas (RAWG) OK! Os jogos vão vir com capa.'); setTimeout(() => setMsg(''), 3000) },
    onError: (e: unknown) => { setMsg('Aviso: ' + ((e as Error).message || '')); setTimeout(() => setMsg(''), 5000) },
  })

  const [detected, setDetected] = useState<{ chat_id: string; thread_id: string; name: string }[]>([])
  const test = useMutation({
    mutationFn: api.integrations.telegramTest,
    onSuccess: () => { setMsg('Mensagem de teste enviada no Telegram!'); setTimeout(() => setMsg(''), 3000) },
    onError: (e: unknown) => { setMsg('Falha no teste: ' + ((e as Error).message || '')); setTimeout(() => setMsg(''), 4000) },
  })
  const detect = useMutation({
    mutationFn: api.integrations.telegramDetectChat,
    onSuccess: (d) => {
      setDetected(d.chats)
      if (d.chats.length === 1) setForm(f => ({ ...f, telegram_chat_id: d.chats[0].chat_id, telegram_thread_id: d.chats[0].thread_id }))
    },
  })

  const playniteWebhookUrl = status
    ? `${window.location.origin}/api/integrations/playnite/webhook?token=${status.playnite.webhook_secret}`
    : ''

  const webhookUrl = status
    ? `${window.location.origin}/api/integrations/plex/webhook?token=${status.plex.webhook_secret}`
    : ''

  const set = (k: string) => (v: string | boolean) => setForm(f => ({ ...f, [k]: v }))

  return (
    <div className="mt-12">
      <div className="mb-6">
        <h2 className="font-display text-2xl font-bold text-primary mb-1">Integrações</h2>
        <p className="text-muted text-sm">Monitore automaticamente o que você assiste no Plex, ouve no YouTube Music, lê no Kavita e joga no Playnite</p>
      </div>

      {/* ── Plex ── */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 18 }}>🎬</span>
            <h3 className="font-medium text-primary text-sm">Plex</h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${status?.plex.token_set ? 'bg-games-bg text-games' : 'bg-card text-muted'}`}>
              {status?.plex.token_set ? 'Conectado' : 'Não conectado'}
            </span>
          </div>
          <Toggle on={!!form.plex_enabled} onChange={set('plex_enabled')} />
        </div>

        <p className="text-xs text-muted mb-4">
          Registra em tempo real o que foi assistido até o fim (<code className="bg-card px-1 rounded">media.scrobble</code>) e as notas dadas (<code className="bg-card px-1 rounded">media.rate</code>).
          A URL do servidor e o token habilitam a barra "assistindo agora".
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-secondary mb-1 block">URL do servidor Plex</label>
            <input className={inputCls} placeholder="http://192.168.0.10:32400"
              value={String(form.plex_url ?? '')} onChange={e => set('plex_url')(e.target.value)} spellCheck={false} />
          </div>
          <div>
            <label className="text-xs text-secondary mb-1 block">X-Plex-Token</label>
            <input className={inputCls + ' font-mono'} type="password" autoComplete="off"
              placeholder={status?.plex.token_set ? status.plex.token_masked : 'seu token do Plex'}
              value={String(form.plex_token ?? '')} onChange={e => set('plex_token')(e.target.value)} spellCheck={false} />
            <a href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/"
               target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent hover:underline">Como obter o token →</a>
          </div>
          <div>
            <label className="text-xs text-secondary mb-1 block">Usuário Plex <span className="text-muted">(opcional — filtra só a sua atividade)</span></label>
            <input className={inputCls} placeholder="deixe vazio para registrar tudo"
              value={String(form.plex_user ?? '')} onChange={e => set('plex_user')(e.target.value)} spellCheck={false} />
          </div>
        </div>

        {/* Webhook URL */}
        <div className="mt-4">
          <label className="text-xs text-secondary mb-1 block">URL do Webhook <span className="text-muted">(cole em Plex → Configurações → Webhooks)</span></label>
          <div className="flex gap-2">
            <input readOnly className={inputCls + ' font-mono text-xs'} value={webhookUrl} onFocus={e => e.currentTarget.select()} />
            <button type="button"
              onClick={() => { navigator.clipboard.writeText(webhookUrl); setCopied(true); setTimeout(() => setCopied(false), 1500) }}
              className="px-3 py-2 bg-card border border-border rounded-lg text-xs text-primary hover:border-accent transition-colors whitespace-nowrap">
              {copied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
          <p className="text-[11px] text-muted mt-1">Requer Plex Pass. O token na URL evita registros falsos.</p>
        </div>
      </div>

      {/* ── Last.fm / YouTube Music ── */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 18 }}>🎵</span>
            <h3 className="font-medium text-primary text-sm">YouTube Music <span className="text-muted font-normal">via Last.fm</span></h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${status?.lastfm.api_key_set ? 'bg-games-bg text-games' : 'bg-card text-muted'}`}>
              {status?.lastfm.api_key_set ? 'Conectado' : 'Não conectado'}
            </span>
          </div>
          <Toggle on={!!form.lastfm_enabled} onChange={set('lastfm_enabled')} />
        </div>

        <p className="text-xs text-muted mb-4">
          Registra as músicas ouvidas até o fim (sem nota). Requer um scrobbler enviando o YouTube Music para o Last.fm
          (ex.: extensão web-scrobbler). O Shelf lê seu histórico e calcula horas e gêneros.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-secondary mb-1 block">Last.fm API Key</label>
            <input className={inputCls + ' font-mono'} type="password" autoComplete="off"
              placeholder={status?.lastfm.api_key_set ? status.lastfm.api_key_masked : 'sua API key do Last.fm'}
              value={String(form.lastfm_api_key ?? '')} onChange={e => set('lastfm_api_key')(e.target.value)} spellCheck={false} />
            <a href="https://www.last.fm/api/account/create" target="_blank" rel="noopener noreferrer" className="text-[11px] text-accent hover:underline">Criar API key →</a>
          </div>
          <div>
            <label className="text-xs text-secondary mb-1 block">Usuário Last.fm</label>
            <input className={inputCls} placeholder="seu_usuario"
              value={String(form.lastfm_user ?? '')} onChange={e => set('lastfm_user')(e.target.value)} spellCheck={false} />
          </div>
        </div>

        {/* Stats de música */}
        {stats && stats.plays > 0 && (
          <div className="mt-4 grid grid-cols-3 gap-2">
            <div className="bg-card rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted">Reproduções</p>
              <p className="font-display text-xl font-bold text-primary">{stats.plays}</p>
            </div>
            <div className="bg-card rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted">Horas ouvidas</p>
              <p className="font-display text-xl font-bold text-primary">{stats.hours}h</p>
            </div>
            <div className="bg-card rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted">Gênero top</p>
              <p className="font-display text-sm font-bold text-primary truncate mt-1.5">{stats.top_genres[0]?.genre ?? '—'}</p>
            </div>
          </div>
        )}

        <button type="button" onClick={() => sync.mutate()} disabled={sync.isPending || !status?.lastfm.api_key_set}
          className="mt-4 text-xs px-3 py-2 bg-card border border-border rounded-lg text-primary hover:border-accent transition-colors disabled:opacity-50">
          {sync.isPending ? 'Sincronizando…' : '↻ Sincronizar agora'}
        </button>
      </div>

      {/* ── Telegram ── */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 18 }}>📨</span>
            <h3 className="font-medium text-primary text-sm">Telegram</h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${status?.telegram.bot_token_set ? 'bg-games-bg text-games' : 'bg-card text-muted'}`}>
              {status?.telegram.bot_token_set ? 'Conectado' : 'Não conectado'}
            </span>
          </div>
          <Toggle on={!!form.telegram_enabled} onChange={set('telegram_enabled')} />
        </div>

        <p className="text-xs text-muted mb-4">
          Recebe no Telegram as atividades da sua biblioteca — adicionado, concluído, abandonado e notas.
          Só filmes, séries, games e livros. Crie um bot com o <a href="https://t.me/BotFather" target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">@BotFather</a> e cole o token abaixo.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-secondary mb-1 block">Bot Token</label>
            <input className={inputCls + ' font-mono'} type="password" autoComplete="off"
              placeholder={status?.telegram.bot_token_set ? status.telegram.bot_token_masked : '123456789:AA...'}
              value={String(form.telegram_bot_token ?? '')} onChange={e => set('telegram_bot_token')(e.target.value)} spellCheck={false} />
          </div>
          <div>
            <label className="text-xs text-secondary mb-1 block">Chat ID</label>
            <div className="flex gap-2">
              <input className={inputCls} placeholder="seu chat ID"
                value={String(form.telegram_chat_id ?? '')} onChange={e => set('telegram_chat_id')(e.target.value)} spellCheck={false} />
              <button type="button" onClick={() => detect.mutate()} disabled={detect.isPending || !status?.telegram.bot_token_set}
                className="px-3 py-2 bg-card border border-border rounded-lg text-xs text-primary hover:border-accent transition-colors whitespace-nowrap disabled:opacity-50">
                {detect.isPending ? '…' : 'Detectar'}
              </button>
            </div>
            <p className="text-[11px] text-muted mt-1">Salve o token, mande uma mensagem ao bot (dentro do tópico, se for grupo em modo fórum) e clique em Detectar.</p>
            {detected.length > 0 && (
              <div className="flex flex-wrap gap-2 mt-2">
                {detected.map(ch => (
                  <button key={`${ch.chat_id}:${ch.thread_id}`} type="button"
                    onClick={() => setForm(f => ({ ...f, telegram_chat_id: ch.chat_id, telegram_thread_id: ch.thread_id }))}
                    className="text-[11px] px-2 py-1 bg-card border border-border rounded-lg text-primary hover:border-accent transition-colors">
                    {ch.name} <span className="text-muted">({ch.chat_id}{ch.thread_id ? `/${ch.thread_id}` : ''})</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <label className="text-xs text-secondary mb-1 block">Tópico <span className="text-muted">(opcional — só para grupos em modo fórum)</span></label>
            <input className={inputCls} placeholder="ID do tópico (message_thread_id)"
              value={String(form.telegram_thread_id ?? '')} onChange={e => set('telegram_thread_id')(e.target.value)} spellCheck={false} />
          </div>
        </div>

        <button type="button" onClick={() => test.mutate()} disabled={test.isPending || !status?.telegram.bot_token_set || !status?.telegram.chat_id}
          className="mt-4 text-xs px-3 py-2 bg-card border border-border rounded-lg text-primary hover:border-accent transition-colors disabled:opacity-50">
          {test.isPending ? 'Enviando…' : '✈ Enviar teste'}
        </button>
        <p className="text-[11px] text-muted mt-2">O teste usa a configuração já salva — salve antes de testar.</p>
      </div>

      {/* ── Kavita ── */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 18 }}>📖</span>
            <h3 className="font-medium text-primary text-sm">Kavita <span className="text-muted font-normal">livros</span></h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${status?.kavita.api_key_set ? 'bg-games-bg text-games' : 'bg-card text-muted'}`}>
              {status?.kavita.api_key_set ? 'Conectado' : 'Não conectado'}
            </span>
          </div>
          <Toggle on={!!form.kavita_enabled} onChange={set('kavita_enabled')} />
        </div>

        <p className="text-xs text-muted mb-4">
          Lê seu progresso de leitura no Kavita e registra livros como <b>em andamento</b> ou <b>concluídos</b> automaticamente
          (com a nota, quando você avalia lá). Verifica a cada minuto. Gere a API key em <span className="text-secondary">Kavita → Configurações → Conta → Chaves de API</span>.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-secondary mb-1 block">URL do servidor Kavita</label>
            <input className={inputCls} placeholder="http://192.168.0.10:5000"
              value={String(form.kavita_url ?? '')} onChange={e => set('kavita_url')(e.target.value)} spellCheck={false} />
          </div>
          <div>
            <label className="text-xs text-secondary mb-1 block">API Key</label>
            <input className={inputCls + ' font-mono'} type="password" autoComplete="off"
              placeholder={status?.kavita.api_key_set ? status.kavita.api_key_masked : 'sua API key do Kavita'}
              value={String(form.kavita_api_key ?? '')} onChange={e => set('kavita_api_key')(e.target.value)} spellCheck={false} />
          </div>
          <div>
            <label className="text-xs text-secondary mb-1 block">ID da biblioteca <span className="text-muted">(opcional — deixe vazio para todas)</span></label>
            <input className={inputCls} placeholder="ex.: 1 — só importa dessa biblioteca"
              value={String(form.kavita_library_id ?? '')} onChange={e => set('kavita_library_id')(e.target.value)} spellCheck={false} />
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button type="button" onClick={() => kavitaTest.mutate()} disabled={kavitaTest.isPending || !status?.kavita.api_key_set}
            className="text-xs px-3 py-2 bg-card border border-border rounded-lg text-primary hover:border-accent transition-colors disabled:opacity-50">
            {kavitaTest.isPending ? 'Testando…' : '⚡ Testar conexão'}
          </button>
          <button type="button" onClick={() => kavitaSync.mutate()} disabled={kavitaSync.isPending || !status?.kavita.api_key_set}
            className="text-xs px-3 py-2 bg-card border border-border rounded-lg text-primary hover:border-accent transition-colors disabled:opacity-50">
            {kavitaSync.isPending ? 'Sincronizando…' : '↻ Sincronizar agora'}
          </button>
        </div>
        <p className="text-[11px] text-muted mt-2">O teste usa a config salva — salve antes de testar.</p>
      </div>

      {/* ── Playnite ── */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 18 }}>🎮</span>
            <h3 className="font-medium text-primary text-sm">Playnite <span className="text-muted font-normal">games</span></h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${status?.playnite.enabled ? 'bg-games-bg text-games' : 'bg-card text-muted'}`}>
              {status?.playnite.enabled ? 'Ativo' : 'Inativo'}
            </span>
          </div>
          <Toggle on={!!form.playnite_enabled} onChange={set('playnite_enabled')} />
        </div>

        <p className="text-xs text-muted mb-4">
          Ao fechar um jogo, a extensão do Playnite envia o <b>tempo jogado</b>, o <b>status</b> (jogando/concluído) e a <b>nota</b>
          para o Shelf. A capa e o gênero são buscados automaticamente pela RAWG. Instale a extensão <code className="bg-card px-1 rounded">ShelfSync</code> no PC de jogos e cole a URL abaixo nas configurações dela.
        </p>

        {/* Webhook URL */}
        <div>
          <label className="text-xs text-secondary mb-1 block">URL do Webhook <span className="text-muted">(cole em Playnite → extensão ShelfSync)</span></label>
          <div className="flex gap-2">
            <input readOnly className={inputCls + ' font-mono text-xs'} value={playniteWebhookUrl} onFocus={e => e.currentTarget.select()} />
            <button type="button"
              onClick={() => { navigator.clipboard.writeText(playniteWebhookUrl); setPlayniteCopied(true); setTimeout(() => setPlayniteCopied(false), 1500) }}
              className="px-3 py-2 bg-card border border-border rounded-lg text-xs text-primary hover:border-accent transition-colors whitespace-nowrap">
              {playniteCopied ? '✓ Copiado' : 'Copiar'}
            </button>
          </div>
          <p className="text-[11px] text-muted mt-1">O token na URL evita registros falsos. Ative o toggle e salve para o Shelf aceitar os envios.</p>
        </div>

        <button type="button" onClick={() => playniteTest.mutate()} disabled={playniteTest.isPending}
          className="mt-4 text-xs px-3 py-2 bg-card border border-border rounded-lg text-primary hover:border-accent transition-colors disabled:opacity-50">
          {playniteTest.isPending ? 'Testando…' : '⚡ Testar busca de capas'}
        </button>
      </div>

      {/* ── IsThereAnyDeal (preços do backlog) ── */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <span style={{ fontSize: 18 }}>🏷️</span>
            <h3 className="font-medium text-primary text-sm">IsThereAnyDeal <span className="text-muted font-normal">preços</span></h3>
            <span className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${status?.prices.api_key_set ? 'bg-games-bg text-games' : 'bg-card text-muted'}`}>
              {status?.prices.api_key_set ? 'Conectado' : 'Não conectado'}
            </span>
          </div>
          <Toggle on={!!form.itad_enabled} onChange={set('itad_enabled')} />
        </div>

        <p className="text-xs text-muted mb-4">
          Acompanha o preço dos <b>jogos de PC no backlog</b> nas lojas que atendem à região configurada, com melhor oferta,
          menor preço histórico e gráfico na página do jogo. Verifica a cada 6 horas. A chave nunca é enviada ao navegador.
        </p>

        <div className="space-y-3">
          <div>
            <label className="text-xs text-secondary mb-1 block">API Key</label>
            <input className={inputCls + ' font-mono'} type="password" autoComplete="off"
              placeholder={status?.prices.api_key_set ? status.prices.api_key_masked : 'sua API key do IsThereAnyDeal'}
              value={String(form.itad_api_key ?? '')} onChange={e => set('itad_api_key')(e.target.value)} spellCheck={false} />
            <a href="https://isthereanydeal.com/apps/new/" target="_blank" rel="noopener noreferrer"
               className="text-[11px] text-accent hover:underline">Criar uma aplicação e obter a chave →</a>
          </div>
          <div>
            <label className="text-xs text-secondary mb-1 block">Região <span className="text-muted">(código ISO de 2 letras — BR para o Brasil)</span></label>
            <input className={inputCls + ' font-mono uppercase'} maxLength={2} placeholder="BR"
              value={String(form.itad_country ?? '')} onChange={e => set('itad_country')(e.target.value.toUpperCase())} spellCheck={false} />
          </div>
        </div>

        <div className="flex gap-2 mt-4">
          <button type="button" onClick={() => itadTest.mutate()} disabled={itadTest.isPending || !status?.prices.api_key_set}
            className="text-xs px-3 py-2 bg-card border border-border rounded-lg text-primary hover:border-accent transition-colors disabled:opacity-50">
            {itadTest.isPending ? 'Testando…' : '⚡ Testar conexão'}
          </button>
          <button type="button" onClick={() => itadSync.mutate()} disabled={itadSync.isPending || !status?.prices.enabled}
            className="text-xs px-3 py-2 bg-card border border-border rounded-lg text-primary hover:border-accent transition-colors disabled:opacity-50">
            {itadSync.isPending ? 'Sincronizando…' : '↻ Sincronizar agora'}
          </button>
        </div>
        <p className="text-[11px] text-muted mt-2">
          {status?.prices.tracked ?? 0} {status?.prices.tracked === 1 ? 'jogo acompanhado' : 'jogos acompanhados'}
          {status?.prices.last_sync ? ` · última sincronização há ${timeAgo(status.prices.last_sync)}` : ' · ainda não sincronizado'}
          . O teste usa a config salva — salve antes de testar.
        </p>
        <p className="text-[11px] text-muted mt-1">Preços e histórico fornecidos por IsThereAnyDeal.</p>
      </div>

      {/* Salvar */}
      <div className="flex items-center gap-4 mb-8">
        <button onClick={() => save.mutate()} disabled={save.isPending}
          className="px-5 py-2.5 bg-accent text-bg rounded-lg font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-60">
          {save.isPending ? 'Salvando…' : 'Salvar integrações'}
        </button>
        {msg && <span className="text-sm text-games animate-fade-in">✓ {msg}</span>}
      </div>

      {/* Feed de atividade */}
      <div className="bg-surface border border-border rounded-xl p-5">
        <h3 className="font-medium text-primary text-sm mb-4">Atividade recente</h3>
        {activity.length === 0 ? (
          <p className="text-xs text-muted">Nada registrado ainda. Assim que você assistir ou ouvir algo, aparece aqui.</p>
        ) : (
          <div className="space-y-2">
            {activity.map(ev => (
              <div key={ev.id} className="flex items-center gap-3 py-1.5">
                <span style={{ fontSize: 14 }}>{activityEmoji(ev)}</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-primary truncate">
                    {ev.title}
                    {ev.subtitle && <span className="text-muted"> · {ev.subtitle}</span>}
                  </p>
                  <p className="text-[11px] text-muted">
                    {activityLabel(ev)}
                    {ev.genre && ` · ${ev.genre}`}
                  </p>
                </div>
                <span className="text-[11px] text-muted whitespace-nowrap">{timeAgo(ev.occurred_at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
