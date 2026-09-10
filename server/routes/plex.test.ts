import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  mapPlexMetadata,
  originalFilenameFromPlex,
  plexEventOccurredAt,
  tmdbIdFromGuid,
} from '../plex.js'

test('extrai id TMDB dos formatos de guid usados pelo Plex', () => {
  assert.equal(tmdbIdFromGuid('tmdb://550'), '550')
  assert.equal(tmdbIdFromGuid('com.plexapp.agents.themoviedb://550?lang=pt'), '550')
  assert.equal(tmdbIdFromGuid('plex://movie/hash'), null)
})

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

test('normaliza episódio para a série e preserva o episódio no subtítulo', () => {
  assert.deepEqual(mapPlexMetadata({
    type: 'episode',
    title: 'Piloto',
    grandparentTitle: 'Minha Série',
    parentIndex: 1,
    index: 2,
    grandparentThumb: '/library/metadata/1/thumb',
    guid: 'plex://episode/2',
  }), {
    media_type: 'series',
    title: 'Minha Série',
    subtitle: 'T1E2 · Piloto',
    cover_url: '/api/integrations/plex/image?path=%2Flibrary%2Fmetadata%2F1%2Fthumb',
    external_ref: 'plex://episode/2',
    kind: 'episode',
  })
})

test('usa o timestamp estável do Plex para identificar retries', () => {
  assert.equal(
    plexEventOccurredAt({ lastViewedAt: 1_789_038_000 }),
    '2026-09-10T11:00:00.000Z',
  )
  assert.equal(
    plexEventOccurredAt({}, new Date('2026-09-10T12:00:00.000Z')),
    '2026-09-10T12:00:00.000Z',
  )
})
