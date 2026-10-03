import { useState, type FormEvent } from 'react'
import { Navigate } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import { useAuth } from '../lib/auth'
import { timeAgoLong } from '../lib/utils'
import { Avatar } from '../components/Avatar'
import { ConfirmDialog } from '../components/ConfirmDialog'
import type { AdminUser } from '../types'

const ROLE_LABEL: Record<AdminUser['role'], string> = { owner: 'Dono', admin: 'Admin', member: 'Membro' }

type Pending =
  | { kind: 'reset'; user: AdminUser }
  | { kind: 'status'; user: AdminUser }
  | { kind: 'role'; user: AdminUser }

/**
 * Contas só nascem aqui. O administrador cria, a pessoa recebe usuário e
 * senha provisória por um canal privado e escolhe a própria senha no
 * primeiro acesso.
 */
export function AdminUsers() {
  const { user: me } = useAuth()
  const qc = useQueryClient()
  const { data: users = [], isLoading } = useQuery({ queryKey: ['admin-users'], queryFn: api.admin.users, enabled: me.is_admin })

  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [role, setRole] = useState<'member' | 'admin'>('member')
  const [formError, setFormError] = useState<string | null>(null)
  const [credentials, setCredentials] = useState<{ username: string; password: string; reset: boolean } | null>(null)
  const [pending, setPending] = useState<Pending | null>(null)
  const [copied, setCopied] = useState(false)

  const refresh = () => qc.invalidateQueries({ queryKey: ['admin-users'] })

  const create = useMutation({
    mutationFn: api.admin.createUser,
    onSuccess: ({ user, temporary_password }) => {
      setUsername(''); setDisplayName(''); setRole('member'); setFormError(null)
      if (temporary_password) setCredentials({ username: user.username, password: temporary_password, reset: false })
      refresh()
    },
    onError: (err: Error) => setFormError(err.message),
  })

  const act = useMutation({
    mutationFn: async (p: Pending) => {
      if (p.kind === 'reset') {
        const res = await api.admin.resetPassword(p.user.id)
        setCredentials({ username: res.user.username, password: res.temporary_password, reset: true })
        return
      }
      if (p.kind === 'status') {
        await api.admin.updateUser(p.user.id, { status: p.user.status === 'active' ? 'disabled' : 'active' })
        return
      }
      await api.admin.updateUser(p.user.id, { role: p.user.role === 'admin' ? 'member' : 'admin' })
    },
    onSettled: () => { setPending(null); refresh() },
  })

  if (!me.is_admin) return <Navigate to="/" replace />

  const submit = (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim()) return setFormError('Escolha um usuário.')
    create.mutate({ username: username.trim(), display_name: displayName.trim() || username.trim(), role })
  }

  const copy = async () => {
    if (!credentials) return
    await navigator.clipboard?.writeText(`Usuário: ${credentials.username}\nSenha provisória: ${credentials.password}`).catch(() => {})
    setCopied(true)
    window.setTimeout(() => setCopied(false), 2000)
  }

  const canManage = (u: AdminUser) =>
    u.id !== me.id && u.role !== 'owner' && (u.role === 'member' || me.role === 'owner')

  const confirmText = (p: Pending): { title: string; message: string; label: string; danger: boolean } => {
    if (p.kind === 'reset') return {
      title: `Gerar nova senha para ${p.user.display_name}?`,
      message: 'A senha atual deixa de valer, as sessões abertas são encerradas e a pessoa terá de escolher uma nova senha no próximo acesso.',
      label: 'Gerar senha provisória', danger: true,
    }
    if (p.kind === 'status') return p.user.status === 'active'
      ? { title: `Desativar ${p.user.display_name}?`, message: 'A pessoa é desconectada na hora, não consegue mais entrar e as integrações dela param. Nada é apagado — dá para reativar depois.', label: 'Desativar', danger: true }
      : { title: `Reativar ${p.user.display_name}?`, message: 'A pessoa volta a conseguir entrar com a senha que já tinha.', label: 'Reativar', danger: false }
    return p.user.role === 'admin'
      ? { title: `Tirar o acesso de admin de ${p.user.display_name}?`, message: 'A pessoa continua com a conta, mas deixa de criar e gerenciar contas e de mexer nas chaves da instância.', label: 'Tornar membro', danger: false }
      : { title: `Tornar ${p.user.display_name} admin?`, message: 'Admins criam contas, geram senhas provisórias para membros e configuram as chaves de API da instância.', label: 'Tornar admin', danger: false }
  }

  return (
    <div className="px-6 py-8 max-w-3xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-primary mb-1">Usuários</h1>
        <p className="text-muted" style={{ fontSize: 16 }}>
          Só um administrador cria contas. Cada pessoa tem a própria biblioteca, diário, listas e integrações — ninguém enxerga as credenciais de ninguém.
        </p>
      </div>

      {credentials && (
        <div role="status" className="bg-surface border border-accent rounded-xl p-5 mb-6">
          <h2 className="font-medium text-primary mb-2">
            {credentials.reset ? 'Nova senha provisória' : 'Conta criada'} — copie agora
          </h2>
          <p className="text-secondary mb-4" style={{ fontSize: 15 }}>
            Envie por um canal privado. A senha não aparece de novo, e a pessoa terá de trocá-la no primeiro acesso.
          </p>
          <dl className="grid gap-2 mb-4" style={{ gridTemplateColumns: 'auto 1fr', fontSize: 16 }}>
            <dt className="text-muted">Usuário</dt><dd className="text-primary font-mono">{credentials.username}</dd>
            <dt className="text-muted">Senha</dt><dd className="text-primary font-mono select-all">{credentials.password}</dd>
          </dl>
          <div className="flex gap-2">
            <button type="button" onClick={copy} className="px-4 py-2 rounded-lg bg-accent text-bg font-medium hover:opacity-90">
              {copied ? 'Copiado!' : 'Copiar'}
            </button>
            <button type="button" onClick={() => setCredentials(null)} className="px-4 py-2 rounded-lg border border-border-strong text-secondary hover:text-primary">
              Pronto
            </button>
          </div>
        </div>
      )}

      <form onSubmit={submit} className="bg-surface border border-border rounded-xl p-5 mb-6" aria-labelledby="new-user">
        <h2 id="new-user" className="font-medium text-primary mb-4">Nova conta</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor="nu-user" className="block text-sm font-medium text-secondary mb-1.5">Usuário</label>
            <input id="nu-user" value={username} onChange={e => setUsername(e.target.value.toLowerCase())} autoComplete="off" spellCheck={false}
              placeholder="ex.: maria" className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-primary outline-none focus:border-accent" style={{ fontSize: 16 }} />
          </div>
          <div>
            <label htmlFor="nu-name" className="block text-sm font-medium text-secondary mb-1.5">Nome de exibição</label>
            <input id="nu-name" value={displayName} onChange={e => setDisplayName(e.target.value)} autoComplete="off"
              placeholder="ex.: Maria Souza" className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-primary outline-none focus:border-accent" style={{ fontSize: 16 }} />
          </div>
        </div>
        {me.role === 'owner' && (
          <fieldset className="mt-4">
            <legend className="text-sm font-medium text-secondary mb-2">Papel</legend>
            <div className="flex gap-2">
              {(['member', 'admin'] as const).map(r => (
                <button key={r} type="button" aria-pressed={role === r} onClick={() => setRole(r)}
                  className={`px-4 py-2 rounded-lg border ${role === r ? 'border-accent text-accent bg-card' : 'border-border text-muted bg-card hover:border-accent'}`}>
                  {r === 'member' ? 'Membro' : 'Admin'}
                </button>
              ))}
            </div>
          </fieldset>
        )}
        {formError && <p role="alert" className="text-movies mt-4" style={{ fontSize: 15 }}>{formError}</p>}
        <button type="submit" disabled={create.isPending} className="mt-4 px-5 py-2.5 bg-accent text-bg rounded-lg font-medium hover:opacity-90 disabled:opacity-60">
          {create.isPending ? 'Criando…' : 'Criar conta com senha provisória'}
        </button>
      </form>

      <h2 className="font-display text-xl font-bold text-primary mb-3">Contas</h2>
      {isLoading ? (
        <p className="text-muted">Carregando…</p>
      ) : (
        <ul className="space-y-2">
          {users.map(u => (
            <li key={u.id} className={`bg-surface border border-border rounded-xl p-4 flex items-center gap-4 flex-wrap ${u.status === 'disabled' ? 'opacity-60' : ''}`}>
              <Avatar name={u.display_name} url={u.avatar_url} id={u.id} size={44} />
              <div className="flex-1 min-w-[180px]">
                <p className="text-primary font-medium" style={{ fontSize: 16 }}>
                  {u.display_name} <span className="text-muted font-normal">@{u.username}</span>
                </p>
                <p className="text-xs text-muted mt-0.5 flex gap-2 flex-wrap">
                  <span className={u.role === 'member' ? '' : 'text-accent'}>{ROLE_LABEL[u.role]}</span>
                  {u.status === 'disabled' && <span className="text-movies">Desativada</span>}
                  {u.must_change_password && u.status === 'active' && <span className="text-gold" style={{ color: 'var(--gold)' }}>Senha provisória pendente</span>}
                  <span>{u.last_seen_at ? `Visto ${timeAgoLong(u.last_seen_at)}` : 'Nunca entrou'}</span>
                </p>
              </div>
              {canManage(u) && (
                <div className="flex gap-2 flex-wrap">
                  <button type="button" onClick={() => setPending({ kind: 'reset', user: u })}
                    className="text-sm px-3 py-1.5 rounded-lg border border-border text-secondary hover:border-accent hover:text-primary">
                    Nova senha
                  </button>
                  {me.role === 'owner' && (
                    <button type="button" onClick={() => setPending({ kind: 'role', user: u })}
                      className="text-sm px-3 py-1.5 rounded-lg border border-border text-secondary hover:border-accent hover:text-primary">
                      {u.role === 'admin' ? 'Tornar membro' : 'Tornar admin'}
                    </button>
                  )}
                  <button type="button" onClick={() => setPending({ kind: 'status', user: u })}
                    className={`text-sm px-3 py-1.5 rounded-lg border border-border hover:border-accent ${u.status === 'active' ? 'text-movies' : 'text-games'}`}>
                    {u.status === 'active' ? 'Desativar' : 'Reativar'}
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {pending && (() => {
        const t = confirmText(pending)
        return (
          <ConfirmDialog
            open
            title={t.title}
            message={t.message}
            confirmLabel={t.label}
            danger={t.danger}
            busy={act.isPending}
            onConfirm={() => act.mutate(pending)}
            onCancel={() => setPending(null)}
          />
        )
      })()}
    </div>
  )
}
