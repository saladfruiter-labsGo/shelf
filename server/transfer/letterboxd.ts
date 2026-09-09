/**
 * Leitura do export do Letterboxd: os CSVs e o plano do .zip inteiro.
 *
 * O export é um .zip com vários arquivos de mesmo cabeçalho base
 * (`Date,Name,Year,Letterboxd URI`) e colunas extras por tipo. O Shelf usa
 * cinco deles:
 *
 * - `watched.csv`   — tudo o que já foi visto
 * - `watchlist.csv` — o que se quer ver (vira backlog no Shelf)
 * - `ratings.csv`   — visto + nota (`Rating`)
 * - `reviews.csv`   — a sessão com o texto da resenha (`Review`)
 * - `diary.csv`     — cada sessão, com `Watched Date` e `Rewatch`
 *
 * `watched.csv` e `watchlist.csv` têm cabeçalho idêntico: só o nome do arquivo
 * distingue os dois, por isso `detectKind` também olha o nome — e, num CSV
 * avulso de nome qualquer, a tela deixa corrigir.
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
  /** Linhas de dados sem título, descartadas — a prévia mostra quantas foram. */
  discarded: number
}

export function parseLetterboxd(text: string, filename = ''): LetterboxdFile {
  const table = parseCsv(text)
  if (table.length === 0) return { kind: 'watched', headers: [], rows: [], discarded: 0 }

  const headers = table[0].map(h => h.trim())
  const kind = detectKind(headers, filename)

  const rows: LetterboxdRow[] = []
  let discarded = 0
  for (const raw of table.slice(1)) {
    const name = pick(headers, raw, 'Name')
    if (!name) { discarded++; continue }

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

  return { kind, headers, rows, discarded }
}

/** Slug do filme na URI do Letterboxd — chave de fallback quando o TMDB não responde. */
export function letterboxdSlug(uri: string | null, name: string): string {
  const fromUri = uri?.match(/letterboxd\.com\/film\/([^/?#]+)/)?.[1]
  if (fromUri) return fromUri
  return name.toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
}

/* ──────────────────────── Prévia do export completo ──────────────────────── */

/**
 * O export do Letterboxd traz muito mais do que o Shelf sabe usar. O plano
 * abaixo é o que a tela mostra **antes** de escrever qualquer coisa: quais
 * arquivos entram, o que cada um faz, quais ficaram de fora e por quê, e a
 * lista dos filmes que serão migrados.
 *
 * Puro de propósito: nada de banco e nada de rede. O casamento com o TMDB só
 * acontece quando o usuário confirma — é o passo lento, e não faria sentido
 * pagá-lo duas vezes (uma na prévia, outra na importação).
 */

/** Arquivos do export que o importador entende, na ordem em que são aplicados. */
export const RECOGNIZED: { path: string; kind: LetterboxdKind; does: string }[] = [
  { path: 'watched.csv',   kind: 'watched',   does: 'Marca como assistido tudo que está na lista' },
  { path: 'ratings.csv',   kind: 'ratings',   does: 'Traz a nota que você deu a cada filme' },
  // Antes do diary.csv de propósito: a mesma sessão aparece nos dois, mas só
  // aqui vem o texto da resenha, e a primeira a entrar é a que fica.
  { path: 'reviews.csv',   kind: 'diary',     does: 'Cada resenha vira um registro no diário, com o texto' },
  { path: 'diary.csv',     kind: 'diary',     does: 'Cada sessão vira um registro no diário, com data e nota' },
  { path: 'watchlist.csv', kind: 'watchlist', does: 'Vira backlog — não entra na biblioteca' },
]

const DOES: Record<LetterboxdKind, string> = {
  watched:   'Marca como assistido tudo que está na lista',
  ratings:   'Traz a nota que você deu a cada filme',
  diary:     'Cada sessão vira um registro no diário, com data e nota',
  watchlist: 'Vira backlog — não entra na biblioteca',
}

/** Por que um arquivo do export ficou de fora. */
export function ignoreReason(path: string): string {
  const p = path.toLowerCase()
  if (!p.endsWith('.csv'))      return 'Não é um CSV.'
  if (p.startsWith('likes/'))   return 'Curtidas não viram nota nem status no Shelf.'
  if (p.startsWith('lists/'))   return 'Listas do Letterboxd ainda não são importadas.'
  if (p.startsWith('deleted/')) return 'Conteúdo que você apagou no Letterboxd.'
  if (p === 'profile.csv')      return 'Só dados do seu perfil no Letterboxd.'
  if (p === 'comments.csv')     return 'Comentários em listas e resenhas não têm equivalente aqui.'
  return 'Arquivo que o importador não reconhece.'
}

export interface LetterboxdPlanFile {
  path: string
  kind: LetterboxdKind
  /** O que este arquivo faz na prateleira, em uma linha. */
  does: string
  /** Linhas com título — as que serão importadas. */
  rows: number
  /** Linhas sem título, descartadas na leitura. */
  discarded: number
  /** Nome fora do padrão do export: o tipo é palpite do cabeçalho e a tela deixa corrigir. */
  ambiguous: boolean
}

export interface LetterboxdPlanIgnored {
  path: string
  reason: string
}

export interface LetterboxdPlanTitle {
  name: string
  year: number | null
  slug: string
  /** Maior nota encontrada entre os arquivos, ou null. */
  rating: number | null
  /** Quantos registros de diário este filme vai gerar. */
  sessions: number
  /** Backlog quando só aparece na watchlist; biblioteca quando foi assistido. */
  target: 'library' | 'backlog'
}

export interface LetterboxdPlan {
  files: LetterboxdPlanFile[]
  ignored: LetterboxdPlanIgnored[]
  titles: LetterboxdPlanTitle[]
  totals: {
    titles: number
    library: number
    backlog: number
    sessions: number
    rated: number
    discardedRows: number
  }
}

export interface LetterboxdSource {
  path: string
  text: string
}

export interface PlanOptions {
  /**
   * `zip`: só os arquivos com nome do export entram; todo o resto é listado
   * como não identificado. `csv`: um arquivo avulso, cujo tipo sai do
   * cabeçalho (ou do `overrides`) mesmo com nome qualquer.
   */
  origin?: 'zip' | 'csv'
  /** Troca o tipo de um arquivo pelo caminho — `watched` × `watchlist`, sobretudo. */
  overrides?: Record<string, LetterboxdKind>
}

export function planLetterboxd(sources: LetterboxdSource[], opts: PlanOptions = {}): LetterboxdPlan {
  const { origin = 'zip', overrides = {} } = opts

  const files: LetterboxdPlanFile[] = []
  const ignored: LetterboxdPlanIgnored[] = []
  const titles = new Map<string, LetterboxdPlanTitle>()
  // Mesma mídia + mesma data = mesma sessão para o importador. Os arquivos se
  // sobrepõem — a noite de `reviews.csv` costuma estar no `diary.csv`, e a data
  // do `ratings.csv` no `watched.csv` —, então contar linha por linha prometeria
  // na prévia um diário maior do que o que vai ser criado.
  const sessions = new Map<string, Set<string>>()
  let discardedRows = 0

  const rank = (path: string) => {
    const i = RECOGNIZED.findIndex(r => r.path === path.toLowerCase())
    return i < 0 ? RECOGNIZED.length : i
  }

  for (const source of [...sources].sort((a, b) => rank(a.path) - rank(b.path))) {
    const entry = RECOGNIZED.find(r => r.path === source.path.toLowerCase())

    // Num zip, só os cinco nomes do export entram: `lists/watched.csv` é uma
    // lista chamada "watched", não o histórico, e casar por nome de arquivo
    // solto importaria a lista errada.
    if (!entry && origin === 'zip') {
      ignored.push({ path: source.path, reason: ignoreReason(source.path) })
      continue
    }

    const parsed = parseLetterboxd(source.text, source.path)
    if (parsed.rows.length === 0) {
      ignored.push({ path: source.path, reason: entry ? 'Arquivo vazio no export.' : ignoreReason(source.path) })
      continue
    }

    const kind = overrides[source.path] ?? entry?.kind ?? parsed.kind
    files.push({
      path: source.path,
      kind,
      does: entry && entry.kind === kind ? entry.does : DOES[kind],
      rows: parsed.rows.length,
      discarded: parsed.discarded,
      ambiguous: !entry,
    })
    discardedRows += parsed.discarded

    for (const row of parsed.rows) {
      const slug = letterboxdSlug(row.uri, row.name)
      let t = titles.get(slug)
      if (!t) {
        t = { name: row.name, year: row.year, slug, rating: null, sessions: 0, target: 'backlog' }
        titles.set(slug, t)
      }
      if (t.year == null) t.year = row.year
      if (row.rating != null && (t.rating == null || row.rating > t.rating)) t.rating = row.rating
      // A watchlist nunca rebaixa: basta um arquivo dizer "assistido" para o
      // filme ir à biblioteca, mesmo que ainda esteja na watchlist lá.
      if (kind !== 'watchlist') t.target = 'library'
      // Mesma condição do importador: toda linha assistida com data vira
      // sessão, venha ela do diário, do watched.csv ou do ratings.csv.
      if (kind !== 'watchlist' && row.watchedAt) {
        const dates = sessions.get(slug) ?? new Set<string>()
        dates.add(row.watchedAt)
        sessions.set(slug, dates)
      }
    }
  }

  for (const [slug, dates] of sessions) titles.get(slug)!.sessions = dates.size

  const list = [...titles.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'))
  return {
    files,
    ignored,
    titles: list,
    totals: {
      titles: list.length,
      library: list.filter(t => t.target === 'library').length,
      backlog: list.filter(t => t.target === 'backlog').length,
      sessions: list.reduce((n, t) => n + t.sessions, 0),
      rated: list.filter(t => t.rating != null).length,
      discardedRows,
    },
  }
}
