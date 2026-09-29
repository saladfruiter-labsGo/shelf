import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  fetchPlexImage,
  isPlexImagePath,
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

test('proxy de imagem aceita só os caminhos de capa que o Shelf grava', () => {
  assert.equal(isPlexImagePath('/library/metadata/103451/thumb/1790069259'), true)
  assert.equal(isPlexImagePath('/library/metadata/1/thumb'), true)
  assert.equal(isPlexImagePath('/library/metadata/1/art/1790069259'), true)

  for (const path of [
    undefined,
    '',
    '/status/sessions/history/all',
    '/library/onDeck',
    '/myplex/account',
    '/library/metadata/1',
    '/library/metadata/1/thumb/1?X-Plex-Token=x',
    '/library/metadata/1/thumb/1#x',
    '/library/metadata/1/thumb/../../../status/sessions',
    '/library/metadata/../../status/sessions/thumb/1',
    '/library/metadata/1/thumb/1\n/status/sessions',
    '//evil.test/library/metadata/1/thumb',
    'library/metadata/1/thumb',
    '/photo/:/transcode?url=/status/sessions',
    '/LIBRARY/metadata/1/thumb',
  ]) {
    assert.equal(isPlexImagePath(path), false, String(path))
  }
})

function stubFetch(contentType: string, calls: string[] = []): typeof fetch {
  return (async (input: string | URL | Request) => {
    calls.push(String(input))
    return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'Content-Type': contentType } })
  }) as typeof fetch
}

test('proxy recusa caminho fora do formato sem chamar o Plex', async () => {
  const calls: string[] = []
  const result = await fetchPlexImage('/status/sessions/history/all', {
    url: 'http://plex.test:32400', token: 'secret', fetcher: stubFetch('image/jpeg', calls),
  })
  assert.deepEqual(result, { ok: false, status: 400 })
  assert.deepEqual(calls, [])
})

test('proxy repassa capa válida e recusa resposta que não é imagem', async () => {
  const calls: string[] = []
  const ok = await fetchPlexImage('/library/metadata/7/thumb/123', {
    url: 'http://plex.test:32400/', token: 'secret', fetcher: stubFetch('image/jpeg', calls),
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.ok && ok.contentType, 'image/jpeg')
  assert.deepEqual(calls, ['http://plex.test:32400/library/metadata/7/thumb/123'])

  const xml = await fetchPlexImage('/library/metadata/7/thumb/123', {
    url: 'http://plex.test:32400', token: 'secret', fetcher: stubFetch('text/xml;charset=utf-8'),
  })
  assert.deepEqual(xml, { ok: false, status: 502 })
})

test('proxy sem Plex configurado responde 404', async () => {
  const result = await fetchPlexImage('/library/metadata/7/thumb/123', { url: '', token: '' })
  assert.deepEqual(result, { ok: false, status: 404 })
})
