import { useEffect } from 'react'

export function useHotkey(key: string, callback: () => void) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const isK   = e.key.toLowerCase() === key.toLowerCase()
      const isMod = e.metaKey || e.ctrlKey
      if (isK && isMod) {
        e.preventDefault()
        callback()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [key, callback])
}
