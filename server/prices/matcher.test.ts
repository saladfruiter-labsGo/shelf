/** Correspondência: normalização de títulos, rejeição de edições e Steam AppID. */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-matcher-'))
process.env.ITAD_API_KEY = 'test-key'

type Matcher = typeof import('./matcher.js')
let m: Matcher

const fixture = (name: string) =>
  JSON.parse(readFileSync(new URL(`./__fixtures__/${name}`, import.meta.url), 'utf-8'))

before(async () => { m = await import('./matcher.js') })

test('normalizeTitle ignora acento, caixa, pontuação e artigo inicial', () => {
  assert.equal(m.normalizeTitle('The Witcher 3: Wild Hunt'), 'witcher 3 wild hunt')
  assert.equal(m.normalizeTitle('  Pokémon™ Legends '), 'pokemon legends')
  assert.equal(m.normalizeTitle('Ori & the Blind Forest'), 'ori and blind forest')
  assert.equal(m.normalizeTitle("Baldur's Gate 3"), "baldur's gate 3")
})

test('hasEditionMismatch separa edições diferentes do mesmo jogo', () => {
  assert.equal(m.hasEditionMismatch('Cyberpunk 2077', 'Cyberpunk 2077'), false)
  assert.equal(m.hasEditionMismatch('Cyberpunk 2077', 'Cyberpunk 2077: Ultimate Edition'), true)
  assert.equal(m.hasEditionMismatch('Hades', 'Hades Soundtrack'), true)
  assert.equal(m.hasEditionMismatch('Skyrim', 'Skyrim Special Edition'), false)  // "special" não é marcador
  assert.equal(m.hasEditionMismatch('Dark Souls Remastered', 'Dark Souls Remastered'), false)
})

test('titleConfidence só é alta com título idêntico, tipo jogo e mesma edição', () => {
  const game = (title: string, type: string | null) => ({ id: 'x', slug: '', title, type, mature: false })

  assert.equal(m.titleConfidence('Cyberpunk 2077', game('Cyberpunk 2077', 'game')), 'high')
  assert.equal(m.titleConfidence('Cyberpunk 2077', game('Cyberpunk 2077', 'dlc')), 'low')
  assert.equal(m.titleConfidence('Cyberpunk 2077', game('Cyberpunk 2077: Phantom Liberty', 'game')), 'low')
  assert.equal(m.titleConfidence('Cyberpunk 2077', game('Cyberpunk 2077 Ultimate Edition', 'package')), 'low')
  assert.equal(m.titleConfidence('The Witcher 3', game('Witcher 3', 'game')), 'high')
})

test('rankCandidates coloca o jogo exato na frente da DLC e do pacote', () => {
  const ranked = m.rankCandidates('Cyberpunk 2077', fixture('search-v1.json'))
  assert.equal(ranked[0].title, 'Cyberpunk 2077')
  assert.equal(ranked[0].type, 'game')
})

test('steamAppIdFromUrl extrai o appid do link da loja', () => {
  assert.equal(m.steamAppIdFromUrl('https://store.steampowered.com/app/1091500/Cyberpunk_2077/'), 1091500)
  assert.equal(m.steamAppIdFromUrl('https://www.gog.com/game/cyberpunk_2077'), null)
  assert.equal(m.steamAppIdFromUrl(''), null)
})
