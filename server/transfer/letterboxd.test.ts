/** Leitura dos CSVs do Letterboxd: parsing, detecção do tipo e campos. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv, parseLetterboxd, detectKind, letterboxdSlug, planLetterboxd } from './letterboxd.js'

test('parseCsv respeita aspas, vírgulas e aspas escapadas', () => {
  const rows = parseCsv('a,b\n"x, y","ele disse ""oi"""\n')
  assert.deepEqual(rows, [['a', 'b'], ['x, y', 'ele disse "oi"']])
})

test('parseCsv aceita CRLF e ignora o BOM', () => {
  const rows = parseCsv('﻿Name,Year\r\nDune,2021\r\n')
  assert.deepEqual(rows, [['Name', 'Year'], ['Dune', '2021']])
})

test('detectKind separa diário, notas e watchlist', () => {
  assert.equal(detectKind(['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating', 'Rewatch', 'Tags', 'Watched Date']), 'diary')
  assert.equal(detectKind(['Date', 'Name', 'Year', 'Letterboxd URI', 'Rating']), 'ratings')
  assert.equal(detectKind(['Date', 'Name', 'Year', 'Letterboxd URI'], 'watchlist.csv'), 'watchlist')
  assert.equal(detectKind(['Date', 'Name', 'Year', 'Letterboxd URI'], 'watched.csv'), 'watched')
})

test('diário usa Watched Date como data da sessão', () => {
  const csv = [
    'Date,Name,Year,Letterboxd URI,Rating,Rewatch,Tags,Watched Date',
    '2026-03-02,Dune,2021,https://letterboxd.com/film/dune-2021/,4.5,Yes,,2026-03-01',
  ].join('\n')

  const file = parseLetterboxd(csv, 'diary.csv')
  assert.equal(file.kind, 'diary')
  assert.equal(file.rows.length, 1)
  assert.deepEqual(file.rows[0], {
    name: 'Dune',
    year: 2021,
    rating: 4.5,
    watchedAt: '2026-03-01',
    uri: 'https://letterboxd.com/film/dune-2021/',
    rewatch: true,
    review: null,
  })
})

test('sem Watched Date, a data da sessão é a coluna Date', () => {
  const csv = 'Date,Name,Year,Letterboxd URI,Rating\n2026-01-05,Arrival,2016,,3\n'
  const [row] = parseLetterboxd(csv, 'ratings.csv').rows
  assert.equal(row.watchedAt, '2026-01-05')
  assert.equal(row.rating, 3)
})

test('linhas sem nome são descartadas e nota vazia vira null', () => {
  const csv = 'Date,Name,Year,Letterboxd URI,Rating\n2026-01-05,,2016,,3\n2026-01-06,Sicario,2015,,\n'
  const rows = parseLetterboxd(csv, 'watched.csv').rows
  assert.equal(rows.length, 1)
  assert.equal(rows[0].name, 'Sicario')
  assert.equal(rows[0].rating, null)
})

test('slug sai da URI quando existe, senão do título', () => {
  assert.equal(letterboxdSlug('https://letterboxd.com/film/dune-2021/', 'Dune'), 'dune-2021')
  assert.equal(letterboxdSlug(null, 'Cidade de Deus'), 'cidade-de-deus')
})

/* ─────────────────────────── Plano do export inteiro ─────────────────────── */

const HEAD = 'Date,Name,Year,Letterboxd URI'
const uri = (slug: string) => `https://letterboxd.com/film/${slug}/`

