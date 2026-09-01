import { useState, useEffect } from 'react'

export function useTheme() {
  const [dark, setDark] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem('shelf-theme')
      if (saved !== null) return saved === 'dark'
    } catch {}
    return true
  })

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    try { localStorage.setItem('shelf-theme', dark ? 'dark' : 'light') } catch {}
  }, [dark])

  return { dark, toggle: () => setDark(d => !d) }
}
