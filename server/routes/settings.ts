import { Hono } from 'hono'
import { cfg, setCfg } from '../integrations/config.js'
import { isAdmin } from '../auth/accounts.js'

const app = new Hono()

const ALLOWED_KEYS = ['TMDB_API_KEY', 'RAWG_API_KEY', 'GOOGLE_BOOKS_KEY'] as const
type AllowedKey = typeof ALLOWED_KEYS[number]
type KeyState = { set: boolean; masked: string }

function mask(value: string): string {
  if (!value) return ''
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}••••${value.slice(-4)}`
}

/**
 * O GET só informa se cada chave está salva e uma máscara curta. A tabela
 * `settings` também guarda outros segredos de integração; nenhum valor
 * completo deve voltar ao navegador.
 */
function getPublicSettings(): Record<AllowedKey, KeyState> {
  const result = {} as Record<AllowedKey, KeyState>
  for (const key of ALLOWED_KEYS) {
    const value = cfg(key)
    result[key] = { set: !!value, masked: mask(value) }
  }
  return result
}

app.get('/', (c) => {
  return c.json({ ...getPublicSettings(), can_edit: canEdit(c.get('user')) })
})

/** Chaves de metadados são da instância: só administradores mexem nelas. */
function canEdit(user: Parameters<typeof isAdmin>[0] | undefined): boolean {
  return !user || isAdmin(user)
}

app.patch('/', async (c) => {
  if (!canEdit(c.get('user'))) return c.json({ error: 'Apenas administradores alteram as chaves de API.' }, 403)
  const body = (await c.req.json()) as Record<string, unknown>

  for (const key of ALLOWED_KEYS) {
    if (body[`${key}_clear`] === true) {
      setCfg(key, '')
      continue
    }
    const val = typeof body[key] === 'string' ? body[key].trim() : ''
    if (val) setCfg(key, val)
  }

  return c.json({ ...getPublicSettings(), can_edit: true })
})

export default app
