import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

process.env.DATA_DIR = mkdtempSync(join(tmpdir(), 'shelf-plex-diary-'))
// Sem credenciais o handler não sai para a rede: resolve tudo pelo guid local.
delete process.env.TMDB_API_KEY
delete process.env.PLEX_URL
delete process.env.PLEX_TOKEN
delete process.env.PLEX_WEBHOOK_SECRET

let webhook: typeof import('./integrations/plex-webhook.js').default
let diary: typeof import('./diary.js').default
let db: Database.Database

const EPISODE_PAYLOAD = {
  event: 'media.scrobble',
  Metadata: {
    type: 'episode',
    title: 'O Encontro',
    grandparentTitle: 'Série do Plex',
    grandparentGuid: 'plex://show/serie-do-plex',
    parentIndex: 1,
    index: 4,
    lastViewedAt: 1_789_038_000,
  },
}

async function scrobble(payload: unknown): Promise<Response> {
  const body = new FormData()
  body.set('payload', JSON.stringify(payload))
  return webhook.request('/plex/webhook', { method: 'POST', body })
}

before(async () => {
  db = (await import('../db.js')).db
  webhook = (await import('./integrations/plex-webhook.js')).default
  diary = (await import('./diary.js')).default
})

after(() => db.close())

test('um episódio do Plex vira um registro de episódio, não um comentário na série', async () => {
  assert.equal((await scrobble(EPISODE_PAYLOAD)).status, 200)

  assert.deepEqual(db.prepare(`
    SELECT d.season_number, d.episode_number, d.comment, m.type, m.title
      FROM diary_entries d JOIN media_items m ON m.id = d.media_item_id
     WHERE d.source = 'plex'
  `).all(), [{
    season_number: 1, episode_number: 4, comment: null,
    type: 'series', title: 'Série do Plex',
  }])

  // O título do episódio mora na estrutura da série e volta no join do diário.
  const listed = await (await diary.request('/')).json() as {
    season_number: number | null; episode_number: number | null; episode_title: string | null
  }[]
  const episode = listed.find(entry => entry.episode_number === 4)
  assert.equal(episode?.season_number, 1)
  assert.equal(episode?.episode_title, 'O Encontro')
})

test('reentrega do mesmo scrobble não duplica o registro', async () => {
  assert.equal((await scrobble(EPISODE_PAYLOAD)).status, 200)
  assert.equal((db.prepare(
    "SELECT COUNT(*) AS n FROM diary_entries WHERE source = 'plex'",
  ).get() as { n: number }).n, 1)
})

test('outro episódio da mesma temporada ganha o próprio registro', async () => {
  await scrobble({
    ...EPISODE_PAYLOAD,
    Metadata: { ...EPISODE_PAYLOAD.Metadata, title: 'A Despedida', index: 5, lastViewedAt: 1_789_128_000 },
  })
  assert.deepEqual(db.prepare(`
    SELECT season_number, episode_number FROM diary_entries
     WHERE source = 'plex' ORDER BY episode_number
  `).all(), [
    { season_number: 1, episode_number: 4 },
    { season_number: 1, episode_number: 5 },
  ])
})

const MOVIE_METADATA = {
  type: 'movie',
  title: 'Filme do Plex',
  guid: 'plex://movie/filme-do-plex',
  year: 2024,
  lastViewedAt: 1_789_200_000,
}

function movieDiary() {
  return db.prepare(`
    SELECT d.rating AS diary_rating, m.rating AS media_rating
      FROM diary_entries d JOIN media_items m ON m.id = d.media_item_id
     WHERE m.external_id = ? AND d.source = 'plex'
  `).all(MOVIE_METADATA.guid)
}

test('a nota dada no Plex depois de terminar o filme atualiza a entrada do diário', async () => {
  await scrobble({ event: 'media.scrobble', Metadata: MOVIE_METADATA })
  assert.deepEqual(movieDiary(), [{ diary_rating: null, media_rating: 0 }])

  await scrobble({
    event: 'media.rate',
    Metadata: { ...MOVIE_METADATA, userRating: 9, lastViewedAt: 1_789_200_600 },
  })
  assert.deepEqual(movieDiary(), [{ diary_rating: 4.5, media_rating: 4.5 }])
})

test('um scrobble que já traz a nota grava a entrada avaliada', async () => {
  const guid = 'plex://movie/ja-avaliado'
  await scrobble({ event: 'media.scrobble', Metadata: { ...MOVIE_METADATA, guid, userRating: 7 } })
  assert.deepEqual(db.prepare(`
    SELECT d.rating AS diary_rating, m.rating AS media_rating
      FROM diary_entries d JOIN media_items m ON m.id = d.media_item_id
     WHERE m.external_id = ?
  `).all(guid), [{ diary_rating: 3.5, media_rating: 3.5 }])
})

test('a nota de um episódio vai para o registro daquele episódio', async () => {
  await scrobble({
    event: 'media.rate',
    Metadata: { ...EPISODE_PAYLOAD.Metadata, userRating: 8 },
  })
  assert.deepEqual(db.prepare(`
    SELECT season_number, episode_number, rating FROM diary_entries
     WHERE source = 'plex' AND season_number IS NOT NULL ORDER BY episode_number
  `).all(), [
    { season_number: 1, episode_number: 4, rating: 4 },
    { season_number: 1, episode_number: 5, rating: null },
  ])
})
