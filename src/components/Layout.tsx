import { useState, useCallback, useEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useQuery } from '@tanstack/react-query'
import { useHotkey } from '../hooks/useHotkey'
import { useTheme } from '../hooks/useTheme'
import { SearchModal } from './SearchModal'
import { api } from '../lib/api'
import type { MediaItem } from '../types'

const NAV = [
  { to: '/',        label: 'Home',        end: true  },
  { to: '/library', label: 'Biblioteca',  end: false },
  { to: '/diary',   label: 'Diário',      end: false },
  { to: '/lists',   label: 'Listas',      end: false },
  { to: '/wrap',    label: 'Wrap',        end: false },
]

function SunIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41"/>
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg width="16" height="16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 12.79A9 9 0 1111.21 3a7 7 0 009.79 9.79z"/>
    </svg>
  )
}

function SearchIcon() {
  return (
    <svg width="15" height="15" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
      <circle cx="11" cy="11" r="8"/><path d="M21 21l-4.35-4.35"/>
    </svg>
  )
}

/* ─── Profile Overlay (year-by-year stats) ─── */
function ProfileOverlay({ open, onClose }: { open: boolean; onClose: () => void }) {
  const overlayRef = useRef<HTMLDivElement>(null)

  const { data: allItems = [] } = useQuery({
    queryKey: ['media-all-profile'],
    queryFn: () => api.media.list({ limit: 1000 }),
    enabled: open,
  })

  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (overlayRef.current && !overlayRef.current.contains(e.target as Node)) onClose()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open, onClose])

  const currentYear = new Date().getFullYear()
  const years = Array.from({ length: currentYear - 2021 }, (_, i) => currentYear - i)

  const statsByYear = years.map(year => {
    const items = allItems.filter(item => {
      const y = new Date(item.added_at).getFullYear()
      return y === year
    })
    const done  = items.filter(i => i.status === 'completed').length
    const prog  = items.filter(i => i.status === 'in_progress').length
    return { year, total: items.length, done, prog }
  })

  return (
    <div
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.5)',
        display: open ? 'flex' : 'none',
        alignItems: 'flex-start',
        justifyContent: 'flex-end',
      }}
    >
      <div
        ref={overlayRef}
        style={{
          width: 360,
          height: '100vh',
          background: 'var(--surface)',
          borderLeft: '1px solid var(--border-strong)',
          padding: '32px 32px 48px',
          overflowY: 'auto',
          display: 'flex',
          flexDirection: 'column',
          gap: 0,
        }}
        className="animate-scale-in"
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 40 }}>
          <div>
            <p style={{ fontSize: 11, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '2px', color: 'var(--text-muted)', marginBottom: 4 }}>Perfil</p>
            <p style={{ fontFamily: 'Syne, sans-serif', fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-0.5px' }}>Sua prateleira</p>
          </div>
          <button
            onClick={onClose}
            style={{ width: 32, height: 32, borderRadius: '50%', background: 'var(--card)', border: '1px solid var(--border-strong)', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, lineHeight: 1 }}
          >×</button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
          {/* header row */}
          <div style={{ display: 'grid', gridTemplateColumns: '60px 1fr 60px 60px', gap: 8, paddingBottom: 12, borderBottom: '1px solid var(--border)', marginBottom: 4 }}>
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text-muted)' }}>Ano</span>
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text-muted)' }}>Total</span>
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text-muted)' }}>✓</span>
            <span style={{ fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '1.5px', color: 'var(--text-muted)' }}>▶</span>
          </div>
          {statsByYear.map(s => (
            <div
              key={s.year}
              style={{
                display: 'grid', gridTemplateColumns: '60px 1fr 60px 60px',
                gap: 8, padding: '16px 0',
                borderBottom: '1px solid var(--border)',
                opacity: s.total === 0 ? 0.35 : 1,
              }}
            >
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 13, fontWeight: 500, color: s.year === currentYear ? 'var(--accent)' : 'var(--text-muted)' }}>{s.year}</span>
              <span style={{ fontFamily: 'Syne, sans-serif', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>{s.total}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: 'var(--accent)', fontVariantNumeric: 'tabular-nums' }}>{s.done}</span>
              <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 15, color: 'var(--v)', fontVariantNumeric: 'tabular-nums' }}>{s.prog}</span>
            </div>
          ))}
        </div>

        <div style={{ marginTop: 40, padding: '16px', background: 'var(--card)', borderRadius: 8, border: '1px solid var(--border)' }}>
          <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            Total na biblioteca: <strong style={{ color: 'var(--text-primary)' }}>{allItems.length} itens</strong>
          </p>
        </div>
      </div>
    </div>
  )
}

