import { test } from 'node:test'
import assert from 'node:assert/strict'
import { classifyFinale, summarizeFinale } from './finale.js'
import type { SteamAchievementSchema } from './client.js'

const ach = (name: string, description: string | null, hidden = false): SteamAchievementSchema =>
  ({ apiName: name.toUpperCase().replace(/\W+/g, '_'), name, description, hidden })

test('reconhece as três conquistas de final do Witcher 3', () => {
  assert.equal(classifyFinale(ach('Passed the Trial', 'Finish the game on any difficulty.')), 'high')
  assert.equal(classifyFinale(ach('Ran the Gauntlet', 'Finish the game on the "Blood and Broken Bones!" or "Death March!" difficulty levels.')), 'high')
  assert.equal(classifyFinale(ach('Walked the Path', 'Finish the game on the "Death March!" difficulty level.')), 'high')
})

test('não confunde conquista de progresso, coleção ou platina com o final', () => {
  assert.equal(classifyFinale(ach('The Limits of the Possible', 'Collect all trophies.')), null)
  assert.equal(classifyFinale(ach('Brawl Master', 'Complete all fistfighting quests in Velen, Skellige and Novigrad.')), null)
  assert.equal(classifyFinale(ach('Card Collector', 'Acquire all gwent cards available in the base version of the game.')), null)
  assert.equal(classifyFinale(ach('Act I', 'Complete Act 1.')), null)
  assert.equal(classifyFinale(ach('Butcher of Blaviken', 'Kill at least 5 opponents in under 10 seconds.')), null)
})

test('aceita variações comuns em inglês e português', () => {
  assert.equal(classifyFinale(ach('Credits', 'See the end credits.')), 'high')
  assert.equal(classifyFinale(ach('Happily Ever After', 'Get the true ending.')), 'high')
  assert.equal(classifyFinale(ach('Kingslayer', 'Defeat the final boss.')), 'high')
  assert.equal(classifyFinale(ach('Fim da jornada', 'Termine a história.')), 'high')
  assert.equal(classifyFinale(ach('Zerado', 'Zere o jogo em qualquer dificuldade.')), 'high')
  assert.equal(classifyFinale(ach('Epilogue', 'Reach the epilogue.')), 'low')
})

test('conquista oculta sem descrição só vale como pista fraca pelo nome', () => {
  assert.equal(classifyFinale(ach('The End', null, true)), 'low')
  assert.equal(classifyFinale(ach('Mysterious', null, true)), null)
})

test('resume o estado do jogo a partir da lista de conquistas', () => {
  assert.equal(summarizeFinale([]).state, 'no_achievements')
  assert.equal(summarizeFinale([ach('Passed the Trial', 'Finish the game on any difficulty.')]).state, 'auto')
  assert.equal(summarizeFinale([ach('Bookworm', 'Read 30 books.'), ach('???', null, true)]).state, 'confirm')
  assert.equal(summarizeFinale([ach('Bookworm', 'Read 30 books.')]).state, 'manual')

  const witcher = summarizeFinale([
    ach('Passed the Trial', 'Finish the game on any difficulty.'),
    ach('Walked the Path', 'Finish the game on the "Death March!" difficulty level.'),
    ach('Bookworm', 'Read 30 books, journals or other documents.'),
    ach('Secret', null, true),
  ])
  assert.equal(witcher.state, 'auto')
  assert.equal(witcher.high.length, 2)
  assert.equal(witcher.hiddenWithoutDescription, 1)
})
