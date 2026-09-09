import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'
import type {
  ExportScope, ImportReport, LetterboxdImportReport, LetterboxdKind, SteamSyncResult,
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

function LetterboxdCard({ onDone }: { onDone: () => void }) {
  const [csv, setCsv] = useState('')
  const [filename, setFilename] = useState('')
  const [kind, setKind] = useState<LetterboxdKind>('diary')
  const [report, setReport] = useState<LetterboxdImportReport | null>(null)
  const [error, setError] = useState('')

  const pick = async (file: File | undefined) => {
    setReport(null); setError('')
    if (!file) return
    try {
      const text = await readFile(file)
      setCsv(text)
      setFilename(file.name)
      const detected = await api.transfer.detectLetterboxd(text, file.name)
      setKind(detected.kind)
    } catch (e) {
      setError((e as Error).message)
    }
  }

  const run = useMutation({
    mutationFn: () => api.transfer.importLetterboxd(csv, kind, filename),
    onSuccess: (r) => { setReport(r); onDone() },
    onError: (e: unknown) => setError((e as Error).message),
  })

  return (
    <div className={cardCls}>
      <div className="flex items-center gap-2 mb-1">
        <span style={{ fontSize: 18 }}>🎬</span>
        <h2 className="font-medium text-primary text-sm">Importar do Letterboxd</h2>
      </div>
      <p className="text-xs text-muted mb-4">
        Em <span className="text-secondary">Letterboxd → Settings → Data → Export your data</span> você baixa um .zip.
        Descompacte e envie um CSV por vez. Cada filme é casado com o TMDB, então o card importado é o mesmo que o Plex
        e a busca manual usam. Repetir a importação não duplica nada.
      </p>

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={e => pick(e.target.files?.[0])}
        className="text-xs text-muted mb-3 block w-full file:mr-3 file:px-3 file:py-2 file:rounded-lg file:border file:border-border file:bg-card file:text-primary file:text-xs file:cursor-pointer"
      />

      {csv && (
        <>
          <label className="text-xs text-secondary mb-1 block">Tipo do arquivo</label>
          <select className="w-full bg-card border border-border rounded-lg px-3 py-2.5 text-sm text-primary outline-none focus:border-accent transition-colors"
            value={kind} onChange={e => setKind(e.target.value as LetterboxdKind)}>
            {LETTERBOXD_KINDS.map(k => <option key={k.key} value={k.key}>{k.label} — {k.hint}</option>)}
          </select>
          <p className="text-[11px] text-muted mt-1">
            Detectado pelo cabeçalho de <span className="text-secondary">{filename}</span>. `watched.csv` e `watchlist.csv`
            têm o mesmo cabeçalho — confira antes de importar.
          </p>

          <button type="button" onClick={() => { setReport(null); setError(''); run.mutate() }}
            disabled={run.isPending} className={btnCls + ' mt-4'}>
            {run.isPending ? 'Importando…' : '↧ Importar'}
          </button>
        </>
      )}

      {error && <p className="text-[11px] text-movies mt-2">{error}</p>}
      {report && <ReportBox report={report} />}
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
