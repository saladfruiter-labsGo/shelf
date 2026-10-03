import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Avatar } from '../components/Avatar'
import type { IntegrationStatus, OnboardingStepId, OnboardingView } from '../types'

/**
 * Configuração guiada. Um roteiro curto, um serviço por vez, sempre com
 * "pular por enquanto" — nada aqui é obrigatório, e tudo continua disponível
 * depois em Integrações. Cada passo se dá por concluído sozinho quando a
 * configuração correspondente existe.
 */

interface StepMeta {
  icon: string
  title: string
  /** O que a pessoa ganha — a primeira coisa que ela lê. */
  gain: string
  time: string
}

const META: Record<OnboardingStepId, StepMeta> = {
  profile:    { icon: '🙂', title: 'Seu perfil', gain: 'Uma foto e uma linha sobre você — é assim que os amigos te reconhecem no feed.', time: '1 min' },
  instance:   { icon: '🔑', title: 'Chaves de busca', gain: 'Liga a busca de filmes, séries, jogos e livros para todas as contas do Shelf.', time: '5 min' },
  steam:      { icon: '🎮', title: 'Steam', gain: 'Sua biblioteca de jogos, tempo jogado, conquistas e a wishlist entram sozinhos.', time: '3 min' },
  lastfm:     { icon: '🎵', title: 'Last.fm', gain: 'Cada música que você ouve (Spotify, YouTube Music…) vira histórico, com horas e gêneros.', time: '2 min' },
  plex:       { icon: '📺', title: 'Plex', gain: 'Filmes e episódios assistidos no Plex vão direto para o diário, com a nota que você der.', time: '3 min' },
  kavita:     { icon: '📚', title: 'Kavita', gain: 'O progresso de leitura dos seus livros é acompanhado automaticamente.', time: '2 min' },
  playnite:   { icon: '🕹️', title: 'Playnite', gain: 'Jogos de outras lojas (GOG, Epic, emuladores) com tempo e status, direto do PC.', time: '5 min' },
  telegram:   { icon: '✈️', title: 'Telegram', gain: 'Avisos no celular quando algo entra na prateleira — e dar nota respondendo a mensagem.', time: '3 min' },
  letterboxd: { icon: '🎞️', title: 'Letterboxd', gain: 'Traga todo o seu histórico de filmes, notas e resenhas de uma vez.', time: '2 min' },
}

/* ─────────────────────────────── Peças ─────────────────────────────── */

const inputCls = 'w-full bg-card border border-border rounded-lg px-3 py-2.5 text-primary placeholder:text-muted outline-none focus:border-accent transition-colors'

function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="mb-4">
      <label htmlFor={id} className="block text-sm font-medium text-secondary mb-1.5">{label}</label>
      {children}
      {hint && <p className="text-xs text-muted mt-1.5">{hint}</p>}
    </div>
  )
}

function TextInput({ id, value, onChange, placeholder, secret, mono }: {
  id: string; value: string; onChange: (v: string) => void; placeholder?: string; secret?: boolean; mono?: boolean
}) {
  return (
    <input id={id} type={secret ? 'password' : 'text'} value={value} onChange={e => onChange(e.target.value)}
      placeholder={placeholder} autoComplete="off" spellCheck={false} autoCapitalize="none"
      className={`${inputCls}${mono ? ' font-mono' : ''}`} style={{ fontSize: 16 }} />
  )
}

function Notice({ notice }: { notice: { ok: boolean; text: string } | null }) {
  if (!notice) return null
  return (
    <p role="status" className={`mb-4 ${notice.ok ? 'text-games' : 'text-movies'}`} style={{ fontSize: 15 }}>
      {notice.ok ? '✓ ' : '⚠ '}{notice.text}
    </p>
  )
}

function CopyField({ id, label, value, hint }: { id: string; label: string; value: string; hint?: ReactNode }) {
  const [copied, setCopied] = useState(false)
  return (
    <Field id={id} label={label} hint={hint}>
      <div className="flex gap-2">
        <input id={id} readOnly value={value} onFocus={e => e.currentTarget.select()} className={`${inputCls} font-mono text-xs`} />
        <button type="button" className="px-3 rounded-lg border border-border-strong text-primary hover:border-accent whitespace-nowrap"
          onClick={() => { navigator.clipboard?.writeText(value).catch(() => {}); setCopied(true); window.setTimeout(() => setCopied(false), 1500) }}>
          {copied ? 'Copiado' : 'Copiar'}
        </button>
      </div>
    </Field>
  )
}

function ExternalLink({ href, children }: { href: string; children: ReactNode }) {
  return <a href={href} target="_blank" rel="noopener noreferrer" className="text-accent hover:underline">{children}</a>
}

