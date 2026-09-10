import { randomUUID } from 'node:crypto'
import { Hono } from 'hono'
import { buildExport, exportCsv, exportSummary, type ExportScope } from '../transfer/export.js'
import {
  importShelfBackup, applyLetterboxdPlan, countLetterboxdDiary, type ImportMode,
} from '../transfer/importer.js'
import {
  planLetterboxd,
  type LetterboxdKind, type LetterboxdPlan, type LetterboxdSource,
} from '../transfer/letterboxd.js'
import { readZip, looksLikeZip, stripRoot } from '../transfer/zip.js'
import { importSteamWishlist } from '../steam/sync.js'
import * as steam from '../steam/client.js'
import { backupStatus, createDatabaseBackup } from '../backup.js'

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

/** Estado dos snapshots integrais e criação manual sob demanda. */
app.get('/backup/status', async (c) => c.json(await backupStatus()))

app.post('/backup', async (c) => {
  try {
    return c.json(await createDatabaseBackup('manual'), 201)
  } catch (error) {
    return c.json({ error: `Não foi possível criar o snapshot: ${(error as Error).message}` }, 500)
  }
})

/* ─────────────────────────────── Importação ──────────────────────────────── */

app.post('/import/shelf', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { payload?: unknown; mode?: ImportMode } | null
  if (!body?.payload) return c.json({ error: 'Envie o conteúdo do arquivo em "payload".' }, 400)
  const mode: ImportMode = body.mode === 'replace' ? 'replace' : 'merge'
  try {
    await createDatabaseBackup('before-import')
  } catch (error) {
    return c.json({ error: `Importação cancelada porque o backup preventivo falhou: ${(error as Error).message}` }, 503)
  }
  return c.json(importShelfBackup(body.payload as any, mode))
})

/* ── Letterboxd: prévia → confirmar ou abortar ── */

/**
 * A importação do Letterboxd tem dois passos de propósito. O `.zip` do export
 * traz onze arquivos, dos quais o Shelf usa cinco; escrever tudo direto seria
 * um salto no escuro. Então `preview` lê o zip, monta o plano e **não toca no
 * banco**; `apply` executa aquele plano; `abort` joga fora.
 *
 * O plano fica em memória entre os dois passos porque re-ler o upload a cada
 * confirmação obrigaria o navegador a enviar o arquivo duas vezes.
 */
const MAX_UPLOAD  = 64 * 1024 * 1024
const MAX_ZIP_ENTRY = 32 * 1024 * 1024
const MAX_ZIP_TOTAL = 128 * 1024 * 1024
const MAX_ZIP_ENTRIES = 200
const PLAN_TTL_MS = 30 * 60_000
const MAX_PLANS   = 4

interface StoredPlan {
  plan: LetterboxdPlan
  sources: LetterboxdSource[]
  origin: 'zip' | 'csv'
  at: number
}

const plans = new Map<string, StoredPlan>()

/** Prévia é rascunho: a que expirou e as antigas demais são lixo. */
function sweepPlans(): void {
  const cutoff = Date.now() - PLAN_TTL_MS
  for (const [id, p] of plans) if (p.at < cutoff) plans.delete(id)
  while (plans.size > MAX_PLANS) plans.delete(plans.keys().next().value as string)
}

const isCsv = (path: string) => path.toLowerCase().endsWith('.csv')

/** Ruído que o Finder e alguns descompactadores enfiam no zip. */
const isJunk = (path: string) =>
  path.startsWith('__MACOSX/') || path.split('/').some(part => part.startsWith('.'))

/**
 * Só os CSVs são descompactados: o resto do export entra no plano só pelo nome,
 * para aparecer na lista do que ficou de fora sem custar memória.
 */
function zipSources(buf: Buffer): LetterboxdSource[] {
  const entries = readZip(buf, {
    maxEntries: MAX_ZIP_ENTRIES,
    maxEntrySize: MAX_ZIP_ENTRY,
    maxTotalSize: MAX_ZIP_TOTAL,
  }).filter(e => !isJunk(e.path))
  const rel = stripRoot(entries.map(e => e.path))

  return entries.map(e => {
    const path = rel(e.path)
    if (!isCsv(path)) return { path, text: '' }
    try {
      return { path, text: e.text() }
    } catch {
      // Entrada corrompida: sem texto ela cai como "não identificada" no plano,
      // em vez de derrubar a leitura do zip inteiro.
      return { path: `${path} (ilegível)`, text: '' }
    }
  })
}

