import { Link } from 'react-router-dom'
import { useTheme } from '../hooks/useTheme'

/**
 * Preferências do app. As chaves de API e os serviços conectados moraram aqui
 * até virarem página própria — o que sobrou é o que muda o Shelf em si.
 */
export function Settings() {
  const { dark, setDark } = useTheme()

  return (
    <div className="px-6 py-8 max-w-2xl">
      <div className="mb-8">
        <h1 className="font-display text-3xl font-bold text-primary mb-1">Configurações</h1>
        <p className="text-muted text-sm">Preferências do Shelf</p>
      </div>

      {/* Aparência */}
      <div className="bg-surface border border-border rounded-xl p-5 mb-4">
        <h2 className="font-medium text-primary text-sm mb-1">Aparência</h2>
        <p className="text-xs text-muted mb-4">O tema fica salvo neste navegador.</p>

        <div className="flex gap-2">
          {[
            { key: 'light', label: '☀ Claro', active: !dark, value: false },
            { key: 'dark',  label: '☾ Escuro', active: dark,  value: true  },
          ].map(opt => (
            <button
              key={opt.key}
              type="button"
              onClick={() => setDark(opt.value)}
              aria-pressed={opt.active}
              className={`text-xs px-4 py-2 rounded-lg border transition-colors ${
                opt.active
                  ? 'border-accent text-accent bg-card'
                  : 'border-border text-muted bg-card hover:border-accent'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Atalhos para as telas que saíram daqui */}
      <div className="grid gap-4 sm:grid-cols-2">
        {[
          {
            to: '/integrations',
            emoji: '🔌',
            title: 'Integrações',
            text: 'Chaves de API e os serviços que abastecem a prateleira sozinhos.',
          },
          {
            to: '/import-export',
            emoji: '📦',
            title: 'Importação e exportação',
            text: 'Backup da biblioteca e do backlog, e importação do Letterboxd e da Steam.',
          },
        ].map(card => (
          <Link
            key={card.to}
            to={card.to}
            className="bg-surface border border-border rounded-xl p-5 hover:border-accent transition-colors block"
          >
            <span style={{ fontSize: 20 }}>{card.emoji}</span>
            <h2 className="font-medium text-primary text-sm mt-2 mb-1">{card.title}</h2>
            <p className="text-xs text-muted">{card.text}</p>
          </Link>
        ))}
      </div>

      <div className="mt-8 bg-card border border-border rounded-xl p-4 text-xs text-muted space-y-1">
        <p className="font-medium text-secondary">Seus dados</p>
        <p>Tudo fica num SQLite dentro do servidor do Shelf — biblioteca, backlog, diário, listas e as chaves das integrações. Nada é enviado para fora, exceto as consultas às APIs que você mesmo configurou.</p>
        <p>Para levar os dados embora (ou guardar uma cópia), use <Link to="/import-export" className="text-accent hover:underline">Importação/Exportação</Link>.</p>
      </div>
    </div>
  )
}
