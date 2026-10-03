import { useRef, useState, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { Avatar } from '../components/Avatar'
import { ChangePasswordForm } from '../components/AuthScreens'

const BIO_MAX = 280

/** Minha conta: foto, nome, bio e senha. */
export function Account() {
  const { user, setUser: setAuthUser, logout } = useAuth()
  const qc = useQueryClient()
  // Nome e foto também aparecem no Perfil: atualiza os dois de uma vez.
  const setUser = (next: Parameters<typeof setAuthUser>[0]) => {
    setAuthUser(next)
    qc.invalidateQueries({ queryKey: ['profile'] })
  }
  const fileRef = useRef<HTMLInputElement>(null)
  const [name, setName] = useState(user.display_name)
  const [bio, setBio] = useState(user.bio ?? '')
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null)
  const [busy, setBusy] = useState<'profile' | 'avatar' | null>(null)

  const flash = (ok: boolean, text: string) => {
    setNotice({ ok, text })
    window.setTimeout(() => setNotice(null), 3500)
  }

  const saveProfile = async (e: FormEvent) => {
    e.preventDefault()
    setBusy('profile')
    try {
      setUser(await api.account.update({ display_name: name.trim(), bio: bio.trim() }))
      flash(true, 'Perfil salvo.')
    } catch (err) {
      flash(false, (err as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const uploadAvatar = async (file: File | undefined) => {
    if (!file) return
    setBusy('avatar')
    try {
      setUser(await api.account.uploadAvatar(file))
      flash(true, 'Foto atualizada.')
    } catch (err) {
      flash(false, (err as Error).message)
    } finally {
      setBusy(null)
      if (fileRef.current) fileRef.current.value = ''
    }
  }

  const removeAvatar = async () => {
    setBusy('avatar')
    try {
      setUser(await api.account.removeAvatar())
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="px-6 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-primary mb-1">Minha conta</h1>
        <p className="text-muted" style={{ fontSize: 16 }}>Como você aparece para as outras pessoas do Shelf.</p>
      </div>

      {notice && (
        <p role="status" className={`mb-4 ${notice.ok ? 'text-games' : 'text-movies'}`} style={{ fontSize: 15 }}>
          {notice.ok ? '✓ ' : '⚠ '}{notice.text}
        </p>
      )}

      <section className="bg-surface border border-border rounded-xl p-5 mb-4" aria-labelledby="account-photo">
        <h2 id="account-photo" className="font-medium text-primary mb-4">Foto de perfil</h2>
        <div className="flex items-center gap-5 flex-wrap">
          <Avatar name={user.display_name} url={user.avatar_url} id={user.id} size={88} />
          <div className="flex flex-col gap-2">
            <div className="flex gap-2 flex-wrap">
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                disabled={busy === 'avatar'}
                className="px-4 py-2 rounded-lg bg-accent text-bg font-medium hover:opacity-90 disabled:opacity-60"
              >
                {busy === 'avatar' ? 'Enviando…' : user.avatar_url ? 'Trocar foto' : 'Enviar foto'}
              </button>
              {user.avatar_url && (
                <button type="button" onClick={removeAvatar} disabled={busy === 'avatar'}
                  className="px-4 py-2 rounded-lg border border-border-strong text-secondary hover:text-primary">
                  Remover
                </button>
              )}
            </div>
            <p className="text-xs text-muted">JPG, PNG, WebP, GIF ou AVIF até 12 MB. A imagem é recortada em quadrado e os metadados (como localização) são descartados.</p>
          </div>
          <input ref={fileRef} type="file" accept="image/*" hidden onChange={e => uploadAvatar(e.target.files?.[0])} />
        </div>
      </section>

      <form onSubmit={saveProfile} className="bg-surface border border-border rounded-xl p-5 mb-4" aria-labelledby="account-profile">
        <h2 id="account-profile" className="font-medium text-primary mb-4">Perfil</h2>
        <p className="text-sm text-muted mb-4">Usuário: <span className="text-secondary">@{user.username}</span></p>
        <label htmlFor="acc-name" className="block text-sm font-medium text-secondary mb-1.5">Nome de exibição</label>
        <input id="acc-name" value={name} onChange={e => setName(e.target.value)} maxLength={60} autoComplete="name"
          className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-primary outline-none focus:border-accent mb-4" style={{ fontSize: 16 }} />
        <label htmlFor="acc-bio" className="block text-sm font-medium text-secondary mb-1.5">Bio</label>
        <textarea id="acc-bio" value={bio} onChange={e => setBio(e.target.value.slice(0, BIO_MAX))} rows={3}
          placeholder="Uma linha sobre o que você gosta de ver, jogar e ler."
          className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-primary outline-none focus:border-accent resize-y" style={{ fontSize: 16 }} />
        <p className="text-xs text-muted mt-1 mb-4 text-right">{bio.length}/{BIO_MAX}</p>
        <button type="submit" disabled={busy === 'profile'} className="px-5 py-2.5 bg-accent text-bg rounded-lg font-medium hover:opacity-90 disabled:opacity-60">
          {busy === 'profile' ? 'Salvando…' : 'Salvar perfil'}
        </button>
      </form>

      <FeedPrivacy />

      <section className="bg-surface border border-border rounded-xl p-5 mb-4" aria-labelledby="account-password">
        <h2 id="account-password" className="font-medium text-primary mb-4">Trocar senha</h2>
        <ChangePasswordForm onDone={setUser} />
      </section>

      <button type="button" onClick={logout} className="px-4 py-2 rounded-lg border border-border-strong text-secondary hover:text-primary hover:border-accent">
        Sair desta conta
      </button>
    </div>
  )
}

/** O que entra sozinho no feed. Posts escritos e listas compartilhadas são sempre escolha explícita. */
function FeedPrivacy() {
  const qc = useQueryClient()
  const { data } = useQuery({ queryKey: ['feed-preferences'], queryFn: api.feed.preferences })
  const update = async (patch: { share_diary?: boolean; share_achievements?: boolean }) => {
    qc.setQueryData(['feed-preferences'], await api.feed.updatePreferences(patch))
  }
  return (
    <section className="bg-surface border border-border rounded-xl p-5 mb-4" aria-labelledby="account-feed">
      <h2 id="account-feed" className="font-medium text-primary mb-1">Feed</h2>
      <p className="text-sm text-muted mb-4">O que vai para o feed dos amigos sozinho. Registros antigos e importações nunca entram — só o que acontece daqui pra frente.</p>
      {[
        { key: 'share_diary' as const, label: 'Registros do diário', hint: 'Filmes, episódios, jogos e livros que você registrar, com nota e resenha.' },
        { key: 'share_achievements' as const, label: 'Conquistas da Steam', hint: 'Agrupadas por jogo: um post por dia com todas as conquistas daquele jogo.' },
      ].map(opt => (
        <label key={opt.key} className="flex items-start gap-3 mb-3 cursor-pointer">
          <input type="checkbox" className="mt-1 accent-[var(--accent)]" checked={data?.[opt.key] ?? true} disabled={!data}
            onChange={e => update({ [opt.key]: e.target.checked })} />
          <span>
            <span className="block text-primary" style={{ fontSize: 16 }}>{opt.label}</span>
            <span className="block text-sm text-muted">{opt.hint}</span>
          </span>
        </label>
      ))}
    </section>
  )
}
