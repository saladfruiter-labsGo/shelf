import { useState, type FormEvent, type ReactNode } from 'react'
import { api } from '../lib/api'
import type { SessionUser } from '../types'

const PASSWORD_MIN = 10

/* ─────────────────────────────── Moldura ─────────────────────────────── */

function Brand() {
  return (
    <div className="font-display font-extrabold text-primary" style={{ fontSize: 28, letterSpacing: '-0.5px' }}>
      Shel<span className="text-accent">ved.</span>
    </div>
  )
}

function AuthFrame({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-bg flex items-center justify-center px-4 py-10">
      <div className="w-full max-w-[420px]">
        <div className="mb-8 text-center"><Brand /></div>
        <div className="bg-surface border border-border rounded-xl p-6 sm:p-8" style={{ boxShadow: 'var(--shadow-lg)' }}>
          <h1 className="font-display text-2xl font-bold text-primary mb-2">{title}</h1>
          {subtitle && <p className="text-secondary mb-6" style={{ fontSize: 16, lineHeight: 1.5 }}>{subtitle}</p>}
          {children}
        </div>
      </div>
    </main>
  )
}

function Field(props: {
  id: string
  label: string
  type?: string
  value: string
  onChange: (value: string) => void
  autoComplete: string
  hint?: string
  autoFocus?: boolean
}) {
  return (
    <div className="mb-4">
      <label htmlFor={props.id} className="block text-sm font-medium text-secondary mb-1.5">{props.label}</label>
      <input
        id={props.id}
        type={props.type ?? 'text'}
        value={props.value}
        onChange={e => props.onChange(e.target.value)}
        autoComplete={props.autoComplete}
        autoFocus={props.autoFocus}
        spellCheck={false}
        autoCapitalize="none"
        className="w-full bg-card border border-border rounded-lg px-3 py-3 text-primary placeholder:text-muted outline-none focus:border-accent transition-colors"
        style={{ fontSize: 16 }}
        aria-describedby={props.hint ? `${props.id}-hint` : undefined}
      />
      {props.hint && <p id={`${props.id}-hint`} className="text-xs text-muted mt-1.5">{props.hint}</p>}
    </div>
  )
}

function FormError({ message }: { message: string | null }) {
  if (!message) return null
  return (
    <p role="alert" className="text-movies mb-4" style={{ fontSize: 15 }}>
      {message}
    </p>
  )
}

function Submit({ busy, children }: { busy: boolean; children: ReactNode }) {
  return (
    <button
      type="submit"
      disabled={busy}
      className="w-full flex items-center justify-center gap-2 px-5 py-3 bg-accent text-bg rounded-lg font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
      style={{ fontSize: 16 }}
    >
      {busy && <span className="w-4 h-4 border-2 border-bg border-t-transparent rounded-full animate-spin" aria-hidden />}
      {children}
    </button>
  )
}

function passwordIssue(password: string, confirm: string): string | null {
  if (password.length < PASSWORD_MIN) return `A senha precisa ter pelo menos ${PASSWORD_MIN} caracteres.`
  if (password !== confirm) return 'As duas senhas não são iguais.'
  return null
}

/* ─────────────────────────────── Telas ─────────────────────────────── */

export function AuthSplash({ failed, onRetry }: { failed: boolean; onRetry: () => void }) {
  return (
    <main className="min-h-screen bg-bg flex flex-col items-center justify-center gap-4 px-4" role="status" aria-live="polite">
      <Brand />
      {failed ? (
        <>
          <p className="text-secondary" style={{ fontSize: 16 }}>Não foi possível falar com o servidor do Shelf.</p>
          <button type="button" onClick={onRetry} className="px-4 py-2 rounded-lg border border-border-strong text-primary hover:border-accent">
            Tentar de novo
          </button>
        </>
      ) : (
        <span className="w-5 h-5 border-2 border-accent border-t-transparent rounded-full animate-spin" aria-label="Carregando" />
      )}
    </main>
  )
}

