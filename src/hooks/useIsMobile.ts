import { useEffect, useState } from 'react'

/** Reage ao breakpoint mobile do projeto (mesmo 760px usado no index.css). */
export function useIsMobile(query = '(max-width: 760px)'): boolean {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia(query).matches,
  )

  useEffect(() => {
    const mql = window.matchMedia(query)
    const onChange = () => setMatches(mql.matches)
    onChange()
    mql.addEventListener('change', onChange)
    return () => mql.removeEventListener('change', onChange)
  }, [query])

  return matches
}