/* ─── Main Layout ─── */
export function Layout() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [dropOpen, setDropOpen] = useState(false)
  const [profileOpen, setProfileOpen] = useState(false)
  const { dark, toggle } = useTheme()
  const navigate = useNavigate()
  const dropRef = useRef<HTMLDivElement>(null)

  const openSearch = useCallback(() => setSearchOpen(true), [])
  useHotkey('k', openSearch)

  useEffect(() => {
    if (!dropOpen) return
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) setDropOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [dropOpen])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* ─── Top navbar ─── */}
      <nav style={{
        position: 'fixed', top: 0, left: 0, right: 0,
        height: 'var(--nav-h)', zIndex: 100,
        display: 'flex', alignItems: 'center', padding: '0 32px',
        background: dark ? 'rgba(8,8,17,.88)' : 'rgba(245,245,239,.92)',
        backdropFilter: 'blur(24px)',
        borderBottom: '1px solid var(--border)',
      }}>
        {/* Logo */}
        <button
          onClick={() => navigate('/')}
          style={{
            fontFamily: 'Syne, sans-serif', fontWeight: 800, fontSize: 20,
            color: 'var(--text-primary)', marginRight: 48, cursor: 'pointer',
            letterSpacing: '-0.5px', background: 'none', border: 'none', padding: 0,
          }}
        >
          Shel<span style={{ color: 'var(--accent)' }}>ved.</span>
        </button>

        {/* Nav links */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              style={({ isActive }) => ({
                padding: '8px 16px',
                fontSize: 14, fontWeight: 500,
                color: isActive ? 'var(--accent)' : 'var(--text-muted)',
                cursor: 'pointer',
                borderRadius: 9999,
                background: isActive ? 'var(--card)' : 'transparent',
                transition: 'color .28s, background .28s',
                textDecoration: 'none',
                whiteSpace: 'nowrap',
              })}
              className={({ isActive }) => isActive ? '' : 'hover-nav-link'}
            >
              {item.label}
            </NavLink>
          ))}
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {/* Add button */}
          <button
            onClick={openSearch}
            title="Adicionar mídia (⌘K)"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px',
              background: 'var(--accent)', border: 'none',
              borderRadius: 9999, cursor: 'pointer',
              color: '#000', fontSize: 13, fontWeight: 600,
              transition: 'opacity .2s',
            }}
            onMouseEnter={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '0.85')}
            onMouseLeave={e => ((e.currentTarget as HTMLButtonElement).style.opacity = '1')}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
            <span>Adicionar</span>
          </button>

          {/* Search */}
          <button
            onClick={openSearch}
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 14px',
              background: 'var(--card)', border: '1px solid var(--border-strong)',
              borderRadius: 9999, cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 13,
              transition: 'border-color .2s, color .2s',
            }}
          >
            <SearchIcon />
            <span style={{ fontFamily: 'DM Mono, monospace', fontSize: 11, color: 'var(--dim)' }}>⌘K</span>
          </button>

          {/* Theme toggle */}
          <button
            onClick={toggle}
            title={dark ? 'Tema claro' : 'Tema escuro'}
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'transparent', border: '1px solid var(--border-strong)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)', transition: 'background .2s, color .2s',
            }}
          >
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>

          {/* Profile button + dropdown */}
          <div ref={dropRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setDropOpen(o => !o)}
              style={{
                width: 40, height: 40, borderRadius: '50%',
                background: 'var(--card)', border: '1.5px solid var(--border-strong)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 18, transition: 'background .2s, border-color .2s',
              }}
            >
              🎬
            </button>

            {/* Dropdown */}
            <div style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0,
              minWidth: 160, background: 'var(--card)',
              border: '1px solid var(--border-strong)', borderRadius: 12,
              padding: 8, boxShadow: '0 16px 48px rgba(0,0,0,.6)',
              opacity: dropOpen ? 1 : 0, pointerEvents: dropOpen ? 'all' : 'none',
              transform: dropOpen ? 'translateY(0)' : 'translateY(-6px)',
              transition: 'opacity .2s, transform .2s',
            }}>
              {[
                { label: '👤  Perfil', action: () => { setDropOpen(false); setProfileOpen(true) } },
                { label: '⚙️  Configurações', action: () => { setDropOpen(false); navigate('/settings') } },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={item.action}
                  style={{
                    display: 'flex', width: '100%', padding: '10px 16px',
                    borderRadius: 8, cursor: 'pointer', fontSize: 14,
                    color: 'var(--text-muted)', background: 'none', border: 'none',
                    transition: 'background .2s, color .2s', textAlign: 'left',
                  }}
                  onMouseEnter={e => {
                    ;(e.currentTarget as HTMLButtonElement).style.background = 'var(--card-hover)'
                    ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-primary)'
                  }}
                  onMouseLeave={e => {
                    ;(e.currentTarget as HTMLButtonElement).style.background = 'none'
                    ;(e.currentTarget as HTMLButtonElement).style.color = 'var(--text-muted)'
                  }}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* Main content */}
      <main style={{ paddingTop: 'var(--nav-h)', minHeight: '100vh' }}>
        <Outlet />
      </main>

      {/* Profile overlay */}
      <ProfileOverlay open={profileOpen} onClose={() => setProfileOpen(false)} />

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />

      <style>{`
        .hover-nav-link:hover {
          color: var(--text-primary) !important;
          background: var(--card) !important;
        }
      `}</style>
    </div>
  )
}