/** Rodapé de ações de cada passo. */
function Actions({ busy, primary, onPrimary, onSkip, done, onNext }: {
  busy: boolean
  primary?: string
  onPrimary?: () => void
  onSkip: () => void
  done: boolean
  onNext: () => void
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 mt-6 pt-5 border-t border-border">
      {done ? (
        <button type="button" onClick={onNext} className="px-5 py-2.5 bg-accent text-bg rounded-lg font-semibold hover:opacity-90" style={{ fontSize: 16 }}>
          Próximo passo →
        </button>
      ) : primary && onPrimary ? (
        <button type="button" onClick={onPrimary} disabled={busy}
          className="px-5 py-2.5 bg-accent text-bg rounded-lg font-semibold hover:opacity-90 disabled:opacity-60 inline-flex items-center gap-2" style={{ fontSize: 16 }}>
          {busy && <span className="w-4 h-4 border-2 border-bg border-t-transparent rounded-full animate-spin" aria-hidden />}
          {primary}
        </button>
      ) : null}
      {!done && (
        <button type="button" onClick={onSkip} disabled={busy} className="px-4 py-2.5 rounded-lg text-secondary hover:text-primary" style={{ fontSize: 16 }}>
          Pular por enquanto
        </button>
      )}
    </div>
  )
}

interface StepProps {
  status: IntegrationStatus | undefined
  done: boolean
  /** Salva e recarrega o roteiro e as integrações. */
  save: (payload: Record<string, unknown>) => Promise<void>
  refresh: () => Promise<void>
  skip: () => void
  next: () => void
  initialNotice?: { ok: boolean; text: string } | null
}

/** Estado comum: ocupado + aviso, com `run` que transforma exceção em aviso. */
function useStepRunner(initial: { ok: boolean; text: string } | null = null) {
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(initial)
  const run = async (fn: () => Promise<string | void>) => {
    setBusy(true)
    setNotice(null)
    try {
      const message = await fn()
      if (message) setNotice({ ok: true, text: message })
    } catch (error) {
      setNotice({ ok: false, text: (error as Error).message })
    } finally {
      setBusy(false)
    }
  }
  return { busy, notice, setNotice, run }
}

/* ─────────────────────────────── Passos ─────────────────────────────── */

function ProfileStep({ done, refresh, skip, next }: StepProps) {
  const { user, setUser } = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [bio, setBio] = useState(user.bio ?? '')
  const { busy, notice, run } = useStepRunner()

  return (
    <>
      <div className="flex items-center gap-5 flex-wrap mb-6">
        <Avatar name={user.display_name} url={user.avatar_url} id={user.id} size={80} />
        <div>
          <button type="button" onClick={() => fileRef.current?.click()} disabled={busy}
            className="px-4 py-2 rounded-lg border border-border-strong text-primary hover:border-accent">
            {user.avatar_url ? 'Trocar foto' : 'Escolher foto'}
          </button>
          <p className="text-xs text-muted mt-2">A imagem é recortada em quadrado; localização e outros metadados são descartados.</p>
        </div>
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => {
          const file = e.target.files?.[0]
          if (file) run(async () => { setUser(await api.account.uploadAvatar(file)); await refresh(); return 'Foto salva.' })
          e.target.value = ''
        }} />
      </div>
      <Field id="w-bio" label="Bio" hint="Opcional. Até 280 caracteres.">
        <textarea id="w-bio" rows={3} value={bio} onChange={e => setBio(e.target.value.slice(0, 280))}
          placeholder="Ex.: RPG longo, terror dos anos 80 e ficção científica." className={`${inputCls} resize-y`} style={{ fontSize: 16 }} />
      </Field>
      <Notice notice={notice} />
      <Actions busy={busy} done={done} onNext={next} onSkip={skip} primary="Salvar perfil"
        onPrimary={() => run(async () => {
          setUser(await api.account.update({ bio: bio.trim() }))
          await refresh()
          return 'Perfil salvo.'
        })} />
    </>
  )
}

