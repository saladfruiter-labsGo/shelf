/**
 * Cliente do ITAD: normalização a partir de fixtures gravadas e comportamento
 * de rede (timeout, 429 com Retry-After, backoff). Nenhuma chamada real.
 */
import { test, before, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-provider-'))
process.env.ITAD_API_KEY = 'test-key'
process.env.ITAD_COUNTRY = 'BR'

type Itad = typeof import('./providers/isthereanydeal.js')
let itad: Itad

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf-8'))

const realFetch = globalThis.fetch

before(async () => { itad = await import('./providers/isthereanydeal.js') })
afterEach(() => { globalThis.fetch = realFetch })

function stubFetch(handler: (url: string, init?: RequestInit) => Response | Promise<Response>) {
  const calls: string[] = []
  globalThis.fetch = (async (input: any, init?: RequestInit) => {
    const url = String(input)
    calls.push(url)
    return handler(url, init)
  }) as typeof fetch
  return calls
}

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } })

/* ───────────────────────────── Normalização ───────────────────────────── */

test('toMinor prefere amountInt e nunca devolve float', () => {
  assert.equal(itad.toMinor({ amountInt: 4949, amount: 49.49, currency: 'BRL' }), 4949)
  assert.equal(itad.toMinor({ amount: 49.49, currency: 'BRL' }), 4949)
  assert.equal(itad.toMinor({ amount: 0.1 + 0.2, currency: 'BRL' }), 30)
  assert.equal(itad.toMinor(null), null)
  assert.equal(itad.toMinor({}), null)
})

test('normalizePrices converte as ofertas e ordena pela mais barata', () => {
  const [game] = itad.normalizePrices(fixture('prices-v3-br.json'))

  assert.equal(game.provider_game_id, '018d937f-012f-73b8-ab2c-898516969e6a')
  assert.equal(game.history_low_minor, 2474)
  assert.equal(game.history_low_currency, 'BRL')

  // A oferta com URL http:// é descartada — só HTTPS vira botão de compra.
  assert.deepEqual(game.offers.map(o => [o.shop_name, o.price_minor]), [
    ['Nuuvem', 3959],
    ['Steam', 4949],
  ])

  const [nuuvem, steam] = game.offers
  assert.equal(nuuvem.discount_percent, 60)
  assert.equal(nuuvem.voucher, 'BRDEAL')
  assert.equal(nuuvem.currency, 'BRL')
  assert.equal(steam.drm, 'Steam')
  assert.equal(steam.regular_minor, 9899)
  assert.equal(steam.observed_at, '2026-09-01T10:00:00.000Z')
})

test('normalizePrices aceita jogo sem nenhuma oferta', () => {
  const games = itad.normalizePrices(fixture('prices-v3-br.json'))
  const sem = games[1]
  assert.deepEqual(sem.offers, [])
  assert.equal(sem.history_low_minor, null)
})

test('normalizePrices ignora respostas inesperadas', () => {
  assert.deepEqual(itad.normalizePrices(null), [])
  assert.deepEqual(itad.normalizePrices({ erro: true }), [])
  assert.deepEqual(itad.normalizePrices([{ id: 'x', deals: 'nada' }]), [
    { provider_game_id: 'x', history_low_minor: null, history_low_currency: null, offers: [] },
  ])
})

test('normalizeHistory devolve os pontos em centavos', () => {
  const points = itad.normalizeHistory(fixture('history-v2-br.json'))
  assert.equal(points.length, 3)
  assert.deepEqual(points.map(p => p.price_minor), [9899, 2474, 9899])
  assert.equal(points[1].discount_percent, 75)
  assert.equal(points[1].shop_name, 'Steam')
  assert.equal(points[1].currency, 'BRL')
})

test('isValidOfferUrl só aceita HTTPS bem formado', () => {
  assert.equal(itad.isValidOfferUrl('https://loja.example/x'), true)
  assert.equal(itad.isValidOfferUrl('http://loja.example/x'), false)
  assert.equal(itad.isValidOfferUrl('javascript:alert(1)'), false)
  assert.equal(itad.isValidOfferUrl('nao-e-url'), false)
  assert.equal(itad.isValidOfferUrl(null), false)
})

/* ───────────────────────────── Chamadas HTTP ──────────────────────────── */

test('fetchPrices envia os ids no corpo e o país na query', async () => {
  let body: unknown = null
  const calls = stubFetch((_u, init) => {
    body = JSON.parse(String(init?.body))
    return json(fixture('prices-v3-br.json'))
  })

  const out = await itad.fetchPrices(['a', 'b'])
  assert.equal(out.length, 2)
  assert.deepEqual(body, ['a', 'b'])
  assert.match(calls[0], /^https:\/\/api\.isthereanydeal\.com\/games\/prices\/v3\?/)
  assert.match(calls[0], /country=BR/)
})

test('fetchShops normaliza title para name', async () => {
  stubFetch(() => json(fixture('shops-v1-br.json')))
  const shops = await itad.fetchShops()
  assert.deepEqual(shops, [
    { id: 61, name: 'Steam' },
    { id: 35, name: 'Nuuvem' },
    { id: 16, name: 'GOG' },
  ])
})

test('lookupByAppId devolve o jogo encontrado', async () => {
  const calls = stubFetch(() => json(fixture('lookup-v1.json')))
  const game = await itad.lookupByAppId(1091500)
  assert.equal(game?.title, 'Cyberpunk 2077')
  assert.equal(game?.type, 'game')
  assert.match(calls[0], /appid=1091500/)
})

test('lookup sem resultado devolve null', async () => {
  stubFetch(() => json({ found: false }))
  assert.equal(await itad.lookupByTitle('jogo inexistente'), null)
})

test('429 vira erro com Retry-After e não é repetido', async () => {
  const calls = stubFetch(() => json({ error: 'rate limit' }, 429, { 'retry-after': '42' }))

  await assert.rejects(
    () => itad.fetchShops(),
    (e: any) => {
      assert.equal(e.status, 429)
      assert.equal(e.retryAfter, 42)
      assert.equal(e.transient, true)
      return true
    },
  )
  assert.equal(calls.length, 1)   // sem retry: quem chama é que reagenda
})

test('erro 5xx é repetido com backoff e o resultado bom prevalece', async () => {
  let n = 0
  stubFetch(() => (++n === 1 ? json({}, 503) : json(fixture('shops-v1-br.json'))))

  const shops = await itad.fetchShops()
  assert.equal(n, 2)
  assert.equal(shops.length, 3)
})

test('timeout do fetch vira erro transitório', async () => {
  stubFetch(() => { const e = new Error('aborted'); e.name = 'AbortError'; throw e })

  await assert.rejects(
    () => itad.fetchShops(),
    (e: any) => {
      assert.equal(e.transient, true)
      assert.match(e.message, /Tempo esgotado/)
      return true
    },
  )
})

test('erro 4xx não é repetido', async () => {
  const calls = stubFetch(() => json({ error: 'bad request' }, 400))
  await assert.rejects(() => itad.fetchShops())
  assert.equal(calls.length, 1)
})