export function SetupScreen({ onDone }: { onDone: (user: SessionUser) => void }) {
  const [code, setCode] = useState('')
  const [username, setUsername] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const issue = passwordIssue(password, confirm)
    if (issue) return setError(issue)
    setBusy(true)
    setError(null)
    try {
      const { user } = await api.auth.setup({
        setup_code: code.trim(), username: username.trim(), display_name: displayName.trim(), password,
      })
      onDone(user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame
      title="Criar a conta de administrador"
      subtitle={<>Esta é a primeira vez que o Shelf abre. A conta que você criar agora fica com toda a biblioteca que já existe e é a única que cria novas contas.</>}
    >
      <form onSubmit={submit} noValidate>
        <Field
          id="setup-code" label="Código de instalação" value={code} onChange={setCode} autoComplete="one-time-code" autoFocus
          hint="Aparece no log do servidor ao iniciar (docker logs shelf) ou é o valor de SHELF_SETUP_TOKEN."
        />
        <Field id="setup-user" label="Usuário" value={username} onChange={v => setUsername(v.toLowerCase())} autoComplete="username"
          hint="Letras minúsculas, números, ponto, hífen ou _. É com ele que você entra." />
        <Field id="setup-name" label="Nome de exibição" value={displayName} onChange={setDisplayName} autoComplete="name" />
        <Field id="setup-pass" label="Senha" type="password" value={password} onChange={setPassword} autoComplete="new-password"
          hint={`Pelo menos ${PASSWORD_MIN} caracteres.`} />
        <Field id="setup-confirm" label="Repita a senha" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
        <FormError message={error} />
        <Submit busy={busy}>Criar conta e entrar</Submit>
      </form>
    </AuthFrame>
  )
}

export function LoginScreen({ onDone }: { onDone: (user: SessionUser) => void }) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!username.trim() || !password) return setError('Informe usuário e senha.')
    setBusy(true)
    setError(null)
    try {
      const { user } = await api.auth.login({ username: username.trim(), password })
      onDone(user)
    } catch (err) {
      setError((err as Error).message)
      setPassword('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthFrame title="Entrar" subtitle="Sua prateleira de filmes, séries, jogos, livros e música — e a dos seus amigos.">
      <form onSubmit={submit} noValidate>
        <Field id="login-user" label="Usuário" value={username} onChange={v => setUsername(v.toLowerCase())} autoComplete="username" autoFocus />
        <Field id="login-pass" label="Senha" type="password" value={password} onChange={setPassword} autoComplete="current-password" />
        <FormError message={error} />
        <Submit busy={busy}>Entrar</Submit>
      </form>
      <p className="text-sm text-muted mt-6 text-center">
        Não tem conta? Peça para o administrador do Shelf criar uma para você.
      </p>
    </AuthFrame>
  )
}

/** Troca de senha. Obrigatória (tela cheia) no primeiro acesso com senha provisória. */
export function ChangePasswordForm({ onDone, submitLabel = 'Salvar nova senha', currentLabel = 'Senha atual' }: {
  onDone: (user: SessionUser) => void
  submitLabel?: string
  currentLabel?: string
}) {
  const [current, setCurrent] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    const issue = passwordIssue(password, confirm)
    if (issue) return setError(issue)
    setBusy(true)
    setError(null)
    try {
      const { user } = await api.auth.changePassword({ current_password: current, new_password: password })
      setCurrent(''); setPassword(''); setConfirm('')
      setDone(true)
      onDone(user)
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} noValidate>
      <Field id="pw-current" label={currentLabel} type="password" value={current} onChange={setCurrent} autoComplete="current-password" />
      <Field id="pw-new" label="Nova senha" type="password" value={password} onChange={v => { setPassword(v); setDone(false) }} autoComplete="new-password"
        hint={`Pelo menos ${PASSWORD_MIN} caracteres. As outras sessões abertas são encerradas.`} />
      <Field id="pw-confirm" label="Repita a nova senha" type="password" value={confirm} onChange={setConfirm} autoComplete="new-password" />
      <FormError message={error} />
      {done && <p role="status" className="text-games mb-4" style={{ fontSize: 15 }}>Senha alterada.</p>}
      <Submit busy={busy}>{submitLabel}</Submit>
    </form>
  )
}

export function ChangePasswordScreen({ user, onDone, onLogout }: {
  user: SessionUser
  onDone: (user: SessionUser) => void
  onLogout: () => void
}) {
  return (
    <AuthFrame
      title={`Olá, ${user.display_name}!`}
      subtitle="Sua conta foi criada com uma senha provisória. Escolha a sua para continuar."
    >
      <ChangePasswordForm onDone={onDone} submitLabel="Definir senha e entrar" currentLabel="Senha provisória" />
      <button type="button" onClick={onLogout} className="w-full mt-3 text-sm text-muted hover:text-primary">
        Sair
      </button>
    </AuthFrame>
  )
}