function InstanceStep({ done, save, refresh, skip, next }: StepProps) {
  const { data: keys } = useQuery({ queryKey: ['settings'], queryFn: api.settings.get })
  const [tmdb, setTmdb] = useState('')
  const [rawg, setRawg] = useState('')
  const [books, setBooks] = useState('')
  const [igdbId, setIgdbId] = useState('')
  const [igdbSecret, setIgdbSecret] = useState('')
  const [itad, setItad] = useState('')
  const [more, setMore] = useState(false)
  const qc = useQueryClient()
  const { busy, notice, run } = useStepRunner()
  const saved = (k: 'TMDB_API_KEY' | 'RAWG_API_KEY' | 'GOOGLE_BOOKS_KEY') => keys?.[k]?.set ? `salva (${keys[k].masked})` : undefined

  return (
    <>
      <p className="text-secondary mb-5" style={{ fontSize: 16 }}>
        Só você (admin) vê este passo. As chaves são gratuitas, ficam guardadas no servidor e valem para todo mundo — ninguém consegue lê-las depois, nem você.
      </p>
      <Field id="w-tmdb" label="TMDB — filmes e séries" hint={<ExternalLink href="https://www.themoviedb.org/settings/api">Criar a chave no TMDB →</ExternalLink>}>
        <TextInput id="w-tmdb" value={tmdb} onChange={setTmdb} secret mono placeholder={saved('TMDB_API_KEY') ?? 'Chave da API (v3) ou token de leitura'} />
      </Field>
      <Field id="w-rawg" label="RAWG — jogos" hint={<ExternalLink href="https://rawg.io/apidocs">Criar a chave na RAWG →</ExternalLink>}>
        <TextInput id="w-rawg" value={rawg} onChange={setRawg} secret mono placeholder={saved('RAWG_API_KEY') ?? 'Chave da API'} />
      </Field>
      <button type="button" onClick={() => setMore(m => !m)} aria-expanded={more} className="text-sm text-accent hover:underline mb-4">
        {more ? '− Esconder opcionais' : '+ Opcionais: livros, tempo para zerar e preços'}
      </button>
      {more && (
        <div className="pl-4 border-l-2 border-border">
          <Field id="w-books" label="Google Books — livros" hint="Funciona sem chave, com limite menor.">
            <TextInput id="w-books" value={books} onChange={setBooks} secret mono placeholder={saved('GOOGLE_BOOKS_KEY') ?? 'AIza…'} />
          </Field>
          <Field id="w-igdb-id" label="IGDB Client ID — tempo para zerar" hint={<ExternalLink href="https://dev.twitch.tv/console/apps">Criar o app na Twitch →</ExternalLink>}>
            <TextInput id="w-igdb-id" value={igdbId} onChange={setIgdbId} mono />
          </Field>
          <Field id="w-igdb-secret" label="IGDB Client Secret">
            <TextInput id="w-igdb-secret" value={igdbSecret} onChange={setIgdbSecret} secret mono />
          </Field>
          <Field id="w-itad" label="IsThereAnyDeal — preços dos jogos da Wishlist" hint={<ExternalLink href="https://isthereanydeal.com/apps/new/">Criar a chave →</ExternalLink>}>
            <TextInput id="w-itad" value={itad} onChange={setItad} secret mono />
          </Field>
        </div>
      )}
      <Notice notice={notice} />
      <Actions busy={busy} done={done && !tmdb && !rawg} onNext={next} onSkip={skip} primary="Salvar chaves"
        onPrimary={() => run(async () => {
          const searchKeys: Record<string, string> = {}
          if (tmdb.trim()) searchKeys.TMDB_API_KEY = tmdb.trim()
          if (rawg.trim()) searchKeys.RAWG_API_KEY = rawg.trim()
          if (books.trim()) searchKeys.GOOGLE_BOOKS_KEY = books.trim()
          if (Object.keys(searchKeys).length) qc.setQueryData(['settings'], await api.settings.update(searchKeys))
          const extra: Record<string, unknown> = {}
          if (igdbId.trim()) extra.igdb_client_id = igdbId.trim()
          if (igdbSecret.trim()) extra.igdb_client_secret = igdbSecret.trim()
          if (itad.trim()) extra.itad_api_key = itad.trim()
          if (Object.keys(extra).length) await save(extra)
          setTmdb(''); setRawg(''); setBooks(''); setIgdbSecret(''); setItad('')
          await refresh()
          return 'Chaves salvas.'
        })} />
    </>
  )
}

