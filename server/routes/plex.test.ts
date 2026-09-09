import { test } from 'node:test'
import assert from 'node:assert/strict'
import { originalFilenameFromPlex } from '../plex.js'

test('extrai o nome do arquivo de caminhos do Plex no Windows e Unix', () => {
  assert.equal(
    originalFilenameFromPlex({ Media: [{ Part: [{ file: 'D:\\Filmes\\Duna (2021).mkv' }] }] }),
    'Duna (2021).mkv',
  )
  assert.equal(
    originalFilenameFromPlex({ Media: [{ Part: [{ file: '/mnt/filmes/Duna (2021).mkv' }] }] }),
    'Duna (2021).mkv',
  )
})

test('retorna nulo quando o Plex não informa um arquivo', () => {
  assert.equal(originalFilenameFromPlex({}), null)
  assert.equal(originalFilenameFromPlex({ Media: [{ Part: [{ file: '   ' }] }] }), null)
})
