/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        bg:             'var(--bg)',
        surface:        'var(--surface)',
        card:           'var(--card)',
        'card-hover':   'var(--card-hover)',
        border:         'var(--border)',
        'border-strong':'var(--border-strong)',
        primary:        'var(--text-primary)',
        secondary:      'var(--text-secondary)',
        muted:          'var(--text-muted)',
        accent:         'var(--accent)',
        'accent-bg':    'var(--accent-bg)',
        movies:         'var(--movies)',
        'movies-bg':    'var(--movies-bg)',
        games:          'var(--games)',
        'games-bg':     'var(--games-bg)',
        series:         'var(--series)',
        'series-bg':    'var(--series-bg)',
        books:          'var(--books)',
        'books-bg':     'var(--books-bg)',
      },
      fontFamily: {
        display: ['"Barlow"', 'system-ui', 'sans-serif'],
        body:    ['"Barlow"', 'system-ui', 'sans-serif'],
        mono:    ['"JetBrains Mono"', 'monospace'],
      },
      borderRadius: {
        sm: '4px',
        md: '6px',
        lg: '10px',
        xl: '16px',
      },
    },
  },
  plugins: [],
}
