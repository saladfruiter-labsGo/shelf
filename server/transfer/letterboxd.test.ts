/** Leitura dos CSVs do Letterboxd: parsing, detecção do tipo e campos. */
import test from 'node:test'
import assert from 'node:assert/strict'
import { parseCsv, parseLetterboxd, detectKind, letterboxdSlug } from './letterboxd.js'

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
