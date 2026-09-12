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
