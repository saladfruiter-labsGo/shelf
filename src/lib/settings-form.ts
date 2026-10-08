/**
 * Formulário de Integrações: o que está na tela, o que o servidor tinha na última
 * leitura e, pela diferença, o que o usuário já alterou e ainda não salvou.
 *
 * O servidor é a fonte de verdade, mas a tela guarda edição pendente. Quando o
 * status é lido de novo (depois de "Ler biblioteca agora", ao voltar para a aba),
 * só os campos que o usuário NÃO mexeu acompanham o servidor. Sem isso uma caixa
 * marcada e ainda não salva "desmarca sozinha" e a leitura automática nunca liga.
 */
import type { IntegrationStatus } from '../types'

export type FormValue = string | boolean
export type FormState = Record<string, FormValue>

/** Campos que guardam um segredo digitado: depois de salvos, a tela volta a mostrar só a máscara. */
const SECRET_KEYS = [
  'plex_token', 'lastfm_api_key', 'telegram_bot_token', 'kavita_api_key', 'itad_api_key',
  'steam_api_key', 'steam_login_secure', 'steam_session_id', 'igdb_client_secret',
] as const

/** O formulário como o servidor o descreve. */
export function formFromStatus(status: IntegrationStatus): FormState {
  return {
    plex_enabled: status.plex.enabled,
    plex_url: status.plex.url,
    plex_user: status.plex.user,
    plex_token: '',
    lastfm_enabled: status.lastfm.enabled,
    lastfm_api_key: '',
    lastfm_user: status.lastfm.user,
    telegram_enabled: status.telegram.enabled,
    telegram_bot_token: '',
    telegram_chat_id: status.telegram.chat_id,
    telegram_thread_id: status.telegram.thread_id,
    kavita_enabled: status.kavita.enabled,
    kavita_url: status.kavita.url,
    kavita_api_key: '',
    kavita_library_id: status.kavita.library_id,
    playnite_enabled: status.playnite.enabled,
    playnite_rating_policy: status.playnite.rating_policy,
    steam_enabled: status.steam.enabled,
    steam_id: status.steam.steam_id,
    steam_api_key: '',
    steam_login_secure: '',
    steam_session_id: '',
    steam_cookies_clear: false,
    steam_sync_mode: status.steam.sync_mode,
    steam_sync_removals: status.steam.sync_removals,
    steam_library_enabled: status.steam.library_enabled,
    steam_auto_abandon_days: String(status.steam.auto_abandon_days),
    igdb_client_id: status.igdb.client_id,
    igdb_client_secret: '',
    itad_enabled: status.prices.enabled,
    itad_api_key: '',
    itad_country: status.prices.country,
  }
}

/** Campos da tela que diferem do que o servidor tinha: o que ainda não foi salvo. */
export function dirtyKeys(form: FormState, synced: FormState): string[] {
  return Object.keys(form).filter(key => form[key] !== synced[key])
}

/**
 * Aplica o que o servidor acabou de devolver sem apagar o que o usuário está
 * editando: campo alterado desde a leitura anterior fica como está, os demais
 * acompanham o servidor.
 */
export function mergeServerState(form: FormState, synced: FormState, next: FormState): FormState {
  const merged: FormState = { ...next }
  for (const key of dirtyKeys(form, synced)) merged[key] = form[key]
  return merged
}

/** Segredos já enviados saem da tela; o resto fica como está. */
export function withoutSecrets(form: FormState): FormState {
  const cleaned: FormState = { ...form, steam_cookies_clear: false }
  for (const key of SECRET_KEYS) if (key in cleaned) cleaned[key] = ''
  return cleaned
}

export interface AutoReadState {
  on: boolean
  label: string
}

/**
 * A leitura de 30 min da biblioteca só roda com a caixa marcada E salva, com o
 * SteamID e a Web API Key. "Ler biblioteca agora" não olha a caixa, então um
 * botão que funciona não prova que o automático está ligado.
 */
export function steamAutoReadState(steam: Pick<IntegrationStatus['steam'], 'library_enabled' | 'steam_id' | 'api_key_set'>): AutoReadState {
  if (!steam.library_enabled) {
    return {
      on: false,
      label: 'Leitura automática desligada: marque "Biblioteca e tempo de jogo pela Steam" e salve. "Ler biblioteca agora" funciona mesmo assim.',
    }
  }
  if (!steam.steam_id || !steam.api_key_set) {
    return { on: false, label: 'Leitura automática marcada, mas faltam o SteamID e a Web API Key salvos.' }
  }
  return { on: true, label: 'Leitura automática ligada: a Steam é lida a cada 30 min.' }
}
