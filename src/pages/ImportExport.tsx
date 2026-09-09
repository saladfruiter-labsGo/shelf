import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  ExportScope, ImportReport, LetterboxdKind, LetterboxdPreview, LetterboxdApplyResult, SteamSyncResult,
} from '../types'

const SCOPES: { key: ExportScope; label: string; hint: string }[] = [
  { key: 'all',     label: 'Tudo',        hint: 'Biblioteca + backlog, com diário, temporadas e listas' },
  { key: 'library', label: 'Biblioteca',  hint: 'Só o que você já consumiu' },
  { key: 'backlog', label: 'Backlog',     hint: 'Só o que ainda quer ver, ler ou jogar' },
]

const LETTERBOXD_KINDS: { key: LetterboxdKind; label: string; hint: string }[] = [
  { key: 'diary',     label: 'diary.csv',     hint: 'Cada sessão vira um registro no diário, com data e nota' },
  { key: 'ratings',   label: 'ratings.csv',   hint: 'Filmes assistidos, com a nota que você deu' },
  { key: 'watched',   label: 'watched.csv',   hint: 'Tudo que você já assistiu, sem nota' },
  { key: 'watchlist', label: 'watchlist.csv', hint: 'Vira backlog — não entra na biblioteca' },
]

const cardCls = 'bg-surface border border-border rounded-xl p-5 mb-4'
const btnCls = 'text-xs px-3 py-2 bg-card border border-border rounded-lg text-primary hover:border-accent transition-colors disabled:opacity-50'

const num = new Intl.NumberFormat('pt-BR')

/** Linha de resultado de uma importação — mesma leitura para os três caminhos. */
function ReportBox({ report }: { report: ImportReport & { rows?: number } }) {
  const cells = [
    { label: 'Criados', value: report.created },
    { label: 'Atualizados', value: report.updated },
    { label: 'Sem mudança', value: report.skipped },
    { label: 'No diário', value: report.diary },
  ]
  return (
    <div className="mt-4">
      <div className="grid grid-cols-4 gap-2">
        {cells.map(c => (
          <div key={c.label} className="bg-card rounded-lg p-3">
            <p className="text-[10px] uppercase tracking-wide text-muted">{c.label}</p>
            <p className="font-display text-xl font-bold text-primary">{c.value}</p>
          </div>
        ))}
      </div>
      {report.unresolved.length > 0 && (
        <p className="text-[11px] text-muted mt-2">
          {report.unresolved.length} título(s) não casaram com o TMDB e entraram com os dados do próprio arquivo:{' '}
          <span className="text-secondary">{report.unresolved.slice(0, 5).join(' · ')}</span>
          {report.unresolved.length > 5 && ` e mais ${report.unresolved.length - 5}`}.
        </p>
      )}
      {report.errors.length > 0 && (
        <p className="text-[11px] text-movies mt-2">{report.errors.slice(0, 3).join(' · ')}</p>
      )}
    </div>
  )
}

/** Lê um arquivo escolhido no input como texto (UTF-8). */
function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result ?? ''))
    reader.onerror = () => reject(new Error('Não consegui ler o arquivo.'))
    reader.readAsText(file, 'utf-8')
  })
}