function SteamStep({ status, done, save, refresh, skip, next, initialNotice }: StepProps) {
  const [profile, setProfile] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [library, setLibrary] = useState(true)
  const [wishlist, setWishlist] = useState(true)
  const { busy, notice, run } = useStepRunner(initialNotice)
  const steamId = status?.steam.steam_id

  return (
    <>
      <ol className="space-y-5 mb-2" style={{ fontSize: 16 }}>
        <li>
          <p className="text-primary font-medium mb-2">1. Sua conta</p>
          {steamId ? (
            <p className="text-games">✓ Conta Steam ligada ({steamId}).</p>
          ) : (
            <>
              <a href="/auth/steam/login?next=welcome"
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg font-semibold text-white hover:opacity-90"
                style={{ background: 'var(--steam-solid)' }}>
                Entrar com a Steam
              </a>
              <p className="text-xs text-muted mt-2">Você faz login no site da própria Steam; o Shelf só recebe o seu SteamID, nunca a senha.</p>
              <div className="mt-3">
                <Field id="w-steam-profile" label="…ou cole o link do seu perfil">
                  <div className="flex gap-2">
                    <TextInput id="w-steam-profile" value={profile} onChange={setProfile} placeholder="https://steamcommunity.com/id/…" />
                    <button type="button" disabled={busy || !profile.trim()} className="px-3 rounded-lg border border-border-strong text-primary hover:border-accent disabled:opacity-50"
                      onClick={() => run(async () => {
                        const res = await api.integrations.steamResolve(profile.trim())
                        if (!res.ok || !res.steam_id) throw new Error(res.error ?? 'Perfil não encontrado.')
                        await save({ steam_id: res.steam_id })
                        return 'Perfil encontrado.'
                      })}>
                      Usar
                    </button>
                  </div>
                </Field>
              </div>
            </>
          )}
        </li>
        <li>
          <p className="text-primary font-medium mb-2">2. Chave da Web API</p>
          <Field id="w-steam-key" label="Chave da Steam Web API"
            hint={<>Gere em <ExternalLink href="https://steamcommunity.com/dev/apikey">steamcommunity.com/dev/apikey</ExternalLink> (em "domínio", qualquer nome serve). Os detalhes de jogo do perfil precisam estar públicos.</>}>
            <TextInput id="w-steam-key" value={apiKey} onChange={setApiKey} secret mono
              placeholder={status?.steam.api_key_set ? `salva (${status.steam.api_key_masked})` : 'XXXXXXXXXXXXXXXX'} />
          </Field>
        </li>
        <li>
          <p className="text-primary font-medium mb-2">3. O que trazer</p>
          <label className="flex items-start gap-3 mb-2 cursor-pointer">
            <input type="checkbox" checked={library} onChange={e => setLibrary(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
            <span>Biblioteca, tempo jogado e conquistas <span className="text-muted">(zerado e platinado automáticos)</span></span>
          </label>
          <label className="flex items-start gap-3 cursor-pointer">
            <input type="checkbox" checked={wishlist} onChange={e => setWishlist(e.target.checked)} className="mt-1 accent-[var(--accent)]" />
            <span>Wishlist da Steam <span className="text-muted">(entra na sua Wishlist do Shelf)</span></span>
          </label>
        </li>
      </ol>
      <Notice notice={notice} />
      <Actions busy={busy} done={done && !apiKey} onNext={next} onSkip={skip} primary="Conectar Steam"
        onPrimary={() => run(async () => {
          if (!steamId) throw new Error('Entre com a Steam ou cole o link do perfil primeiro.')
          if (!apiKey.trim() && !status?.steam.api_key_set) throw new Error('Cole a chave da Web API.')
          await save({
            ...(apiKey.trim() ? { steam_api_key: apiKey.trim() } : {}),
            steam_library_enabled: library, steam_enabled: wishlist,
          })
          setApiKey('')
          const test = await api.integrations.steamTest()
          if (!test.ok) throw new Error(test.error ?? 'A Steam recusou a conexão.')
          // A primeira leitura da biblioteca roda em segundo plano.
          if (library) api.integrations.steamLibrarySync().catch(() => {})
          await refresh()
          return `Conectado! ${test.owned != null ? `${test.owned} jogos na biblioteca` : 'Biblioteca lida'}${test.wishlist != null ? `, ${test.wishlist} na wishlist` : ''}. A primeira leitura continua em segundo plano.`
        })} />
    </>
  )
}

function LastfmStep({ status, done, save, refresh, skip, next }: StepProps) {
  const [user, setUser] = useState(status?.lastfm.user ?? '')
  const [apiKey, setApiKey] = useState('')
  const { busy, notice, run } = useStepRunner()
  return (
    <>
      <p className="text-secondary mb-5" style={{ fontSize: 16 }}>
        Se você ainda não usa, crie a conta no Last.fm e ligue o "scrobble" no seu player (Spotify, YouTube Music via extensão, Plexamp…).
      </p>
      <Field id="w-lfm-user" label="Usuário do Last.fm">
        <TextInput id="w-lfm-user" value={user} onChange={setUser} placeholder="seu-usuario" />
      </Field>
      <Field id="w-lfm-key" label="API key" hint={<ExternalLink href="https://www.last.fm/api/account/create">Criar uma API key (só pede nome e descrição) →</ExternalLink>}>
        <TextInput id="w-lfm-key" value={apiKey} onChange={setApiKey} secret mono placeholder={status?.lastfm.api_key_set ? `salva (${status.lastfm.api_key_masked})` : ''} />
      </Field>
      <Notice notice={notice} />
      <Actions busy={busy} done={done && !apiKey} onNext={next} onSkip={skip} primary="Conectar Last.fm"
        onPrimary={() => run(async () => {
          if (!user.trim()) throw new Error('Informe o usuário.')
          if (!apiKey.trim() && !status?.lastfm.api_key_set) throw new Error('Cole a API key.')
          await save({ lastfm_enabled: true, lastfm_user: user.trim(), ...(apiKey.trim() ? { lastfm_api_key: apiKey.trim() } : {}) })
          setApiKey('')
          await api.integrations.lastfmSync()
          await refresh()
          return 'Conectado! As últimas músicas já estão chegando.'
        })} />
    </>
  )
}

function PlexStep({ status, done, save, refresh, skip, next }: StepProps) {
  const [url, setUrl] = useState(status?.plex.url ?? '')
  const [token, setToken] = useState('')
  const [user, setUser] = useState(status?.plex.user ?? '')
  const { busy, notice, run } = useStepRunner()
  const webhook = status ? `${window.location.origin}/api/integrations/plex/webhook?token=${status.plex.webhook_secret}` : ''
  return (
    <>
      <Field id="w-plex-url" label="Endereço do servidor Plex" hint="O mesmo que você usa na rede, com a porta (normalmente 32400).">
        <TextInput id="w-plex-url" value={url} onChange={setUrl} placeholder="http://192.168.0.10:32400" />
      </Field>
      <Field id="w-plex-token" label="Token do Plex"
        hint={<ExternalLink href="https://support.plex.tv/articles/204059436-finding-an-authentication-token-x-plex-token/">Como encontrar o seu token →</ExternalLink>}>
        <TextInput id="w-plex-token" value={token} onChange={setToken} secret mono placeholder={status?.plex.token_set ? `salvo (${status.plex.token_masked})` : ''} />
      </Field>
      <Field id="w-plex-user" label="Seu usuário no Plex" hint="Se o servidor é compartilhado, só o que você assistir conta para a sua prateleira.">
        <TextInput id="w-plex-user" value={user} onChange={setUser} placeholder="opcional" />
      </Field>
      <CopyField id="w-plex-hook" label="Webhook — cole no Plex" value={webhook}
        hint="Plex → Configurações → Webhooks → Adicionar. Exige Plex Pass. É o webhook que registra o que você terminou de ver e a nota." />
      <Notice notice={notice} />
      <Actions busy={busy} done={done && !token} onNext={next} onSkip={skip} primary="Conectar Plex"
        onPrimary={() => run(async () => {
          if (!url.trim()) throw new Error('Informe o endereço do servidor.')
          if (!token.trim() && !status?.plex.token_set) throw new Error('Cole o token do Plex.')
          await save({ plex_enabled: true, plex_url: url.trim(), plex_user: user.trim(), ...(token.trim() ? { plex_token: token.trim() } : {}) })
          setToken('')
          await refresh()
          return 'Plex conectado. Não esqueça de colar o webhook no Plex.'
        })} />
    </>
  )
}

function KavitaStep({ status, done, save, refresh, skip, next }: StepProps) {
  const [url, setUrl] = useState(status?.kavita.url ?? '')
  const [apiKey, setApiKey] = useState('')
  const { busy, notice, run } = useStepRunner()
  return (
    <>
      <Field id="w-kav-url" label="Endereço do Kavita">
        <TextInput id="w-kav-url" value={url} onChange={setUrl} placeholder="http://192.168.0.10:5000" />
      </Field>
      <Field id="w-kav-key" label="API key do Kavita" hint="No Kavita: seu usuário → Configurações → 3rd Party Clients → API Key.">
        <TextInput id="w-kav-key" value={apiKey} onChange={setApiKey} secret mono placeholder={status?.kavita.api_key_set ? `salva (${status.kavita.api_key_masked})` : ''} />
      </Field>
      <Notice notice={notice} />
      <Actions busy={busy} done={done && !apiKey} onNext={next} onSkip={skip} primary="Conectar Kavita"
        onPrimary={() => run(async () => {
          if (!url.trim()) throw new Error('Informe o endereço do Kavita.')
          if (!apiKey.trim() && !status?.kavita.api_key_set) throw new Error('Cole a API key.')
          await save({ kavita_enabled: true, kavita_url: url.trim(), ...(apiKey.trim() ? { kavita_api_key: apiKey.trim() } : {}) })
          setApiKey('')
          const test = await api.integrations.kavitaTest()
          if (!test.ok) throw new Error(test.error ?? 'O Kavita recusou a conexão.')
          await refresh()
          return 'Kavita conectado.'
        })} />
    </>
  )
}

function PlayniteStep({ status, done, save, refresh, skip, next }: StepProps) {
  const { busy, notice, run } = useStepRunner()
  const webhook = status ? `${window.location.origin}/api/integrations/playnite/webhook?token=${status.playnite.webhook_secret}` : ''
  return (
    <>
      <ol className="list-decimal pl-5 space-y-2 text-secondary mb-5" style={{ fontSize: 16 }}>
        <li>Baixe a extensão <b className="text-primary">ShelfSync</b> e copie a pasta para <code className="bg-card px-1 rounded">%AppData%\Playnite\Extensions</code>.
          {' '}<ExternalLink href="https://github.com/saladfruiter-labsGo/shelf/tree/main/playnite-extension">Baixar a extensão →</ExternalLink></li>
        <li>Cole a URL abaixo no <code className="bg-card px-1 rounded">config.json</code> da extensão.</li>
        <li>Reabra o Playnite. Ele envia tudo uma vez por dia e sempre que você fecha um jogo.</li>
      </ol>
      <CopyField id="w-pn-hook" label="URL do webhook (é sua — não compartilhe)" value={webhook} />
      <Notice notice={notice} />
      <Actions busy={busy} done={done} onNext={next} onSkip={skip} primary="Ativar Playnite"
        onPrimary={() => run(async () => {
          await save({ playnite_enabled: true })
          await refresh()
          return 'Pronto para receber os envios do Playnite.'
        })} />
    </>
  )
}

function TelegramStep({ status, done, save, refresh, skip, next }: StepProps) {
  const [token, setToken] = useState('')
  const [chats, setChats] = useState<{ chat_id: string; thread_id: string; name: string }[] | null>(null)
  const [chosen, setChosen] = useState<{ chat_id: string; thread_id: string } | null>(null)
  const { busy, notice, run } = useStepRunner()
  const tokenReady = !!token.trim() || !!status?.telegram.bot_token_set
  return (
    <>
      <ol className="list-decimal pl-5 space-y-2 text-secondary mb-5" style={{ fontSize: 16 }}>
        <li>No Telegram, fale com <ExternalLink href="https://t.me/BotFather">@BotFather</ExternalLink>, mande <code className="bg-card px-1 rounded">/newbot</code> e copie o token.</li>
        <li>Abra o seu bot novo e mande qualquer mensagem para ele.</li>
        <li>Volte aqui e clique em "Encontrar a conversa".</li>
      </ol>
      <Field id="w-tg-token" label="Token do bot">
        <TextInput id="w-tg-token" value={token} onChange={setToken} secret mono
          placeholder={status?.telegram.bot_token_set ? `salvo (${status.telegram.bot_token_masked})` : '123456:ABC…'} />
      </Field>
      <button type="button" disabled={busy || !tokenReady} className="px-4 py-2 rounded-lg border border-border-strong text-primary hover:border-accent disabled:opacity-50 mb-4"
        onClick={() => run(async () => {
          if (token.trim()) { await save({ telegram_bot_token: token.trim() }); setToken('') }
          const found = await api.integrations.telegramDetectChat()
          setChats(found.chats)
          if (found.chats.length === 1) setChosen(found.chats[0])
          if (!found.chats.length) throw new Error('Nenhuma conversa ainda. Mande uma mensagem para o bot e tente de novo.')
        })}>
        Encontrar a conversa
      </button>
      {chats && chats.length > 0 && (
        <fieldset className="mb-4">
          <legend className="text-sm font-medium text-secondary mb-2">Onde avisar</legend>
          {chats.map(chat => (
            <label key={`${chat.chat_id}:${chat.thread_id}`} className="flex items-center gap-3 mb-1 cursor-pointer" style={{ fontSize: 16 }}>
              <input type="radio" name="w-tg-chat" checked={chosen?.chat_id === chat.chat_id && chosen?.thread_id === chat.thread_id}
                onChange={() => setChosen(chat)} className="accent-[var(--accent)]" />
              {chat.name}
            </label>
          ))}
        </fieldset>
      )}
      <Notice notice={notice} />
      <Actions busy={busy} done={done && !chosen} onNext={next} onSkip={skip} primary="Ativar avisos"
        onPrimary={() => run(async () => {
          if (!chosen) throw new Error('Encontre e escolha a conversa primeiro.')
          await save({ telegram_enabled: true, telegram_chat_id: chosen.chat_id, telegram_thread_id: chosen.thread_id })
          const test = await api.integrations.telegramTest()
          if (!test.ok) throw new Error(test.error ?? 'O Telegram recusou a mensagem.')
          await refresh()
          return 'Mensagem de teste enviada — confira o Telegram.'
        })} />
    </>
  )
}

function LetterboxdStep({ done, skip, next }: StepProps) {
  return (
    <>
      <ol className="list-decimal pl-5 space-y-2 text-secondary mb-5" style={{ fontSize: 16 }}>
        <li>No Letterboxd: Settings → <b className="text-primary">Import &amp; Export</b> → Export your data. Vem um arquivo .zip.</li>
        <li>Em Importação/Exportação, envie o .zip inteiro. Você vê uma prévia do que entra antes de confirmar.</li>
      </ol>
      <Link to="/import-export" className="inline-block px-5 py-2.5 bg-accent text-bg rounded-lg font-semibold hover:opacity-90" style={{ fontSize: 16 }}>
        Abrir a importação
      </Link>
      <p className="text-xs text-muted mt-3">Este passo se marca sozinho quando a importação termina. Dá para voltar para cá pelo menu da conta.</p>
      <Actions busy={false} done={done} onNext={next} onSkip={skip} />
    </>
  )
}

const COMPONENTS: Record<OnboardingStepId, (props: StepProps) => JSX.Element> = {
  profile: ProfileStep, instance: InstanceStep, steam: SteamStep, lastfm: LastfmStep, plex: PlexStep,
  kavita: KavitaStep, playnite: PlayniteStep, telegram: TelegramStep, letterboxd: LetterboxdStep,
}

/* ─────────────────────────────── Página ─────────────────────────────── */

function StatusDot({ status, index, active }: { status: 'done' | 'skipped' | 'pending'; index: number; active: boolean }) {
  const base = 'w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0'
  if (status === 'done') return <span className={`${base} bg-accent text-bg`} aria-hidden>✓</span>
  if (status === 'skipped') return <span className={`${base} border border-border-strong text-muted`} aria-hidden>↷</span>
  return <span className={`${base} border ${active ? 'border-accent text-accent' : 'border-border-strong text-secondary'}`} aria-hidden>{index + 1}</span>
}

const STATUS_LABEL = { done: 'conectado', skipped: 'pulado', pending: 'a fazer' } as const

export function Welcome() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [params, setParams] = useSearchParams()
  // Sempre fresco ao abrir: uma importação feita em outra tela já marca o passo.
  const { data: view } = useQuery({ queryKey: ['onboarding'], queryFn: api.onboarding.get, refetchOnMount: 'always' })
  const { data: status } = useQuery({ queryKey: ['integrations'], queryFn: api.integrations.status })
  const [current, setCurrent] = useState<OnboardingStepId | 'finish' | null>(null)
  const [steamNotice, setSteamNotice] = useState<{ ok: boolean; text: string } | null>(null)

  // Volta do "Entrar com a Steam".
  useEffect(() => {
    const result = params.get('steam')
    if (!result) return
    setCurrent('steam')
    setSteamNotice(result === 'conectado'
      ? { ok: true, text: 'Conta Steam ligada. Falta só a chave da Web API.' }
      : { ok: false, text: params.get('motivo') || 'Não foi possível entrar com a Steam.' })
    setParams({}, { replace: true })
    qc.invalidateQueries({ queryKey: ['integrations'] })
  }, [params, setParams, qc])

  const steps = view?.steps ?? []
  const firstOpen = steps.find(s => s.status === 'pending')?.id ?? 'finish'
  const active = current ?? firstOpen
  const activeIndex = steps.findIndex(s => s.id === active)

  const apply = (next: OnboardingView) => qc.setQueryData(['onboarding'], next)

  const refresh = async () => {
    await Promise.all([
      qc.invalidateQueries({ queryKey: ['integrations'] }),
      qc.invalidateQueries({ queryKey: ['onboarding'] }),
    ])
  }

  const save = async (payload: Record<string, unknown>) => {
    await api.integrations.update(payload)
    await qc.invalidateQueries({ queryKey: ['integrations'] })
  }

  const goNext = (from: OnboardingStepId, latest: OnboardingView | undefined = view) => {
    const list = latest?.steps ?? steps
    const at = list.findIndex(s => s.id === from)
    const after = list.slice(at + 1).find(s => s.status === 'pending')
    setCurrent(after?.id ?? 'finish')
  }

  const skip = async (id: OnboardingStepId) => {
    const latest = await api.onboarding.act({ skip: id })
    apply(latest)
    goNext(id, latest)
  }

  const later = async () => {
    apply(await api.onboarding.act({ dismiss: true }))
    navigate('/')
  }

  const progress = view ? Math.round((steps.filter(s => s.status !== 'pending').length / Math.max(1, steps.length)) * 100) : 0
  const Step = active !== 'finish' ? COMPONENTS[active] : null
  const activeStatus = steps.find(s => s.id === active)?.status

  const summary = useMemo(() => ({
    done: steps.filter(s => s.status === 'done'),
    skipped: steps.filter(s => s.status !== 'done'),
  }), [steps])

  if (!view) {
    return <div className="min-h-[45vh] grid place-items-center text-muted" role="status">Carregando…</div>
  }

  return (
    <div className="px-6 py-8 max-w-5xl mx-auto">
      <header className="flex items-start justify-between gap-4 flex-wrap mb-6">
        <div>
          <p className="text-xs font-semibold tracking-[2.5px] uppercase text-muted mb-2">Configuração guiada</p>
          <h1 className="font-display text-3xl font-bold text-primary mb-1">
            {user.display_name.split(' ')[0]}, vamos montar sua prateleira
          </h1>
          <p className="text-secondary" style={{ fontSize: 16 }}>
            Conecte o que você usa e o Shelf se preenche sozinho. Tudo é opcional — dá para pular e voltar depois.
          </p>
        </div>
        <button type="button" onClick={later} className="px-4 py-2 rounded-lg border border-border-strong text-secondary hover:text-primary hover:border-accent">
          Fazer depois
        </button>
      </header>

      <div className="mb-8" aria-label={`${view.done} de ${view.total} conectados`}>
        <div className="h-1.5 rounded-full bg-card overflow-hidden">
          <div className="h-full bg-accent transition-all" style={{ width: `${progress}%` }} />
        </div>
        <p className="text-xs text-muted mt-2">{view.done} de {view.total} conectados</p>
      </div>

      <div className="grid gap-6 md:grid-cols-[260px_1fr]">
        <nav aria-label="Passos" className="md:sticky md:top-[calc(var(--nav-h)+24px)] self-start">
          <ol className="flex md:flex-col gap-1 overflow-x-auto pb-2 md:pb-0 -mx-1 px-1">
            {steps.map((s, i) => (
              <li key={s.id} className="flex-shrink-0">
                <button type="button" onClick={() => setCurrent(s.id)} aria-current={active === s.id ? 'step' : undefined}
                  className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left transition-colors ${active === s.id ? 'bg-surface border border-border-strong' : 'border border-transparent hover:bg-surface'}`}>
                  <StatusDot status={s.status} index={i} active={active === s.id} />
                  <span className="min-w-0">
                    <span className="block text-primary whitespace-nowrap" style={{ fontSize: 15 }}>{META[s.id].icon} {META[s.id].title}</span>
                    <span className="block text-xs text-muted">{STATUS_LABEL[s.status]}</span>
                  </span>
                </button>
              </li>
            ))}
            <li className="flex-shrink-0">
              <button type="button" onClick={() => setCurrent('finish')} aria-current={active === 'finish' ? 'step' : undefined}
                className={`w-full flex items-center gap-3 rounded-xl px-3 py-2.5 text-left ${active === 'finish' ? 'bg-surface border border-border-strong' : 'border border-transparent hover:bg-surface'}`}>
                <span className="w-7 h-7 rounded-full flex items-center justify-center border border-border-strong flex-shrink-0" aria-hidden>🏁</span>
                <span className="text-primary" style={{ fontSize: 15 }}>Concluir</span>
              </button>
            </li>
          </ol>
        </nav>

        <section className="bg-surface border border-border rounded-xl p-6 sm:p-8" aria-live="polite">
          {Step && active !== 'finish' ? (
            <>
              <div className="flex items-start gap-4 mb-6">
                <span style={{ fontSize: 36, lineHeight: 1 }} aria-hidden>{META[active].icon}</span>
                <div>
                  <p className="text-xs text-muted mb-1">Passo {activeIndex + 1} de {steps.length} · {META[active].time}</p>
                  <h2 className="font-display text-2xl font-bold text-primary">{META[active].title}</h2>
                  <p className="text-secondary mt-1" style={{ fontSize: 16 }}>{META[active].gain}</p>
                  {activeStatus === 'done' && <p className="text-games mt-2" style={{ fontSize: 15 }}>✓ Já conectado. Você pode ajustar abaixo ou seguir.</p>}
                </div>
              </div>
              <Step
                key={active}
                status={status}
                done={activeStatus === 'done'}
                save={save}
                refresh={refresh}
                skip={() => { skip(active) }}
                next={() => goNext(active)}
                initialNotice={active === 'steam' ? steamNotice : null}
              />
            </>
          ) : (
            <div>
              <h2 className="font-display text-2xl font-bold text-primary mb-2">
                {summary.done.length ? 'Sua prateleira está ligada 🎉' : 'Tudo bem começar do zero'}
              </h2>
              <p className="text-secondary mb-6" style={{ fontSize: 16 }}>
                {summary.done.length
                  ? 'O que você conectou passa a abastecer a biblioteca sozinho. As primeiras leituras podem levar alguns minutos.'
                  : 'Você pode adicionar mídias à mão pelo botão "Adicionar" e conectar serviços quando quiser.'}
              </p>
              {summary.done.length > 0 && (
                <p className="mb-2" style={{ fontSize: 16 }}><span className="text-muted">Conectado:</span> {summary.done.map(s => META[s.id].title).join(', ')}</p>
              )}
              {summary.skipped.length > 0 && (
                <p className="mb-6" style={{ fontSize: 16 }}><span className="text-muted">Para depois:</span> {summary.skipped.map(s => META[s.id].title).join(', ')}</p>
              )}
              <p className="text-sm text-muted mb-6">
                Para voltar a este roteiro, use <b>Configuração guiada</b> no menu da sua conta. Todos os ajustes finos ficam em <Link to="/integrations" className="text-accent hover:underline">Integrações</Link>.
              </p>
              <button type="button" onClick={later} className="px-5 py-2.5 bg-accent text-bg rounded-lg font-semibold hover:opacity-90" style={{ fontSize: 16 }}>
                Ir para a minha prateleira
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
