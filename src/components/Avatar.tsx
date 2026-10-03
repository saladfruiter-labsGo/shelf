const HUES = ['var(--movies)', 'var(--series)', 'var(--games)', 'var(--books)', 'var(--music)', 'var(--v)']

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase()
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase()
}

/** Foto de perfil, ou as iniciais numa cor estável por pessoa. */
export function Avatar({ name, url, id = 0, size = 40, ring = false }: {
  name: string
  url: string | null | undefined
  id?: number
  size?: number
  ring?: boolean
}) {
  const style = {
    width: size, height: size, borderRadius: '50%', flexShrink: 0,
    boxShadow: ring ? '0 0 0 2px var(--bg), 0 0 0 4px var(--accent)' : undefined,
  } as const
  if (url) {
    return <img src={url} alt="" width={size} height={size} style={{ ...style, objectFit: 'cover', background: 'var(--card)' }} />
  }
  return (
    <span
      aria-hidden
      style={{
        ...style,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: HUES[Math.abs(id) % HUES.length], color: '#0b0b12',
        fontWeight: 700, fontSize: Math.max(10, Math.round(size * 0.38)), letterSpacing: '-0.02em',
      }}
    >
      {initials(name)}
    </span>
  )
}
