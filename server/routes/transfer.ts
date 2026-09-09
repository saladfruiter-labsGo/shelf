import { Hono } from 'hono'
import { buildExport, exportCsv, exportSummary, type ExportScope } from '../transfer/export.js'
import { importShelfBackup, importLetterboxd, type ImportMode } from '../transfer/importer.js'
import { detectKind, type LetterboxdKind } from '../transfer/letterboxd.js'
import { importSteamWishlist } from '../steam/sync.js'
import * as steam from '../steam/client.js'

const app = new Hono()

const SCOPES: ExportScope[] = ['all', 'library', 'backlog']
const KINDS: LetterboxdKind[] = ['watched', 'watchlist', 'ratings', 'diary']

function scopeOf(v: string | undefined): ExportScope {
  return SCOPES.includes(v as ExportScope) ? (v as ExportScope) : 'all'
}

/** Sufixo do nome do arquivo baixado — o escopo escolhido e a data. */
function filename(scope: ExportScope, ext: string): string {
  const day = new Date().toISOString().slice(0, 10)
  return `shelf-${scope}-${day}.${ext}`
}

/* ─────────────────────────────── Exportação ──────────────────────────────── */

app.get('/export', (c) => {
  const scope = scopeOf(c.req.query('scope'))
  const format = c.req.query('format') === 'csv' ? 'csv' : 'json'

  if (format === 'csv') {
    // BOM: sem ele o Excel abre o CSV como latin-1 e quebra todo acento.
    return new Response('\uFEFF' + exportCsv(scope), {
      headers: {
        'Content-Type': 'text/csv; charset=utf-8',
        'Content-Disposition': `attachment; filename="${filename(scope, 'csv')}"`,
      },
    })
  }

  return new Response(JSON.stringify(buildExport(scope), null, 2), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename(scope, 'json')}"`,
    },
  })
})

/** Prévia (contagens) sem baixar nada — alimenta a tela de exportação. */
app.get('/export/summary', (c) => c.json(exportSummary()))

/* ─────────────────────────────── Importação ──────────────────────────────── */

app.post('/import/shelf', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { payload?: unknown; mode?: ImportMode } | null
  if (!body?.payload) return c.json({ error: 'Envie o conteúdo do arquivo em "payload".' }, 400)
  const mode: ImportMode = body.mode === 'replace' ? 'replace' : 'merge'
  return c.json(importShelfBackup(body.payload as any, mode))
})

app.post('/import/letterboxd', async (c) => {
  const body = (await c.req.json().catch(() => null)) as
    | { csv?: string; kind?: LetterboxdKind; filename?: string }
    | null
  const csv = body?.csv
  if (!csv?.trim()) return c.json({ error: 'Envie o CSV do Letterboxd em "csv".' }, 400)

  const kind = KINDS.includes(body?.kind as LetterboxdKind) ? body!.kind : undefined
  try {
    const report = await importLetterboxd(csv, { kind, filename: body?.filename })
    return c.json(report)
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }
})

/** Detecta o tipo do CSV sem importar — a UI mostra e deixa corrigir. */
app.post('/import/letterboxd/detect', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { csv?: string; filename?: string } | null
  const header = (body?.csv ?? '').split('\n')[0] ?? ''
  const headers = header.split(',').map(h => h.replace(/^"|"$/g, '').trim())
  return c.json({ kind: detectKind(headers, body?.filename ?? ''), headers })
})

/**
 * Uma passada da wishlist da Steam para o backlog. A Steam só alimenta o
 * backlog — a biblioteca de jogos consumidos vem do Playnite.
 */
app.post('/import/steam', async (c) => {
  if (!steam.cfg('STEAM_ID')) return c.json({ error: 'Configure o SteamID em Integrações antes de importar.' }, 400)
  return c.json(await importSteamWishlist())
})

export default app
