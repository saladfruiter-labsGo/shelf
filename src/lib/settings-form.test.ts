import { test } from 'node:test'
import assert from 'node:assert/strict'
import type { IntegrationStatus } from '../types'
import { dirtyKeys, formFromStatus, mergeServerState, steamAutoReadState, withoutSecrets } from './settings-form.js'

function status(steam: Partial<IntegrationStatus['steam']> = {}): IntegrationStatus {
  return {
    plex: { enabled: false, url: '', token_set: false, token_masked: '', user: '', webhook_secret: 's' },
    lastfm: { enabled: false, api_key_set: false, api_key_masked: '', user: '' },
    telegram: { enabled: false, bot_token_set: false, bot_token_masked: '', chat_id: '', thread_id: '' },
    kavita: { enabled: false, url: '', api_key_set: false, api_key_masked: '', library_id: '' },
    playnite: { enabled: false, webhook_secret: 's', rating_policy: 'shelf' },
    steam: {
      enabled: false, steam_id: '', api_key_set: false, api_key_masked: '', cookie_set: false,
      login_secure_set: false, session_id_set: false, session_id_masked: '', sync_mode: 'both', sync_removals: false,
      running: false, last_sync: null, library_enabled: false, library_last_sync: null, achievements_last_sync: null,
      auto_abandon_days: 150, ...steam,
    },
    instance: { can_edit: true },
    igdb: { configured: false, client_id: '', secret_set: false, secret_masked: '', last_sync: null },
    prices: { enabled: false, api_key_set: false, api_key_masked: '', country: 'BR', tracked: 0, last_sync: null, running: false },
  }
}

test('formFromStatus espelha o que o servidor guardou', () => {
  const form = formFromStatus(status({ steam_id: '7656', library_enabled: true, auto_abandon_days: 90 }))
  assert.equal(form.steam_id, '7656')
  assert.equal(form.steam_library_enabled, true)
  assert.equal(form.steam_auto_abandon_days, '90') // o input é texto
  assert.equal(form.steam_api_key, '') // segredo nunca volta em claro
})

test('caixa marcada e ainda não salva sobrevive à releitura do status', () => {
  // O bug: marcar a caixa, clicar em "Ler biblioteca agora" (que não salva nada) e ela desmarcava sozinha,
  // então STEAM_LIBRARY_ENABLED nunca chegava ao servidor e a leitura automática nunca rodava.
  const synced = formFromStatus(status())
  const edited = { ...synced, steam_library_enabled: true }
  assert.deepEqual(dirtyKeys(edited, synced), ['steam_library_enabled'])

  const reread = formFromStatus(status()) // o servidor continua com a flag desligada
  const merged = mergeServerState(edited, synced, reread)
  assert.equal(merged.steam_library_enabled, true)
  assert.deepEqual(dirtyKeys(merged, reread), ['steam_library_enabled']) // e continua pendente, não "salvo"
})

test('campo que o usuário não mexeu acompanha o servidor', () => {
  const synced = formFromStatus(status())
  const edited = { ...synced, steam_library_enabled: true }
  // Entre uma leitura e outra o servidor mudou o SteamID (volta do "Entrar com a Steam").
  const reread = formFromStatus(status({ steam_id: '76561198000000001' }))
  const merged = mergeServerState(edited, synced, reread)
  assert.equal(merged.steam_id, '76561198000000001')
  assert.equal(merged.steam_library_enabled, true)
})

test('o que o usuário alterou prevalece mesmo se o servidor mudou o mesmo campo', () => {
  const synced = formFromStatus(status({ sync_mode: 'both' }))
  const edited = { ...synced, steam_sync_mode: 'pull' }
  const reread = formFromStatus(status({ sync_mode: 'push' }))
  assert.equal(mergeServerState(edited, synced, reread).steam_sync_mode, 'pull')
})

test('primeira leitura: formulário vazio adota o servidor por inteiro', () => {
  const next = formFromStatus(status({ library_enabled: true, steam_id: '1' }))
  assert.deepEqual(mergeServerState({}, {}, next), next)
})

test('sem edição pendente, a releitura é igual a adotar o servidor', () => {
  const synced = formFromStatus(status())
  const next = formFromStatus(status({ library_enabled: true }))
  assert.deepEqual(mergeServerState(synced, synced, next), next)
  assert.deepEqual(dirtyKeys(synced, synced), [])
})

test('depois de salvar nada fica pendente e os segredos saem da tela', () => {
  const typed = {
    ...formFromStatus(status()),
    steam_library_enabled: true,
    steam_api_key: 'chave-digitada',
    telegram_bot_token: 'token-digitado',
    igdb_client_secret: 'segredo-digitado',
    steam_cookies_clear: true,
  }
  const synced = withoutSecrets(typed)
  const form = withoutSecrets(typed)
  assert.deepEqual(dirtyKeys(form, synced), [])
  for (const key of ['steam_api_key', 'telegram_bot_token', 'igdb_client_secret']) assert.equal(form[key], '', key)
  assert.equal(form.steam_cookies_clear, false)
  assert.equal(form.steam_library_enabled, true) // o que não é segredo fica

  // O servidor normaliza ao gravar (aqui, o país em caixa alta): a tela adota o valor dele.
  const afterSave = formFromStatus(status({ library_enabled: true }))
  assert.equal(mergeServerState({ ...form, itad_country: 'br' }, { ...synced, itad_country: 'br' }, afterSave).itad_country, 'BR')
})

test('o que foi digitado depois de clicar em Salvar continua pendente', () => {
  const sent = formFromStatus(status({ library_enabled: true }))
  const form = { ...sent, steam_auto_abandon_days: '30' } // digitado enquanto o PATCH estava no ar
  assert.deepEqual(dirtyKeys(withoutSecrets(form), withoutSecrets(sent)), ['steam_auto_abandon_days'])
})

test('steamAutoReadState diz a verdade sobre a leitura automática', () => {
  const off = steamAutoReadState({ library_enabled: false, steam_id: '1', api_key_set: true })
  assert.equal(off.on, false)
  assert.match(off.label, /desligada/)
  assert.match(off.label, /salve/)

  const incomplete = steamAutoReadState({ library_enabled: true, steam_id: '', api_key_set: true })
  assert.equal(incomplete.on, false)
  assert.match(incomplete.label, /SteamID e a Web API Key/)
  assert.equal(steamAutoReadState({ library_enabled: true, steam_id: '1', api_key_set: false }).on, false)

  const on = steamAutoReadState({ library_enabled: true, steam_id: '1', api_key_set: true })
  assert.equal(on.on, true)
  assert.match(on.label, /30 min/)
})
