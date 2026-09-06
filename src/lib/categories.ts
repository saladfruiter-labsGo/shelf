import type { MediaType } from '../types'

export interface CategoryDef {
  key:      MediaType
  /** Plural label used across nav, home and library (ex.: "Filmes"). */
  label:    string
  emoji:    string
  path:     string
  /** CSS custom property holding the category hue. */
  colorVar: string
}

/** Single source of truth for the five libraries (order = display order). */
export const CATEGORIES: CategoryDef[] = [
  { key: 'movie',  label: 'Filmes',  emoji: '🎬', path: '/library/films',  colorVar: '--movies' },
  { key: 'series', label: 'Séries',  emoji: '📺', path: '/library/series', colorVar: '--series' },
  { key: 'game',   label: 'Jogos',   emoji: '🎮', path: '/library/games',  colorVar: '--games'  },
  { key: 'book',   label: 'Livros',  emoji: '📚', path: '/library/books',  colorVar: '--books'  },
  { key: 'music',  label: 'Músicas', emoji: '🎵', path: '/library/music',  colorVar: '--music'  },
]
