import { Suspense, useState, useCallback, useEffect, useRef } from 'react'
import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import { useHotkey } from '../hooks/useHotkey'
import { useTheme } from '../hooks/useTheme'
import { SearchModal } from './SearchModal'
import { NowPlayingBar } from './NowPlayingBar'
import { CATEGORIES } from '../lib/categories'
import { useAuth } from '../lib/auth'
import { Avatar } from './Avatar'
import { NotificationBell } from './social/NotificationBell'

const NAV = [
  { to: '/',         label: 'Home',        end: true  },
  { to: '/feed',     label: 'Feed',        end: false },
  { to: '/library',  label: 'Biblioteca',  end: false },
  { to: '/wishlist', label: 'Wishlist',  end: false },
  { to: '/backlog',  label: 'Backlog',   end: false },
  { to: '/diary',    label: 'Diário',      end: false },
  { to: '/lists',    label: 'Listas',      end: false },
  { to: '/wrap',     label: 'Wrap',        end: false },
]

const navLinkStyle = (isActive: boolean) => ({
  padding: '8px 16px',
  fontSize: 14,
  fontWeight: 500,
  color: isActive ? 'var(--accent)' : 'var(--text-muted)',
  cursor: 'pointer',
  borderRadius: 9999,
  background: isActive ? 'var(--card)' : 'transparent',
  transition: 'color .28s, background .28s',
  textDecoration: 'none',
  whiteSpace: 'nowrap' as const,
})