app.post('/import/letterboxd/preview', async (c) => {
  const body = await c.req.parseBody().catch(() => null)
  const file = body?.file
  if (!(file instanceof File)) return c.json({ error: 'Envie o .zip ou o .csv do Letterboxd no campo "file".' }, 400)
  if (file.size === 0)         return c.json({ error: 'O arquivo enviado está vazio.' }, 400)
  if (file.size > MAX_UPLOAD)  return c.json({ error: `Arquivo grande demais (máximo ${MAX_UPLOAD / 1024 / 1024} MB).` }, 400)

  const buf = Buffer.from(await file.arrayBuffer())

  let sources: LetterboxdSource[]
  let origin: 'zip' | 'csv'
  try {
    if (looksLikeZip(buf)) {
      origin = 'zip'
      sources = zipSources(buf)
    } else {
      origin = 'csv'
      sources = [{ path: file.name || 'arquivo.csv', text: buf.toString('utf-8').replace(/^﻿/, '') }]
    }
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400)
  }

  const plan = planLetterboxd(sources, { origin })

  // Sem nada a importar não há o que confirmar — a resposta vai só com a lista
  // do que ficou de fora, e nenhum plano é guardado.
  // Quantos registros do diário já vieram de uma importação anterior — a tela
  // usa isso para oferecer "refazer" em vez de empilhar em cima do que existe.
  const existingDiary = countLetterboxdDiary()

  if (plan.files.length === 0) {
    return c.json({ planId: null, origin, filename: file.name, plan, existingDiary })
  }

  sweepPlans()
  const planId = randomUUID()
  plans.set(planId, { plan, sources, origin, at: Date.now() })
  return c.json({ planId, origin, filename: file.name, plan, existingDiary })
})

/**
 * Refaz o plano com o tipo corrigido na tela — `watched.csv` × `watchlist.csv`
 * num CSV avulso, onde o cabeçalho não distingue os dois. Usa o conteúdo já
 * guardado, sem novo upload, e substitui o plano no mesmo `planId` para os
 * números da prévia baterem com o que vai ser importado.
 */
app.post('/import/letterboxd/replan', async (c) => {
  sweepPlans()
  const body = (await c.req.json().catch(() => null)) as
    | { planId?: string; overrides?: Record<string, string> }
    | null

  const planId = body?.planId ?? ''
  const stored = plans.get(planId)
  if (!stored) return c.json({ error: 'A prévia expirou. Envie o arquivo de novo.' }, 404)

  const overrides: Record<string, LetterboxdKind> = {}
  for (const [path, kind] of Object.entries(body?.overrides ?? {})) {
    if (KINDS.includes(kind as LetterboxdKind)) overrides[path] = kind as LetterboxdKind
  }

  const plan = planLetterboxd(stored.sources, { origin: stored.origin, overrides })
  plans.set(planId, { ...stored, plan, at: Date.now() })
  return c.json({ planId, origin: stored.origin, plan })
})

/** Confirma a prévia. Uma prévia vale uma importação: depois dela o plano some. */
app.post('/import/letterboxd/apply', async (c) => {
  sweepPlans()
  const body = (await c.req.json().catch(() => null)) as { planId?: string; redo?: boolean } | null

  const planId = body?.planId ?? ''
  const stored = plans.get(planId)
  if (!stored) return c.json({ error: 'A prévia expirou ou já foi usada. Envie o arquivo de novo.' }, 404)

  try {
    await createDatabaseBackup('before-import')
  } catch (error) {
    return c.json({ error: `Importação cancelada porque o backup preventivo falhou: ${(error as Error).message}` }, 503)
  }

  try {
    plans.delete(planId)
    return c.json(await applyLetterboxdPlan(stored.sources, stored.plan, { redo: body?.redo === true }))
  } catch (error) {
    return c.json({ error: (error as Error).message }, 400)
  }
})

/** Aborta: descarta o plano e o conteúdo do upload sem escrever nada. */
app.post('/import/letterboxd/abort', async (c) => {
  const body = (await c.req.json().catch(() => null)) as { planId?: string } | null
  const discarded = body?.planId ? plans.delete(body.planId) : false
  sweepPlans()
  return c.json({ ok: true, discarded })
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
