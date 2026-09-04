import { useState, useCallback } from 'react'
import { NavLink, Outlet } from 'react-router-dom'
import { useHotkey } from '../hooks/useHotkey'
import { useTheme } from '../hooks/useTheme'
import { SearchModal } from './SearchModal'

const NAV = [
  { to: '/',         label: 'Dashboard',     icon: '⬛' },
  { to: '/library',  label: 'Biblioteca',    icon: '☰'  },
  { to: '/lists',    label: 'Listas',        icon: '♡'  },
  { to: '/wrap',     label: 'Wrap',          icon: '✦'  },
  { to: '/settings', label: 'Configurações', icon: '⚙'  },
]

function SunIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364-6.364l-.707.707M6.343 17.657l-.707.707M17.657 17.657l-.707-.707M6.343 6.343l-.707-.707M12 8a4 4 0 100 8 4 4 0 000-8z" />
    </svg>
  )
}

function MoonIcon() {
  return (
    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
        d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
    </svg>
  )
}

export function Layout() {
  const [searchOpen, setSearchOpen] = useState(false)
  const { dark, toggle } = useTheme()

  const openSearch = useCallback(() => setSearchOpen(true), [])
  useHotkey('k', openSearch)

  return (
    <div className="flex min-h-screen bg-bg">
      {/* Sidebar */}
      <aside className="w-52 flex-shrink-0 border-r border-border bg-bg hidden md:flex flex-col">
        <div className="px-5 py-5 border-b border-border">
          <h1 className="font-black text-xl tracking-[0.14em] uppercase text-primary">Shelf</h1>
          <p className="text-[0.56rem] font-semibold tracking-[0.2em] uppercase text-muted mt-1">Coleção pessoal</p>
        </div>

        <button
          onClick={openSearch}
          className="mx-3 mt-3 flex items-center gap-2 px-3 py-2 rounded-md bg-surface border border-border text-muted text-sm hover:border-border-strong hover:text-primary transition-colors"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <span className="flex-1 text-left text-sm">Buscar...</span>
          <kbd className="text-[10px] bg-bg px-1.5 py-0.5 rounded border border-border font-medium">⌘K</kbd>
        </button>

        <nav className="flex-1 py-4 px-2 overflow-y-auto">
          {NAV.map(item => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium mb-0.5 transition-colors ${
                  isActive
                    ? 'bg-accent-bg text-accent'
                    : 'text-muted hover:text-primary hover:bg-surface'
                }`
              }
            >
              <span className="text-base leading-none w-4 text-center">{item.icon}</span>
              {item.label}
            </NavLink>
          ))}
        </nav>

        <div className="px-4 py-3 border-t border-border flex items-center justify-between">
          <p className="text-[10px] font-semibold tracking-widest text-muted uppercase">v0.1.0</p>
          <button
            onClick={toggle}
            className="flex items-center gap-1.5 text-xs font-medium text-muted hover:text-primary transition-colors px-2 py-1 rounded-md bg-surface border border-border"
            title={dark ? 'Tema claro' : 'Tema escuro'}
          >
            {dark ? <SunIcon /> : <MoonIcon />}
            {dark ? 'Claro' : 'Escuro'}
          </button>
        </div>
      </aside>

      {/* Mobile header */}
      <div className="md:hidden fixed top-0 inset-x-0 z-40 bg-bg border-b border-border flex items-center justify-between px-4 h-14">
        <h1 className="font-black text-lg tracking-[0.14em] uppercase text-primary">Shelf</h1>
        <div className="flex items-center gap-3">
          <button onClick={toggle} className="text-muted hover:text-primary">
            {dark ? <SunIcon /> : <MoonIcon />}
          </button>
          <button onClick={openSearch} className="text-muted hover:text-primary">
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
            </svg>
          </button>
        </div>
      </div>

      {/* Main */}
      <main className="flex-1 overflow-x-hidden min-w-0 md:pt-0 pt-14 pb-20 md:pb-0">
        <Outlet />
      </main>

      {/* Mobile bottom nav */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-bg border-t border-border flex">
        {NAV.slice(0, 4).map(item => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === '/'}
            className={({ isActive }) =>
              `flex-1 flex flex-col items-center py-2 text-xs font-semibold transition-colors ${
                isActive ? 'text-accent' : 'text-muted'
              }`
            }
          >
            <span className="text-xl leading-none mb-0.5">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
      </nav>

      <SearchModal open={searchOpen} onClose={() => setSearchOpen(false)} />
    </div>
  )
}
