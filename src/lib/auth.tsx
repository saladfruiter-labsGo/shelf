import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { AUTH_EVENT, api } from './api'
import type { AuthState, SessionUser } from '../types'
import { ChangePasswordScreen, LoginScreen, SetupScreen, AuthSplash } from '../components/AuthScreens'

interface AuthContextValue {
  user: SessionUser
  setUser: (user: SessionUser) => void
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

/** A conta logada. Só existe dentro do `AuthGate` — ou seja, em todo o app. */
export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext)
  if (!value) throw new Error('useAuth fora do AuthGate')
  return value
}

/**
 * Porta de entrada: nada do app monta (nem dispara consulta) antes de haver
 * uma sessão válida com senha definitiva. Trocar de conta limpa o cache do
 * React Query, para nada de uma pessoa aparecer na tela da outra.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const [state, setState] = useState<AuthState | null>(null)
  const [failed, setFailed] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const next = await api.auth.state()
      setFailed(false)
      setState(prev => {
        if (prev && JSON.stringify(prev) === JSON.stringify(next)) return prev
        if (prev && prev.user?.id !== next.user?.id) qc.clear()
        return next
      })
    } catch {
      setFailed(true)
    }
  }, [qc])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    const onAuth = () => { refresh() }
    window.addEventListener(AUTH_EVENT, onAuth)
    // Ao voltar para a aba, confere se a sessão ainda vale (pode ter sido revogada).
    const onVisible = () => { if (document.visibilityState === 'visible') refresh() }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener(AUTH_EVENT, onAuth)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  const signedIn = useCallback((user: SessionUser) => {
    qc.clear()
    setState({ setup_required: false, user })
  }, [qc])

  const logout = useCallback(async () => {
    await api.auth.logout().catch(() => {})
    qc.clear()
    setState({ setup_required: false, user: null })
  }, [qc])

  const setUser = useCallback((user: SessionUser) => {
    setState({ setup_required: false, user })
  }, [])

  if (!state) return <AuthSplash failed={failed} onRetry={refresh} />
  if (state.setup_required) return <SetupScreen onDone={signedIn} />
  if (!state.user) return <LoginScreen onDone={signedIn} />
  if (state.user.must_change_password) {
    return <ChangePasswordScreen user={state.user} onDone={setUser} onLogout={logout} />
  }

  return (
    <AuthContext.Provider value={{ user: state.user, setUser, refresh, logout }}>
      {children}
    </AuthContext.Provider>
  )
}
