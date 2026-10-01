/**
 * "Entrar com a Steam" (OpenID 2.0).
 *
 * O login acontece no navegador do usuário: o Shelf redireciona para a Steam,
 * a Steam devolve o navegador para `return_to` com uma asserção assinada, e o
 * servidor confirma a assinatura perguntando à própria Steam
 * (`check_authentication`). Só o navegador precisa alcançar o Shelf — funciona
 * na LAN/Tailscale sem expor nada.
 *
 * O resultado é apenas o SteamID64. A Steam não entrega API key por aqui.
 */

export const STEAM_OPENID_ENDPOINT = 'https://steamcommunity.com/openid/login'
const OPENID_NS = 'http://specs.openid.net/auth/2.0'
const IDENTIFIER_SELECT = 'http://specs.openid.net/auth/2.0/identifier_select'
const CLAIMED_ID = /^https:\/\/steamcommunity\.com\/openid\/id\/(\d{17})$/

/** URL para onde o navegador vai ao clicar em "Entrar com a Steam". */
export function buildSteamLoginUrl(returnTo: string, realm: string): string {
  const qs = new URLSearchParams({
    'openid.ns': OPENID_NS,
    'openid.mode': 'checkid_setup',
    'openid.return_to': returnTo,
    'openid.realm': realm,
    'openid.identity': IDENTIFIER_SELECT,
    'openid.claimed_id': IDENTIFIER_SELECT,
  })
  return `${STEAM_OPENID_ENDPOINT}?${qs}`
}

export function steamIdFromClaimedId(claimedId: string | undefined): string | null {
  return claimedId?.match(CLAIMED_ID)?.[1] ?? null
}

export type AssertionCheck =
  | { ok: true; steamId: string }
  | { ok: false; reason: string }

/**
 * Validações locais da resposta, antes de perguntar à Steam: modo, endpoint,
 * `return_to` igual ao que o Shelf gerou e identidade no formato da Steam.
 */
export function checkAssertionShape(params: Record<string, string>, expectedReturnTo: string): AssertionCheck {
  if (params['openid.mode'] === 'cancel') return { ok: false, reason: 'Login cancelado na Steam.' }
  if (params['openid.mode'] !== 'id_res') return { ok: false, reason: 'Resposta da Steam incompleta.' }
  if (params['openid.op_endpoint'] !== STEAM_OPENID_ENDPOINT) return { ok: false, reason: 'Resposta não veio da Steam.' }
  if (params['openid.return_to'] !== expectedReturnTo) return { ok: false, reason: 'Endereço de retorno não confere.' }

  const steamId = steamIdFromClaimedId(params['openid.claimed_id'])
  if (!steamId || params['openid.identity'] !== params['openid.claimed_id']) {
    return { ok: false, reason: 'Identidade da Steam em formato inesperado.' }
  }

  const signed = (params['openid.signed'] ?? '').split(',')
  for (const field of ['op_endpoint', 'claimed_id', 'identity', 'return_to', 'response_nonce', 'assoc_handle']) {
    if (!signed.includes(field)) return { ok: false, reason: 'Assinatura da Steam não cobre os campos esperados.' }
  }
  return { ok: true, steamId }
}

/** Confirma com a Steam que a asserção é autêntica. */
export async function verifyWithSteam(
  params: Record<string, string>,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const body = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (key.startsWith('openid.')) body.set(key, value)
  }
  body.set('openid.mode', 'check_authentication')

  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 15_000)
  try {
    const res = await fetchImpl(STEAM_OPENID_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
      signal: ctrl.signal,
    })
    if (!res.ok) return false
    return /(^|\n)is_valid:true(\n|$)/.test(await res.text())
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