/** Um export como o Letterboxd entrega: cinco arquivos úteis e o resto. */
const EXPORT = [
  { path: 'profile.csv',   text: 'Username,Given Name\nfulano,Fulano\n' },
  { path: 'watchlist.csv', text: `${HEAD}\n2026-01-01,Sicario,2015,${uri('sicario')}\n` },
  { path: 'diary.csv',     text: `${HEAD},Rating,Rewatch,Tags,Watched Date\n2026-03-02,Dune,2021,${uri('dune-2021')},4.5,No,,2026-03-01\n2026-03-05,Dune,2021,${uri('dune-2021')},4.5,Yes,,2026-03-04\n` },
  { path: 'watched.csv',   text: `${HEAD}\n2026-03-02,Dune,2021,${uri('dune-2021')}\n2026-02-01,Arrival,2016,${uri('arrival')}\n` },
  { path: 'ratings.csv',   text: `${HEAD},Rating\n2026-03-02,Dune,2021,${uri('dune-2021')},4.5\n` },
  { path: 'reviews.csv',   text: `${HEAD},Rating,Rewatch,Review,Tags,Watched Date\n2026-03-02,Arrival,2016,${uri('arrival')},5,No,Chorei,,2026-02-01\n` },
  { path: 'comments.csv',  text: 'Date,Comment\n2026-01-01,oi\n' },
  { path: 'likes/films.csv', text: `${HEAD}\n2026-01-01,Dune,2021,${uri('dune-2021')}\n` },
  { path: 'lists/watched.csv', text: `${HEAD}\n2026-01-01,Alien,1979,${uri('alien')}\n` },
]

test('o plano lê os cinco arquivos do export, na ordem em que serão aplicados', () => {
  const plan = planLetterboxd(EXPORT)
  assert.deepEqual(plan.files.map(f => f.path),
    ['watched.csv', 'ratings.csv', 'reviews.csv', 'diary.csv', 'watchlist.csv'])
  assert.deepEqual(plan.files.map(f => f.kind),
    ['watched', 'ratings', 'diary', 'diary', 'watchlist'])
  assert.equal(plan.files.every(f => !f.ambiguous), true)
})

test('o que o Shelf não usa vai para a lista do que ficou de fora, com motivo', () => {
  const plan = planLetterboxd(EXPORT)
  const ignored = Object.fromEntries(plan.ignored.map(i => [i.path, i.reason]))
  assert.deepEqual(Object.keys(ignored).sort(),
    ['comments.csv', 'likes/films.csv', 'lists/watched.csv', 'profile.csv'])
  // Uma lista chamada "watched" não é o histórico: casar por nome de arquivo
  // solto importaria a lista errada.
  assert.match(ignored['lists/watched.csv'], /Listas/)
  assert.match(ignored['likes/films.csv'], /Curtidas/)
})

test('cada filme aparece uma vez, com a nota e as sessões somadas', () => {
  const { titles, totals } = planLetterboxd(EXPORT)
  assert.deepEqual(titles.map(t => t.name), ['Arrival', 'Dune', 'Sicario'])

  const dune = titles.find(t => t.slug === 'dune-2021')!
  assert.equal(dune.year, 2021)
  assert.equal(dune.rating, 4.5)
  // Só as duas noites do diary.csv: a coluna `Date` de watched.csv/ratings.csv
  // é o dia do registro, não o da sessão, e não vira diário.
  assert.equal(dune.sessions, 2)
  assert.equal(dune.target, 'library')

  // Arrival só tem sessão em reviews.csv; Sicario, só na watchlist.
  assert.equal(titles.find(t => t.slug === 'arrival')!.sessions, 1)
  assert.equal(titles.find(t => t.slug === 'sicario')!.target, 'backlog')

  assert.deepEqual(totals, { titles: 3, library: 2, backlog: 1, sessions: 3, rated: 2, discardedRows: 0 })
})

test('filme na watchlist e já assistido conta como biblioteca, nunca backlog', () => {
  const plan = planLetterboxd([
    { path: 'watchlist.csv', text: `${HEAD}\n2026-01-01,Dune,2021,${uri('dune-2021')}\n` },
    { path: 'watched.csv',   text: `${HEAD}\n2026-02-01,Dune,2021,${uri('dune-2021')}\n` },
  ])
  assert.equal(plan.titles.length, 1)
  assert.equal(plan.titles[0].target, 'library')
  assert.deepEqual([plan.totals.library, plan.totals.backlog], [1, 0])
})

test('linhas sem título entram na conta do que foi descartado', () => {
  const plan = planLetterboxd([
    { path: 'watched.csv', text: `${HEAD}\n2026-01-01,,2015,\n2026-01-02,Sicario,2015,${uri('sicario')}\n` },
  ])
  assert.equal(plan.files[0].rows, 1)
  assert.equal(plan.files[0].discarded, 1)
  assert.equal(plan.totals.discardedRows, 1)
})

