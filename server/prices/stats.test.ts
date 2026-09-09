import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSeries, computeStats, dayOf, parseRange, rangeStart, shopStats, type HistoryRow } from './stats.js'

function row(shop: number, name: string, price: number, at: string, regular = price, cut = 0): HistoryRow {
  return { shop_id: shop, shop_name: name, price_minor: price, regular_minor: regular, discount_percent: cut, currency: 'BRL', observed_at: at }
}

test('dayOf usa o dia UTC do instante', () => {
  assert.equal(dayOf('2026-07-04T10:00:00+02:00'), '2026-07-04')
  assert.equal(dayOf('2026-07-04T00:30:00+02:00'), '2026-07-03')
})

test('buildSeries agrupa por dia e mantém o menor preço do dia', () => {
  const points = buildSeries([
    row(61, 'Steam', 9899, '2026-07-01T10:00:00Z'),
    row(61, 'Steam', 4949, '2026-07-01T18:00:00Z'),
  ], '2026-07-01')

  assert.equal(points.length, 1)
  assert.equal(points[0].day, '2026-07-01')
  assert.equal(points[0].price_minor, 4949)
})

test('buildSeries carrega o último preço conhecido entre duas mudanças', () => {
  // O log do provedor só registra mudanças: 03/07 o preço continua sendo o de 02/07.
  const points = buildSeries([
    row(61, 'Steam', 9899, '2026-07-02T10:00:00Z'),
    row(61, 'Steam', 2474, '2026-07-05T10:00:00Z'),
  ], '2026-07-05')

  assert.deepEqual(points.map(p => [p.day, p.price_minor]), [
    ['2026-07-02', 9899],
    ['2026-07-03', 9899],
    ['2026-07-04', 9899],
    ['2026-07-05', 2474],
  ])
})

test('buildSeries usa a loja mais barata de cada dia', () => {
  const points = buildSeries([
    row(61, 'Steam',  9899, '2026-07-01T10:00:00Z'),
    row(35, 'Nuuvem', 7999, '2026-07-01T11:00:00Z'),
    row(35, 'Nuuvem', 12000, '2026-07-02T11:00:00Z'),
  ], '2026-07-02', [35, 61])

  assert.deepEqual(points.map(p => [p.day, p.price_minor, p.shop_name]), [
    ['2026-07-01', 7999, 'Nuuvem'],
    ['2026-07-02', 9899, 'Steam'],
  ])
})

test('loja que saiu das ofertas para de puxar a linha para baixo', () => {
  // A Nuuvem só foi vista em 01/07 e não está mais ofertando: de 02/07 em
  // diante quem vale é a Steam.
  const rows = [
    row(35, 'Nuuvem', 1000, '2026-07-01T10:00:00Z'),
    row(61, 'Steam',  5000, '2026-07-01T10:00:00Z'),
  ]

  assert.deepEqual(buildSeries(rows, '2026-07-03', [61]).map(p => p.price_minor), [1000, 5000, 5000])
  // Sem a lista de lojas ativas, as duas continuam valendo.
  assert.deepEqual(buildSeries(rows, '2026-07-03').map(p => p.price_minor), [1000, 1000, 1000])
})

test('computeStats calcula os quatro indicadores com dados conhecidos', () => {
  const now = new Date('2026-09-09T12:00:00Z')
  const rows = [
    row(61, 'Steam', 2474, '2026-03-01T10:00:00Z'),   // menor histórico, fora das janelas
    row(61, 'Steam', 6900, '2026-08-20T10:00:00Z'),   // dentro dos 30 dias, fora do mês
    row(61, 'Steam', 7900, '2026-09-02T10:00:00Z'),   // dentro do mês
  ]

  const s = computeStats(rows, 8900, now)
  assert.equal(s.local_low_minor,  2474)
  assert.equal(s.last30_low_minor, 6900)
  assert.equal(s.month_low_minor,  7900)
  assert.equal(s.local_since, '2026-03-01T10:00:00Z')
})

test('o preço atual entra nas janelas mesmo sem ponto no histórico', () => {
  const now = new Date('2026-09-09T12:00:00Z')
  const s = computeStats([row(61, 'Steam', 9899, '2026-01-01T10:00:00Z')], 1990, now)
  assert.equal(s.month_low_minor,  1990)
  assert.equal(s.last30_low_minor, 1990)
  assert.equal(s.local_low_minor,  1990)
})

test('sem histórico e sem oferta, os indicadores ficam vazios', () => {
  const s = computeStats([], null, new Date('2026-09-09T12:00:00Z'))
  assert.equal(s.local_low_minor, null)
  assert.equal(s.month_low_minor, null)
  assert.equal(s.last30_low_minor, null)
  assert.equal(s.local_since, null)
  assert.deepEqual(buildSeries([]), [])
})

test('parseRange cai no padrão de 3 meses para valores inválidos', () => {
  assert.equal(parseRange('30d'), '30d')
  assert.equal(parseRange('1y'), '1y')
  assert.equal(parseRange('xpto'), '90d')
  assert.equal(parseRange(undefined), '90d')
  assert.equal(rangeStart('all'), null)
  assert.equal(rangeStart('30d', new Date('2026-09-09T00:00:00Z'))!.toISOString(), '2026-08-10T00:00:00.000Z')
})

test('shopStats resume menor histórico e último preço de cada loja', () => {
  const stats = shopStats([
    row(61, 'Steam',  9899, '2026-06-01T10:00:00Z'),
    row(61, 'Steam',  2474, '2026-07-04T10:00:00Z'),
    row(61, 'Steam',  4949, '2026-08-01T10:00:00Z'),
    row(35, 'Nuuvem', 7999, '2026-06-15T10:00:00Z'),
  ])

  assert.deepEqual(stats.map(s => [s.shop_name, s.low_minor, s.low_at, s.last_minor, s.last_at]), [
    ['Steam',  2474, '2026-07-04T10:00:00Z', 4949, '2026-08-01T10:00:00Z'],
    ['Nuuvem', 7999, '2026-06-15T10:00:00Z', 7999, '2026-06-15T10:00:00Z'],
  ])
})

test('shopStats devolve lista vazia sem histórico', () => {
  assert.deepEqual(shopStats([]), [])
})
