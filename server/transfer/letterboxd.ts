/**
 * Leitura dos CSVs exportados pelo Letterboxd.
 *
 * O export vem como um .zip com vários arquivos de mesmo cabeçalho base
 * (`Date,Name,Year,Letterboxd URI`) e colunas extras por tipo:
 *
 * - `watched.csv`   — tudo o que já foi visto
 * - `watchlist.csv` — o que se quer ver (vira backlog no Shelf)
 * - `ratings.csv`   — visto + nota (`Rating`)
 * - `diary.csv`     — cada sessão, com `Watched Date` e `Rewatch`
 *
 * `watched.csv` e `watchlist.csv` têm cabeçalho idêntico: só o nome do arquivo
 * distingue os dois, por isso `detectKind` também olha o nome e a UI deixa
 * escolher.
 *
 * Puro de propósito (sem banco, sem rede) — é a parte que precisa de teste.
 */

export type LetterboxdKind = 'watched' | 'watchlist' | 'ratings' | 'diary'

export interface LetterboxdRow {
  name: string
  year: number | null
  /** 0.5–5 em passos de meio ponto — mesma escala do Shelf. */
  rating: number | null
  /** Data da sessão (YYYY-MM-DD): `Watched Date` no diário, `Date` nos demais. */
  watchedAt: string | null
  uri: string | null
  rewatch: boolean
  review: string | null
}

/** CSV RFC 4180: aspas duplas escapadas por duplicação, campos com quebra de linha. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  let started = false

  const endField = () => { row.push(field); field = ''; started = false }
  const endRow = () => {
    endField()
    if (row.length > 1 || row[0] !== '') rows.push(row)
    row = []
  }

  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++ }
        else quoted = false
      } else field += ch
      continue
    }
    if (ch === '"' && !started) { quoted = true; started = true; continue }
    if (ch === ',') { endField(); continue }
    if (ch === '\r') continue
    if (ch === '\n') { endRow(); continue }
    field += ch
    started = true
  }
  if (field !== '' || row.length > 0) endRow()

  return rows
}

function pick(headers: string[], row: string[], name: string): string {
  const i = headers.findIndex(h => h.trim().toLowerCase() === name.toLowerCase())
  return i >= 0 ? (row[i] ?? '').trim() : ''
}

/** Um YYYY-MM-DD válido, ou null. O Letterboxd sempre exporta nesse formato. */
function isoDate(v: string): string | null {
  const m = v.match(/^(\d{4})-(\d{2})-(\d{2})/)
  return m ? m[0] : null
}

export function detectKind(headers: string[], filename = ''): LetterboxdKind {
  const h = headers.map(x => x.trim().toLowerCase())
  const f = filename.toLowerCase()
  if (h.includes('watched date')) return 'diary'
  if (f.includes('watchlist')) return 'watchlist'
  if (h.includes('rating')) return 'ratings'
  if (f.includes('watched')) return 'watched'
  return 'watched'
}

export interface LetterboxdFile {
  kind: LetterboxdKind
  headers: string[]
  rows: LetterboxdRow[]
}

export function parseLetterboxd(text: string, filename = ''): LetterboxdFile {
  const table = parseCsv(text)
  if (table.length === 0) return { kind: 'watched', headers: [], rows: [] }

  const headers = table[0].map(h => h.trim())
  const kind = detectKind(headers, filename)

  const rows: LetterboxdRow[] = []
  for (const raw of table.slice(1)) {
    const name = pick(headers, raw, 'Name')
    if (!name) continue

    const yearStr = pick(headers, raw, 'Year')
    const ratingStr = pick(headers, raw, 'Rating')
    const rating = ratingStr ? Number(ratingStr) : NaN

    rows.push({
      name,
      year: /^\d{4}$/.test(yearStr) ? Number(yearStr) : null,
      rating: Number.isFinite(rating) && rating > 0 ? Math.min(5, rating) : null,
      watchedAt: isoDate(pick(headers, raw, 'Watched Date')) ?? isoDate(pick(headers, raw, 'Date')),
      uri: pick(headers, raw, 'Letterboxd URI') || null,
      rewatch: pick(headers, raw, 'Rewatch').toLowerCase() === 'yes',
      review: pick(headers, raw, 'Review') || null,
    })
  }

  return { kind, headers, rows }
}

/** Slug do filme na URI do Letterboxd — chave de fallback quando o TMDB não responde. */
export function letterboxdSlug(uri: string | null, name: string): string {
  const fromUri = uri?.match(/letterboxd\.com\/film\/([^/?#]+)/)?.[1]
  if (fromUri) return fromUri
  return name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}
