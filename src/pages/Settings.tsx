import { useState, useEffect } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

interface ApiEntry {
  key: string
  label: string
  description: string
  docsUrl: string
  placeholder: string
}

const API_ENTRIES: ApiEntry[] = [
  {
    key: 'TMDB_API_KEY',
    label: 'TMDB API Key',
    description: 'Usada para buscar filmes e séries. Gratuita após criar uma conta.',
    docsUrl: 'https://www.themoviedb.org/settings/api',
    placeholder: 'eyJhbGciOiJIUzI1NiJ9...',
  },
  {
    key: 'RAWG_API_KEY',
    label: 'RAWG API Key',
    description: 'Usada para buscar jogos. Gratuita, sem necessidade de OAuth.',
    docsUrl: 'https://rawg.io/apidocs',
    placeholder: 'abc123def456...',
  },
  {
    key: 'GOOGLE_BOOKS_KEY',
    label: 'Google Books API Key',
    description: 'Usada para buscar livros. Opcional — funciona sem chave com limite menor.',
    docsUrl: 'https://developers.google.com/books/docs/v1/using#APIKey',
    placeholder: 'AIzaSyB...',
  },
]

function maskKey(val: string): string {
  if (!val || val.length <= 8) return val
  return val.slice(0, 4) + '•'.repeat(Math.min(val.length - 8, 20)) + val.slice(-4)
}

export function Settings() {
  const qc = useQueryClient()

  const { data: saved = {} } = useQuery({
    queryKey: ['settings'],
    queryFn: api.settings.get,
  })

  const [form, setForm] = useState<Record<string, string>>({})
  const [visible, setVisible] = useState<Record<string, boolean>>({})
  const [toast, setToast] = useState<{ msg: string; ok: boolean } | null>(null)

  useEffect(() => {
    setForm(saved)
  }, [saved])

  const mutation = useMutation({
    mutationFn: api.settings.update,
    onSuccess: (data) => {
      qc.setQueryData(['settings'], data)
      setForm(data)
      setToast({ msg: 'Configurações salvas!', ok: true })
      setTimeout(() => setToast(null), 3000)
    },
    onError: () => {
      setToast({ msg: 'Erro ao salvar. Tente novamente.', ok: false })
      setTimeout(() => setToast(null), 3000)
    },
  })

  const handleSave = () => {
    const toSave: Record<string, string> = {}
    for (const entry of API_ENTRIES) {
      toSave[entry.key] = form[entry.key] ?? ''
    }
    mutation.mutate(toSave)
  }

  return (
    <div className="px-6 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-primary mb-1">Configurações</h1>
        <p className="text-muted text-sm">Gerencie as chaves de API para busca de mídias</p>
      </div>

      <div className="space-y-4">
        {API_ENTRIES.map((entry) => {
          const currentVal = form[entry.key] ?? ''
          const savedVal   = saved[entry.key] ?? ''
          const isConfigured = !!savedVal
          const show = visible[entry.key] ?? false

          return (
            <div key={entry.key} className="bg-surface border border-border rounded-xl p-5">
              {/* Header */}
              <div className="flex items-start justify-between mb-1">
                <div className="flex items-center gap-2">
                  <h2 className="font-medium text-primary text-sm">{entry.label}</h2>
                  <span
                    className={`text-[10px] px-1.5 py-0.5 rounded font-medium ${
                      isConfigured
                        ? 'bg-games-bg text-games'
                        : 'bg-card text-muted'
                    }`}
                  >
                    {isConfigured ? 'Configurada' : 'Não configurada'}
                  </span>
                </div>
                <a
                  href={entry.docsUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-accent hover:underline"
                >
                  Obter chave →
                </a>
              </div>

              <p className="text-xs text-muted mb-3">{entry.description}</p>

              {/* Input */}
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={currentVal}
                  onChange={(e) => setForm((f) => ({ ...f, [entry.key]: e.target.value }))}
                  placeholder={isConfigured ? maskKey(savedVal) : entry.placeholder}
                  className="w-full bg-card border border-border rounded-lg px-3 py-2.5 pr-10 text-sm text-primary placeholder:text-muted outline-none focus:border-accent transition-colors font-mono"
                  autoComplete="off"
                  spellCheck={false}
                />
                <button
                  type="button"
                  onClick={() => setVisible((v) => ({ ...v, [entry.key]: !v[entry.key] }))}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted hover:text-primary transition-colors"
                  tabIndex={-1}
                >
                  {show ? (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" />
                    </svg>
                  ) : (
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
                    </svg>
                  )}
                </button>
              </div>

              {/* Clear button */}
              {isConfigured && (
                <button
                  type="button"
                  onClick={() => setForm((f) => ({ ...f, [entry.key]: '' }))}
                  className="mt-1.5 text-xs text-muted hover:text-red-400 transition-colors"
                >
                  Remover chave
                </button>
              )}
            </div>
          )
        })}
      </div>

      {/* Save */}
      <div className="mt-6 flex items-center gap-4">
        <button
          onClick={handleSave}
          disabled={mutation.isPending}
          className="flex items-center gap-2 px-5 py-2.5 bg-accent text-bg rounded-lg font-medium text-sm hover:opacity-90 transition-opacity disabled:opacity-60"
        >
          {mutation.isPending ? (
            <div className="w-4 h-4 border-2 border-bg border-t-transparent rounded-full animate-spin" />
          ) : (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
            </svg>
          )}
          Salvar configurações
        </button>

        {toast && (
          <span className={`text-sm animate-fade-in ${toast.ok ? 'text-games' : 'text-movies'}`}>
            {toast.ok ? '✓' : '✕'} {toast.msg}
          </span>
        )}
      </div>

      {/* Info box */}
      <div className="mt-8 bg-card border border-border rounded-xl p-4 text-xs text-muted space-y-1">
        <p className="font-medium text-secondary">Sobre as chaves de API</p>
        <p>As chaves são armazenadas no banco de dados local da aplicação. Elas nunca saem do seu servidor.</p>
        <p>Você também pode configurá-las via variáveis de ambiente no arquivo <code className="bg-surface px-1 py-0.5 rounded font-mono">.env</code>. As chaves salvas aqui têm prioridade.</p>
      </div>
    </div>
  )
}
