import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-steam-auth-'))

const STEAM_ID = '76561198000000001'
let database: Database.Database
let cfg: (key: string) => string
let steamValid = true
let verifyCalls = 0

const fakeSteam = (async () => {
  verifyCalls++
  return new Response(`ns:http://specs.openid.net/auth/2.0\nis_valid:${steamValid}\n`)
}) as unknown as typeof fetch

let app: { request: (path: string, init?: RequestInit) => Promise<Response> }

before(async () => {
  database = (await import('../db.js')).db
  cfg = (await import('../integrations/config.js')).cfg
  const { createSteamAuthRoutes } = await import('./steam-auth.js')
  app = createSteamAuthRoutes(fakeSteam) as any
})

after(() => database.close())

async function startLogin(): Promise<{ returnTo: string; state: string }> {
  const res = await app.request('http://thevault:8080/login')
  assert.equal(res.status, 302)
  const steamUrl = new URL(res.headers.get('location')!)
  assert.equal(steamUrl.origin + steamUrl.pathname, 'https://steamcommunity.com/openid/login')
  assert.equal(steamUrl.searchParams.get('openid.realm'), 'http://thevault:8080')
  const returnTo = steamUrl.searchParams.get('openid.return_to')!
  return { returnTo, state: new URL(returnTo).searchParams.get('state')! }
}

/** O que a Steam devolve ao navegador depois do login. */
function steamAssertion(returnTo: string, overrides: Record<string, string> = {}): string {
  const claimed = `https://steamcommunity.com/openid/id/${STEAM_ID}`
  const params = new URLSearchParams(new URL(returnTo).search)
  const openid: Record<string, string> = {
    'openid.ns': 'http://specs.openid.net/auth/2.0',
    'openid.mode': 'id_res',
    'openid.op_endpoint': 'https://steamcommunity.com/openid/login',
    'openid.claimed_id': claimed,
    'openid.identity': claimed,
    'openid.return_to': returnTo,
    'openid.response_nonce': '2026-10-01T12:00:00Zabc',
    'openid.assoc_handle': '1234567890',
    'openid.signed': 'signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle',
    'openid.sig': 'c2lnbmF0dXJl',
    ...overrides,
  }
  for (const [key, value] of Object.entries(openid)) params.set(key, value)
  return `http://thevault:8080/callback?${params}`
}

test('login confirmado pela Steam grava o SteamID e volta para Integrações', async () => {
  steamValid = true
  const { returnTo } = await startLogin()
  const res = await app.request(steamAssertion(returnTo))
  assert.equal(res.status, 302)
  assert.equal(res.headers.get('location'), '/integrations?steam=conectado')
  assert.equal(cfg('STEAM_ID'), STEAM_ID)
})

test('o state é de uso único: repetir a mesma volta não vale', async () => {
  steamValid = true
  const { returnTo } = await startLogin()
  await app.request(steamAssertion(returnTo))
  const replay = await app.request(steamAssertion(returnTo))
  assert.match(replay.headers.get('location')!, /steam=erro/)
})

test('assinatura recusada pela Steam não troca a conta', async () => {
  database.prepare("DELETE FROM settings WHERE key = 'STEAM_ID'").run()
  steamValid = false
  const { returnTo } = await startLogin()
  const res = await app.request(steamAssertion(returnTo))
  assert.match(res.headers.get('location')!, /steam=erro/)
  assert.equal(cfg('STEAM_ID'), '')
})

test('resposta adulterada é barrada antes de perguntar à Steam', async () => {
  steamValid = true
  verifyCalls = 0
  const { returnTo } = await startLogin()
  const forged = await app.request(steamAssertion(returnTo, { 'openid.op_endpoint': 'https://evil.example/openid' }))
  assert.match(forged.headers.get('location')!, /steam=erro/)

  const second = await startLogin()
  const wrongReturn = await app.request(steamAssertion(second.returnTo, { 'openid.return_to': 'http://evil.example/callback' }))
  assert.match(wrongReturn.headers.get('location')!, /steam=erro/)
  assert.equal(verifyCalls, 0)
  assert.equal(cfg('STEAM_ID'), '')
})

test('cancelar na Steam volta com aviso, sem gravar nada', async () => {
  const { returnTo } = await startLogin()
  const res = await app.request(steamAssertion(returnTo, { 'openid.mode': 'cancel' }))
  const location = new URL(res.headers.get('location')!, 'http://thevault:8080')
  assert.equal(location.searchParams.get('steam'), 'erro')
  assert.equal(location.searchParams.get('motivo'), 'Login cancelado na Steam.')
})
