import { useSyncExternalStore } from 'react'

/**
 * Tema claro/escuro, compartilhado por todos os componentes.
 *
 * O estado mora no módulo (e não em cada `useState`) porque há mais de um
 * controle na tela — o botão da navbar e o seletor em Configurações — e os dois
 * precisam refletir a mesma escolha na hora.
 */
const STORAGE_KEY = 'shelf-theme'

function initial(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved !== null) return saved === 'dark'
  } catch {}
  return true
}

let dark = initial()
const listeners = new Set<() => void>()

function apply() {
  document.documentElement.classList.toggle('dark', dark)
  try { localStorage.setItem(STORAGE_KEY, dark ? 'dark' : 'light') } catch {}
}

apply()

function setDark(next: boolean) {
  if (next === dark) return
  dark = next
  apply()
  for (const l of listeners) l()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export function useTheme() {
  const value = useSyncExternalStore(subscribe, () => dark, () => dark)
  return { dark: value, toggle: () => setDark(!dark), setDark }
}