export function ImportExport() {
  const qc = useQueryClient()
  const { data: summary } = useQuery({ queryKey: ['export-summary'], queryFn: api.transfer.summary })

  const [scope, setScope] = useState<ExportScope>('all')

  return (
    <div className="px-6 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-primary mb-1">Importação e exportação</h1>
        <p className="text-muted text-sm">Leve sua prateleira embora, guarde uma cópia ou traga o histórico de outro serviço</p>
      </div>

      {/* ── Exportar ── */}
      <div className={cardCls}>
        <h2 className="font-medium text-primary text-sm mb-1">Exportar</h2>
        <p className="text-xs text-muted mb-4">
          O <b>JSON</b> é um backup completo e re-importável aqui mesmo: itens, diário, temporadas/episódios e listas.
          O <b>CSV</b> é uma linha por item, para abrir em planilha.
        </p>

        <div className="space-y-2 mb-4">
          {SCOPES.map(s => {
            const counts = summary?.[s.key]
            return (
              <label key={s.key} className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${
                scope === s.key ? 'border-accent bg-card' : 'border-border bg-card hover:border-accent'
              }`}>
                <input type="radio" name="scope" className="mt-0.5" checked={scope === s.key} onChange={() => setScope(s.key)} />
                <span className="min-w-0 flex-1">
                  <span className="text-sm text-primary block">{s.label}</span>
                  <span className="text-[11px] text-muted block">{s.hint}</span>
                </span>
                {counts && (
                  <span className="text-[11px] text-muted whitespace-nowrap">
                    {counts.items} {counts.items === 1 ? 'item' : 'itens'}
                    {counts.diary > 0 && ` · ${counts.diary} no diário`}
                  </span>
                )}
              </label>
            )
          })}
        </div>

        <div className="flex gap-2">
          <a href={api.transfer.exportUrl(scope, 'json')} download className={btnCls}>⬇ Baixar JSON</a>
          <a href={api.transfer.exportUrl(scope, 'csv')} download className={btnCls}>⬇ Baixar CSV</a>
        </div>
      </div>

      <LetterboxdCard onDone={() => qc.invalidateQueries()} />
      <SteamImportCard onDone={() => qc.invalidateQueries()} />
      <ShelfBackupCard onDone={() => qc.invalidateQueries()} />
    </div>
  )
}

/* ────────────────────────────────  Letterboxd  ───────────────────────────── */

/** Quantos filmes da lista aparecem antes do "mostrar todos". */
const TITLE_PEEK = 24

/**
 * A prévia do export: o que entra, o que ficou de fora, e os dois botões.
 *
 * Nada disso escreveu no banco ainda — o servidor guardou o plano e só o
 * executa em "Confirmar". "Cancelar" descarta o plano lá também.
 */
function LetterboxdPlanPanel({
  preview, overrides, onOverride, onConfirm, onCancel, busy, redo, onRedo,
}: {
  preview: LetterboxdPreview
  overrides: Record<string, LetterboxdKind>
  onOverride: (path: string, kind: LetterboxdKind) => void
  onConfirm: () => void
  onCancel: () => void
  busy: boolean
  redo: boolean
  onRedo: (v: boolean) => void
}) {
  const [showAll, setShowAll] = useState(false)
  const { plan } = preview
  const t = plan.totals
  const nothing = plan.files.length === 0

  const stats = [
    { label: 'Filmes',     value: t.titles },
    { label: 'Biblioteca', value: t.library },
    { label: 'Backlog',    value: t.backlog },
    { label: 'No diário',  value: t.sessions },
    { label: 'Com nota',   value: t.rated },
  ]

  const shown = showAll ? plan.titles : plan.titles.slice(0, TITLE_PEEK)

  return (
    <div className="mt-4 border-t border-border pt-4">
      <p className="text-xs text-primary mb-1">
        {nothing ? 'Não achei nada para importar' : 'Confira antes de importar'}
        <span className="text-muted"> — {preview.filename}</span>
      </p>
      <p className="text-[11px] text-muted mb-4">
        {nothing
          ? 'Nenhum arquivo enviado é um dos que o Shelf lê. Nada foi alterado.'
          : 'Ainda não escrevi nada. Só o que está aqui embaixo vai entrar na prateleira.'}
      </p>

      {!nothing && (
        <div className="grid grid-cols-5 gap-2 mb-4">
          {stats.map(s => (
            <div key={s.label} className="bg-card rounded-lg p-3">
              <p className="text-[10px] uppercase tracking-wide text-muted">{s.label}</p>
              <p className="font-display text-xl font-bold text-primary">{num.format(s.value)}</p>
            </div>
          ))}
        </div>
      )}

      {plan.files.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] uppercase tracking-wide text-muted mb-2">Arquivos que serão lidos</p>
          <ul className="space-y-2">
            {plan.files.map(f => (
              <li key={f.path} className="bg-card rounded-lg p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-xs text-primary truncate">{f.path}</span>
                  <span className="text-[11px] text-muted whitespace-nowrap">{num.format(f.rows)} linha(s)</span>
                </div>
                <p className="text-[11px] text-muted mt-0.5">{f.does}</p>
                {f.discarded > 0 && (
                  <p className="text-[11px] text-muted mt-0.5">
                    {num.format(f.discarded)} linha(s) sem título, descartadas.
                  </p>
                )}
                {f.ambiguous && (
                  <>
                    <select
                      className="w-full bg-surface border border-border rounded-lg px-3 py-2 text-xs text-primary outline-none focus:border-accent transition-colors mt-2"
                      value={overrides[f.path] ?? f.kind}
                      onChange={e => onOverride(f.path, e.target.value as LetterboxdKind)}
                      disabled={busy}
                    >
                      {LETTERBOXD_KINDS.map(k => <option key={k.key} value={k.key}>{k.label} — {k.hint}</option>)}
                    </select>
                    <p className="text-[11px] text-muted mt-1">
                      Nome fora do padrão do export: o tipo veio do cabeçalho. Como watched e watchlist têm cabeçalho
                      idêntico, confira antes de confirmar.
                    </p>
                  </>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.ignored.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] uppercase tracking-wide text-muted mb-2">
            Não identificado ({plan.ignored.length}) — fica de fora
          </p>
          <ul className="space-y-1 max-h-40 overflow-y-auto pr-1">
            {plan.ignored.map(i => (
              <li key={i.path} className="text-[11px] text-muted flex gap-2">
                <span className="text-secondary truncate max-w-[45%]">{i.path}</span>
                <span className="truncate">{i.reason}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {plan.titles.length > 0 && (
        <div className="mb-4">
          <p className="text-[11px] uppercase tracking-wide text-muted mb-2">
            Filmes que serão migrados ({num.format(plan.titles.length)})
          </p>
          <ul className="text-[11px] text-muted space-y-1 max-h-64 overflow-y-auto pr-1">
            {shown.map(title => (
              <li key={title.slug} className="flex gap-2">
                <span className="text-primary truncate">{title.name}</span>
                {title.year && <span>({title.year})</span>}
                {title.rating != null && <span className="text-accent whitespace-nowrap">★ {title.rating}</span>}
                {title.sessions > 0 && <span className="whitespace-nowrap">{title.sessions}× no diário</span>}
                {title.target === 'backlog' && <span className="whitespace-nowrap">· backlog</span>}
              </li>
            ))}
          </ul>
          {plan.titles.length > TITLE_PEEK && (
            <button type="button" onClick={() => setShowAll(v => !v)} className="text-[11px] text-accent hover:underline mt-2">
              {showAll ? 'Mostrar menos' : `Mostrar todos os ${num.format(plan.titles.length)}`}
            </button>
          )}
        </div>
      )}

      {!nothing && preview.existingDiary > 0 && (
        <label className="flex items-start gap-2 p-3 mb-3 rounded-lg border border-border bg-card cursor-pointer">
          <input type="checkbox" className="mt-0.5" checked={redo} onChange={e => onRedo(e.target.checked)} disabled={busy} />
          <span className="min-w-0">
            <span className="text-xs text-primary block">
              Refazer — o diário já tem {num.format(preview.existingDiary)} registro(s) do Letterboxd
            </span>
            <span className="text-[11px] text-muted block">
              Apaga esses {num.format(preview.existingDiary)} e escreve de novo a partir deste arquivo, e recoloca a data
              de entrada na estante na data do Letterboxd. Registros feitos à mão, pelo Plex ou por qualquer outra
              origem não são tocados. Marque se a importação anterior duplicou filmes no diário.
            </span>
          </span>
        </label>
      )}

      {!nothing && (
        <p className="text-[11px] text-muted mb-3">
          Cada título é casado com o TMDB na hora de importar — é o passo demorado. Os que não casarem entram assim
          mesmo, com os dados do próprio arquivo, e aparecem no relatório. Repetir a importação não duplica nada.
        </p>
      )}

      <div className="flex gap-2">
        {!nothing && (
          <button type="button" onClick={onConfirm} disabled={busy} className={btnCls + ' border-accent text-accent'}>
            {busy ? 'Importando…' : redo ? '✓ Refazer importação' : '✓ Confirmar importação'}
          </button>
        )}
        <button type="button" onClick={onCancel} disabled={busy} className={btnCls}>
          {nothing ? 'Fechar' : '✕ Cancelar'}
        </button>
      </div>
    </div>
  )
}

function LetterboxdCard({ onDone }: { onDone: () => void }) {
  const [preview, setPreview] = useState<LetterboxdPreview | null>(null)
  const [overrides, setOverrides] = useState<Record<string, LetterboxdKind>>({})
  const [result, setResult] = useState<LetterboxdApplyResult | null>(null)
  const [redo, setRedo] = useState(false)
  const [error, setError] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)

  const clear = () => {
    setPreview(null)
    setOverrides({})
    setRedo(false)
    // Sem isso, escolher o mesmo arquivo de novo não dispara `change`.
    if (fileRef.current) fileRef.current.value = ''
  }

  const read = useMutation({
    mutationFn: (file: File) => api.transfer.previewLetterboxd(file),
    onSuccess: (p) => setPreview(p),
    onError: (e: unknown) => setError((e as Error).message),
  })

  const replan = useMutation({
    mutationFn: (next: Record<string, LetterboxdKind>) => api.transfer.replanLetterboxd(preview!.planId!, next),
    onSuccess: (r) => setPreview(p => (p ? { ...p, plan: r.plan } : p)),
    onError: (e: unknown) => setError((e as Error).message),
  })

  const apply = useMutation({
    mutationFn: () => api.transfer.applyLetterboxd(preview!.planId!, redo),
    onSuccess: (r) => { setResult(r); clear(); onDone() },
    onError: (e: unknown) => setError((e as Error).message),
  })

  const abort = useMutation({
    mutationFn: (planId: string) => api.transfer.abortLetterboxd(planId),
    // Abortar não trava a tela: sai daqui mesmo se o servidor reclamar — o
    // plano expira sozinho em meia hora de qualquer jeito.
    onSettled: clear,
  })

  const pick = (file: File | undefined) => {
    setResult(null); setError(''); setPreview(null); setOverrides({}); setRedo(false)
    if (file) read.mutate(file)
  }

  const override = (path: string, kind: LetterboxdKind) => {
    const next = { ...overrides, [path]: kind }
    setOverrides(next)
    setError('')
    replan.mutate(next)
  }

  const cancel = () => {
    setError('')
    if (preview?.planId) abort.mutate(preview.planId)
    else clear()
  }

  return (
    <div className={cardCls}>
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>🎬</span>
        <h2 className="font-medium text-primary text-sm">Importar do Letterboxd</h2>
      </div>
      <p className="text-xs text-muted mb-4">
        Em <span className="text-secondary">Letterboxd → Settings → Data → Export your data</span> você baixa um .zip.
        Mande o .zip inteiro, do jeito que veio: eu leio o que dá, mostro a lista do que vai entrar e do que ficou de
        fora, e só escrevo depois que você confirmar. Um CSV solto também serve.
      </p>

      <input
        ref={fileRef}
        type="file"
        accept=".zip,.csv,application/zip,text/csv"
        onChange={e => pick(e.target.files?.[0])}
        disabled={read.isPending || apply.isPending}
        className="text-xs text-muted mb-3 block w-full file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border file:border-border file:bg-card file:text-primary file:text-xs file:cursor-pointer"
      />

      {read.isPending && <p className="text-[11px] text-muted">Lendo o arquivo…</p>}

      {preview && (
        <LetterboxdPlanPanel
          preview={preview}
          overrides={overrides}
          onOverride={override}
          onConfirm={() => { setError(''); apply.mutate() }}
          onCancel={cancel}
          busy={apply.isPending || replan.isPending}
          redo={redo}
          onRedo={setRedo}
        />
      )}

      {error && <p className="text-[11px] text-movies mt-2">{error}</p>}

      {result && (
        <>
          <ReportBox report={result.total} />
          {result.cleared > 0 && (
            <p className="text-[11px] text-muted mt-2">
              {num.format(result.cleared)} registro(s) do Letterboxd foram apagados do diário antes de reimportar.
            </p>
          )}
          <ul className="text-[11px] text-muted mt-2 space-y-0.5">
            {result.files.map(f => (
              <li key={f.path}>
                <span className="text-secondary">{f.path}</span> — {num.format(f.rows)} linha(s):{' '}
                {f.created} criado(s), {f.updated} atualizado(s), {f.diary} no diário
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  )
}

/* ──────────────────────────────────  Steam  ──────────────────────────────── */

function SteamImportCard({ onDone }: { onDone: () => void }) {
  const { data: status } = useQuery({ queryKey: ['integrations'], queryFn: api.integrations.status })
  const [report, setReport] = useState<SteamSyncResult | null>(null)
  const [error, setError] = useState('')

  const ready = !!status?.steam.steam_id

  const run = useMutation({
    mutationFn: api.transfer.importSteam,
    onSuccess: (r) => { setReport(r); onDone() },
    onError: (e: unknown) => setError((e as Error).message),
  })

  return (
    <div className={cardCls}>
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>🕹️</span>
        <h2 className="font-medium text-primary text-sm">Importar da Steam</h2>
      </div>
      <p className="text-xs text-muted mb-4">
        Traz a <b>wishlist da Steam</b> para o backlog, uma vez. A Steam só alimenta o backlog — o que você já jogou
        continua vindo do Playnite. Jogos já cadastrados pelo Playnite ou à mão só ganham o AppID, sem virar card
        duplicado e sem mudar de status.
      </p>

      {!ready && (
        <p className="text-[11px] text-muted mb-3">
          Configure o <span className="text-secondary">SteamID</span> em Integrações primeiro. Só isso — ler a wishlist
          não precisa de chave, mas o perfil tem que estar público.
        </p>
      )}

      <button type="button" onClick={() => { setReport(null); setError(''); run.mutate() }}
        disabled={run.isPending || !ready} className={btnCls}>
        {run.isPending ? 'Importando…' : '↧ Importar wishlist'}
      </button>

      {error && <p className="text-[11px] text-movies mt-2">{error}</p>}
      {report && (
        <div className="mt-4">
          <div className="bg-card rounded-lg p-3 inline-block min-w-[160px]">
            <p className="text-[10px] uppercase tracking-wide text-muted">Trazidos da wishlist</p>
            <p className="font-display text-xl font-bold text-primary">{report.pulled}</p>
          </div>
          {report.pulled === 0 && report.errors.length === 0 && (
            <p className="text-[11px] text-muted mt-2">Nada novo — o backlog já tem tudo o que está na sua wishlist.</p>
          )}
          {report.errors.length > 0 && (
            <p className="text-[11px] text-movies mt-2">{report.errors.slice(0, 3).join(' · ')}</p>
          )}
        </div>
      )}
      <p className="text-[11px] text-muted mt-3">
        Para manter os dois lados em sincronia continuamente (inclusive enviando do Shelf para a Steam), ligue o
        conector em <Link to="/integrations" className="text-accent hover:underline">Integrações</Link>.
      </p>
    </div>
  )
}

/* ──────────────────────────── Backup do próprio Shelf ────────────────────── */

function ShelfBackupCard({ onDone }: { onDone: () => void }) {
  const [payload, setPayload] = useState<unknown>(null)
  const [filename, setFilename] = useState('')
  const [mode, setMode] = useState<'merge' | 'replace'>('merge')
  const [report, setReport] = useState<ImportReport | null>(null)
  const [error, setError] = useState('')

  const pick = async (file: File | undefined) => {
    setReport(null); setError(''); setPayload(null)
    if (!file) return
    try {
      const parsed = JSON.parse(await readFile(file))
      if (!parsed || !Array.isArray(parsed.items)) throw new Error('Esse JSON não parece um export do Shelf.')
      setPayload(parsed)
      setFilename(file.name)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const run = useMutation({
    mutationFn: () => api.transfer.importShelf(payload, mode),
    onSuccess: (r) => { setReport(r); onDone() },
    onError: (e: unknown) => setError((e as Error).message),
  })

  return (
    <div className={cardCls}>
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>📦</span>
        <h2 className="font-medium text-primary text-sm">Restaurar um backup do Shelf</h2>
      </div>
      <p className="text-xs text-muted mb-4">
        Aceita o JSON exportado acima — de outra instância do Shelf ou de uma cópia antiga.
      </p>

      <input
        type="file"
        accept=".json,application/json"
        onChange={e => pick(e.target.files?.[0])}
        className="text-xs text-muted mb-3 block w-full file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border file:border-border file:bg-card file:text-primary file:text-xs file:cursor-pointer"
      />

      {payload != null && (
        <>
          <label className="text-xs text-secondary mb-1 block">O que fazer com itens que já existem</label>
          <select className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-primary outline-none focus:border-accent transition-colors"
            value={mode} onChange={e => setMode(e.target.value as 'merge' | 'replace')}>
            <option value="merge">Completar — só preenche campos vazios (recomendado)</option>
            <option value="replace">Substituir — o arquivo manda em todos os campos</option>
          </select>
          <p className="text-[11px] text-muted mt-1">
            Nenhum dos dois apaga item que exista só aqui. Arquivo: <span className="text-secondary">{filename}</span>.
          </p>

          <button type="button" onClick={() => { setReport(null); setError(''); run.mutate() }}
            disabled={run.isPending} className={btnCls + ' mt-4'}>
            {run.isPending ? 'Restaurando…' : '↧ Restaurar'}
          </button>
        </>
      )}

      {error && <p className="text-[11px] text-movies mt-2">{error}</p>}
      {report && <ReportBox report={report} />}
    </div>
  )
}