test('arquivo reconhecido mas vazio não vira etapa da importação', () => {
  const plan = planLetterboxd([{ path: 'watchlist.csv', text: `${HEAD}\n` }])
  assert.deepEqual(plan.files, [])
  assert.deepEqual(plan.ignored, [{ path: 'watchlist.csv', reason: 'Arquivo vazio no export.' }])
})

test('CSV avulso é aceito pelo cabeçalho e o tipo pode ser corrigido', () => {
  const csv = [{ path: 'meus-filmes.csv', text: `${HEAD}\n2026-01-01,Sicario,2015,${uri('sicario')}\n` }]

  const guess = planLetterboxd(csv, { origin: 'csv' })
  assert.equal(guess.files[0].kind, 'watched')
  assert.equal(guess.files[0].ambiguous, true)
  assert.equal(guess.titles[0].target, 'library')

  const fixed = planLetterboxd(csv, { origin: 'csv', overrides: { 'meus-filmes.csv': 'watchlist' } })
  assert.equal(fixed.files[0].kind, 'watchlist')
  assert.equal(fixed.titles[0].target, 'backlog')
  assert.match(fixed.files[0].does, /backlog/)
})

test('num zip, arquivo de nome estranho é ignorado mesmo com cabeçalho válido', () => {
  const plan = planLetterboxd(
    [{ path: 'meus-filmes.csv', text: `${HEAD}\n2026-01-01,Sicario,2015,${uri('sicario')}\n` }],
    { origin: 'zip' },
  )
  assert.deepEqual(plan.files, [])
  assert.equal(plan.ignored.length, 1)
})

test('a mesma noite em reviews.csv e diary.csv conta como uma sessão só', () => {
  const night = `${HEAD},Rating,Rewatch,Review,Tags,Watched Date`
  const plan = planLetterboxd([
    { path: 'reviews.csv', text: `${night}\n2026-02-02,Arrival,2016,${uri('arrival')},5,No,Chorei,,2026-02-01\n` },
    { path: 'diary.csv',   text: `${night}\n2026-02-02,Arrival,2016,${uri('arrival')},5,No,,,2026-02-01\n2026-06-02,Arrival,2016,${uri('arrival')},5,Yes,,,2026-06-01\n` },
  ])
  // Duas datas distintas, ainda que em três linhas — é o que o importador cria.
  assert.equal(plan.titles[0].sessions, 2)
  assert.equal(plan.totals.sessions, 2)
})

test('watched.csv e ratings.csv não geram sessão: a coluna Date é o dia do registro', () => {
  // O mesmo filme, visto no dia 1 e registrado no dia 2. Contar as duas datas
  // punha o filme no diário em dois dias seguidos — foi o bug do primeiro
  // import de verdade.
  const plan = planLetterboxd([
    { path: 'watched.csv', text: `${HEAD}
2025-06-02,Sicario,2015,${uri('sicario')}
` },
    { path: 'ratings.csv', text: `${HEAD},Rating
2025-06-02,Sicario,2015,${uri('sicario')},4
` },
    { path: 'diary.csv',   text: `${HEAD},Rating,Rewatch,Tags,Watched Date
2025-06-02,Sicario,2015,${uri('sicario')},4,No,,2025-06-01
` },
  ])

  assert.equal(plan.titles.length, 1)
  assert.equal(plan.titles[0].sessions, 1)
  assert.equal(plan.totals.sessions, 1)
  // A nota e o destino continuam vindo dos outros arquivos.
  assert.equal(plan.titles[0].rating, 4)
  assert.equal(plan.titles[0].target, 'library')
})

test('sem diary.csv, um export só de assistidos não promete nenhuma sessão', () => {
  const plan = planLetterboxd([
    { path: 'watched.csv', text: `${HEAD}
2025-06-02,Sicario,2015,${uri('sicario')}
` },
  ])
  assert.equal(plan.totals.sessions, 0)
  assert.equal(plan.totals.library, 1)
})