/* ─── Biblioteca nav item: click → /library, hover → categorias ─── */
function LibraryNavItem() {
  const [open, setOpen] = useState(false)
  const closeTimer = useRef<number>()

  const enter = () => { window.clearTimeout(closeTimer.current); setOpen(true) }
  const leave = () => { closeTimer.current = window.setTimeout(() => setOpen(false), 120) }

  return (
    <div style={{ position: 'relative' }} onMouseEnter={enter} onMouseLeave={leave}>
      <NavLink
        to="/library"
        style={({ isActive }) => ({ ...navLinkStyle(isActive), display: 'inline-flex', alignItems: 'center', gap: 6 })}
        className={({ isActive }) => isActive ? '' : 'hover-nav-link'}
      >
        Biblioteca
        <span
          aria-hidden
          style={{
            fontSize: 9,
            display: 'inline-block',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
            transition: 'transform .2s',
          }}
        >
          ▾
        </span>
      </NavLink>

      {/* Dropdown de categorias */}
      <div
        style={{
          position: 'absolute', top: 'calc(100% + 8px)', left: 0,
          minWidth: 200, background: 'var(--card)',
          border: '1px solid var(--border-strong)', borderRadius: 12,
          padding: 8, boxShadow: '0 16px 48px rgba(0,0,0,.45)',
          opacity: open ? 1 : 0, pointerEvents: open ? 'all' : 'none',
          transform: open ? 'translateY(0)' : 'translateY(-6px)',
          transition: 'opacity .2s, transform .2s',
          zIndex: 120,
        }}
      >
        {CATEGORIES.map(cat => (
          <NavLink
            key={cat.key}
            to={cat.path}
            onClick={() => setOpen(false)}
            className="menu-item"
            style={{
              display: 'flex', alignItems: 'center', gap: 12, width: '100%',
              padding: '10px 14px', borderRadius: 8, cursor: 'pointer',
              fontSize: 14, color: 'var(--text-muted)', textDecoration: 'none',
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>{cat.emoji}</span>
            {cat.label}
          </NavLink>
        ))}
      </div>
    </div>
  )
}

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

/* ─── Bottom-nav icons (mobile) ─── */
const iconProps = { width: 22, height: 22, fill: 'none', viewBox: '0 0 24 24', stroke: 'currentColor', strokeWidth: 2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const }
function HomeIcon()    { return (<svg {...iconProps}><path d="M3 10.5 12 3l9 7.5"/><path d="M5 9.5V21h14V9.5"/></svg>) }
function LibraryIcon() { return (<svg {...iconProps}><rect x="4" y="3" width="5" height="18" rx="1"/><rect x="11" y="3" width="5" height="18" rx="1"/><path d="M18.5 4.5l2.4 16"/></svg>) }
function DiaryIcon()   { return (<svg {...iconProps}><path d="M6 3h11a2 2 0 012 2v14a2 2 0 01-2 2H6a1 1 0 01-1-1V4a1 1 0 011-1z"/><path d="M9 3v18"/></svg>) }
function WishlistIcon() { return (<svg {...iconProps}><path d="M20.8 4.6a5.5 5.5 0 00-7.8 0L12 5.6l-1-1a5.5 5.5 0 00-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 000-7.8z"/></svg>) }
function BacklogIcon()  { return (<svg {...iconProps}><rect x="3" y="4" width="18" height="5" rx="1"/><path d="M5 9v10a1 1 0 001 1h12a1 1 0 001-1V9"/><path d="M10 13h4"/></svg>) }
function ListsIcon()   { return (<svg {...iconProps}><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>) }
function FeedIcon()    { return (<svg {...iconProps}><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87M16 3.13a4 4 0 010 7.75"/></svg>) }

const BOTTOM_NAV = [
  { to: '/',         label: 'Home',   end: true,  Icon: HomeIcon },
  { to: '/feed',     label: 'Feed',   end: false, Icon: FeedIcon },
  { to: '/library',  label: 'Biblioteca', end: false, Icon: LibraryIcon },
  { to: '/wishlist', label: 'Wishlist', end: false, Icon: WishlistIcon },
  { to: '/backlog',  label: 'Backlog', end: false, Icon: BacklogIcon },
  { to: '/diary',    label: 'Diário', end: false, Icon: DiaryIcon },
  { to: '/lists',    label: 'Listas', end: false, Icon: ListsIcon },
]

/* ─── Main Layout ─── */
export function Layout() {
  const [searchOpen, setSearchOpen] = useState(false)
  const [dropOpen, setDropOpen] = useState(false)
  const { dark, toggle } = useTheme()
  const { user, logout } = useAuth()
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
        display: 'flex', alignItems: 'center', padding: '0 var(--page-x)',
        background: dark ? 'rgba(8,8,17,.88)' : 'rgba(245,245,239,.92)',
        backdropFilter: 'blur(24px)',
        borderBottom: '1px solid var(--border)',
      }}>
        {/* Logo */}
        <button
          onClick={() => navigate('/')}
          style={{
            fontFamily: 'Space Grotesk, sans-serif', fontWeight: 800, fontSize: 20,
            color: 'var(--text-primary)', marginRight: 48, cursor: 'pointer',
            letterSpacing: '-0.5px', background: 'none', border: 'none', padding: 0,
          }}
        >
          Shel<span style={{ color: 'var(--accent)' }}>ved.</span>
        </button>

        {/* Nav links (desktop) */}
        <div className="desktop-only" style={{ display: 'flex', alignItems: 'center', gap: 4, flex: 1 }}>
          {NAV.map(item => (
            item.to === '/library' ? (
              <LibraryNavItem key={item.to} />
            ) : (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                style={({ isActive }) => navLinkStyle(isActive)}
                className={({ isActive }) => isActive ? '' : 'hover-nav-link'}
              >
                {item.label}
              </NavLink>
            )
          ))}
        </div>

        {/* Right controls */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
          {/* Add button (desktop — mobile uses the floating FAB) */}
          <button
            onClick={openSearch}
            title="Adicionar mídia (⌘K)"
            className="btn-accent desktop-only"
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '7px 16px',
              background: 'var(--accent)', border: 'none',
              borderRadius: 9999, cursor: 'pointer',
              color: '#000', fontSize: 13, fontWeight: 600,
            }}
          >
            <span style={{ fontSize: 18, lineHeight: 1 }}>+</span>
            <span>Adicionar</span>
          </button>

          {/* Search */}
          <button
            onClick={openSearch}
            className="icon-btn"
            style={{
              display: 'flex', alignItems: 'center', gap: 8,
              padding: '7px 14px',
              background: 'var(--card)', border: '1px solid var(--border-strong)',
              borderRadius: 9999, cursor: 'pointer',
              color: 'var(--text-muted)', fontSize: 13,
            }}
          >
            <SearchIcon />
            <span className="desktop-only" style={{ fontFamily: 'Space Grotesk, monospace', fontSize: 11, color: 'var(--dim)' }}>⌘K</span>
          </button>

          <NotificationBell />

          {/* Theme toggle */}
          <button
            onClick={toggle}
            title={dark ? 'Tema claro' : 'Tema escuro'}
            className="icon-btn"
            style={{
              width: 36, height: 36, borderRadius: '50%',
              background: 'transparent', border: '1px solid var(--border-strong)',
              cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
              color: 'var(--text-muted)',
            }}
          >
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>

          {/* Profile button + dropdown */}
          <div ref={dropRef} style={{ position: 'relative' }}>
            <button
              onClick={() => setDropOpen(o => !o)}
              aria-label={`Menu da conta de ${user.display_name}`}
              aria-expanded={dropOpen}
              style={{
                width: 40, height: 40, borderRadius: '50%', padding: 0,
                background: 'var(--card)', border: '1.5px solid var(--border-strong)',
                cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                color: 'var(--text-muted)', transition: 'background .2s, border-color .2s', overflow: 'hidden',
              }}
            >
              <Avatar name={user.display_name} url={user.avatar_url} id={user.id} size={37} />
            </button>

            {/* Dropdown */}
            <div style={{
              position: 'absolute', top: 'calc(100% + 8px)', right: 0,
              minWidth: 220, background: 'var(--card)',
              border: '1px solid var(--border-strong)', borderRadius: 12,
              padding: 8, boxShadow: '0 16px 48px rgba(0,0,0,.6)',
              opacity: dropOpen ? 1 : 0, pointerEvents: dropOpen ? 'all' : 'none',
              transform: dropOpen ? 'translateY(0)' : 'translateY(-6px)',
              transition: 'opacity .2s, transform .2s',
            }}>
              <div style={{ padding: '8px 16px 10px', borderBottom: '1px solid var(--border)', marginBottom: 6 }}>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>{user.display_name}</div>
                <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>@{user.username}</div>
              </div>
              {[
                { icon: '👤', label: 'Perfil', action: () => { setDropOpen(false); navigate('/profile') } },
                { icon: '🪪', label: 'Minha conta', action: () => { setDropOpen(false); navigate('/account') } },
                ...(user.is_admin ? [{ icon: '🛡️', label: 'Usuários', action: () => { setDropOpen(false); navigate('/admin/users') } }] : []),
                { icon: '🔌', label: 'Integrações', action: () => { setDropOpen(false); navigate('/integrations') } },
                { icon: '📦', label: 'Importação/Exportação', action: () => { setDropOpen(false); navigate('/import-export') } },
                { icon: '⚙️', label: 'Configurações', action: () => { setDropOpen(false); navigate('/settings') } },
                { icon: '🚪', label: 'Sair', action: () => { setDropOpen(false); logout() } },
              ].map(item => (
                <button
                  key={item.label}
                  onClick={item.action}
                  className="menu-item"
                  style={{
                    display: 'flex', alignItems: 'center', gap: 10, width: '100%', padding: '10px 16px',
                    borderRadius: 8, cursor: 'pointer', fontSize: 14,
                    color: 'var(--text-muted)', background: 'none', border: 'none',
                    textAlign: 'left', whiteSpace: 'nowrap',
                  }}
                >
                  <span style={{ fontSize: 16, lineHeight: 1 }}>{item.icon}</span>
                  <span>{item.label}</span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </nav>

      {/* Barra "assistindo/ouvindo agora" (sob a navbar) */}
      <NowPlayingBar />

      {/* Main content */}
      <main style={{ paddingTop: 'calc(var(--nav-h) + var(--npbar-h, 0px))', paddingBottom: 'var(--bottomnav-h)', minHeight: '100vh', transition: 'padding-top .2s' }}>
        <Suspense fallback={
          <div className="min-h-[45vh] grid place-items-center text-sm text-muted" role="status" aria-live="polite">
            Carregando página…
          </div>
        }>
          <Outlet />
        </Suspense>
      </main>

      {/* Floating "Add" button (mobile only) */}
      <button
        onClick={openSearch}
        aria-label="Adicionar mídia"
        className="mobile-only btn-accent"
        style={{
          position: 'fixed',
          right: 'var(--page-x)',
          bottom: 'calc(var(--bottomnav-h) + 16px)',
          width: 56, height: 56, borderRadius: '50%',
          background: 'var(--accent)', border: 'none', color: '#000',
          alignItems: 'center', justifyContent: 'center',
          fontSize: 30, lineHeight: 1, cursor: 'pointer', zIndex: 129,
          boxShadow: '0 8px 24px rgba(0,0,0,.4)',
        }}
      >
        +
      </button>

      {/* Bottom tab bar (mobile only) */}
      <nav className="bottom-nav" aria-label="Navegação">
        {BOTTOM_NAV.map(({ to, label, end, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) => 'bottom-nav-item' + (isActive ? ' active' : '')}
          >
            <span className="bn-icon"><Icon /></span>
            {label}
          </NavLink>
        ))}
      </nav>

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
