import { after, before, test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type Database from 'better-sqlite3'

const dataDir = mkdtempSync(join(tmpdir(), 'shelf-integration-modules-'))
process.env.DATA_DIR = dataDir

let db: Database.Database
let cfg: typeof import('../integrations/config.js').cfg
let setCfg: typeof import('../integrations/config.js').setCfg
let ensureSecret: typeof import('../integrations/config.js').ensureSecret
let kavitaRoutes: typeof import('./integrations/kavita.js').default
let pollKavita: typeof import('./integrations/kavita.js').pollKavita
let lastfmRoutes: typeof import('./integrations/lastfm.js').default
let getLastfmNowPlaying: typeof import('./integrations/lastfm.js').getLastfmNowPlaying
let playniteRoutes: typeof import('./integrations/playnite.js').default
let plexLibraryRoutes: typeof import('./integrations/plex-library.js').default
let plexLiveRoutes: typeof import('./integrations/plex-live.js').default
let pollPlexSessions: typeof import('./integrations/plex-live.js').pollPlexSessions
let getPlexNowPlaying: typeof import('./integrations/plex-live.js').getPlexNowPlaying
let plexWebhookRoutes: typeof import('./integrations/plex-webhook.js').default
let ensurePlexWebhookSecret: typeof import('./integrations/plex-webhook.js').ensurePlexWebhookSecret
let priceRoutes: typeof import('./integrations/prices.js').default
let steamRoutes: typeof import('./integrations/steam.js').default

before(async () => {
  db = (await import('../db.js')).db
  const config = await import('../integrations/config.js')
  cfg = config.cfg
  setCfg = config.setCfg
  ensureSecret = config.ensureSecret
  const kavita = await import('./integrations/kavita.js')
  kavitaRoutes = kavita.default
  pollKavita = kavita.pollKavita
  const lastfm = await import('./integrations/lastfm.js')
  lastfmRoutes = lastfm.default
  getLastfmNowPlaying = lastfm.getLastfmNowPlaying
  playniteRoutes = (await import('./integrations/playnite.js')).default
  plexLibraryRoutes = (await import('./integrations/plex-library.js')).default
  const plexLive = await import('./integrations/plex-live.js')
  plexLiveRoutes = plexLive.default
  pollPlexSessions = plexLive.pollPlexSessions
  getPlexNowPlaying = plexLive.getPlexNowPlaying
  const plexWebhook = await import('./integrations/plex-webhook.js')
  plexWebhookRoutes = plexWebhook.default
  ensurePlexWebhookSecret = plexWebhook.ensurePlexWebhookSecret
  priceRoutes = (await import('./integrations/prices.js')).default
  steamRoutes = (await import('./integrations/steam.js')).default
})

after(() => db.close())

test('configuração persistida prevalece e segredo gerado é estável', () => {
  process.env.TEST_INTEGRATION_VALUE = 'ambiente'
  assert.equal(cfg('TEST_INTEGRATION_VALUE'), 'ambiente')

  setCfg('TEST_INTEGRATION_VALUE', 'banco')
  assert.equal(cfg('TEST_INTEGRATION_VALUE'), 'banco')
  setCfg('TEST_INTEGRATION_VALUE', '')
  assert.equal(cfg('TEST_INTEGRATION_VALUE'), 'ambiente')

  const first = ensureSecret('TEST_WEBHOOK_SECRET')
  assert.match(first, /^[a-f0-9]{32}$/)
  assert.equal(ensureSecret('TEST_WEBHOOK_SECRET'), first)
})

test('routers extraídos preservam os caminhos públicos', async () => {
  const resolved = await steamRoutes.request('/steam/resolve', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ input: '76561198000000000' }),
  })
  assert.equal(resolved.status, 200)
  assert.deepEqual(await resolved.json(), { ok: true, steam_id: '76561198000000000' })

  const missingPriceKey = await priceRoutes.request('/itad/test', { method: 'POST' })
  assert.equal(missingPriceKey.status, 400)
  assert.equal((await missingPriceKey.json() as { ok: boolean }).ok, false)

  const invalidCover = await kavitaRoutes.request('/kavita/image?seriesId=abc')
  assert.equal(invalidCover.status, 404)
})

test('webhook repetido do Playnite não duplica conclusão, atividade ou diário', async () => {
  setCfg('PLAYNITE_ENABLED', '1')
  const secret = ensureSecret('PLAYNITE_WEBHOOK_SECRET')
  const payload = {
    gameId: 'game-1',
    name: 'Jogo idempotente',
    completionStatus: 'Completed',
    playtimeSeconds: 7_200,
    userScore: 80,
    lastPlayed: '2026-09-10T10:00:00.000Z',
  }
  const send = () => playniteRoutes.request(`/playnite/webhook?token=${secret}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  })

  assert.equal((await send()).status, 200)
  assert.equal((await send()).status, 200)

  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM media_items WHERE external_id = 'playnite:game-1'").get() as { n: number }).n, 1)
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE source = 'playnite' AND event_type = 'played'").get() as { n: number }).n, 1)
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM diary_entries WHERE source = 'playnite'").get() as { n: number }).n, 1)
})

test('poll repetido do Kavita preserva progresso sem duplicar conclusão', async () => {
  setCfg('KAVITA_ENABLED', '1')
  setCfg('KAVITA_URL', 'http://kavita.test')
  setCfg('KAVITA_API_KEY', 'secret')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.includes('/api/Plugin/authenticate')) {
      return new Response(JSON.stringify({ token: 'jwt' }), { status: 200 })
    }
    if (url.includes('/api/Series/all-v2')) {
      return new Response(JSON.stringify([{
        id: 42,
        name: 'Livro concluído',
        pages: 200,
        pagesRead: 200,
        userRating: 90,
        hasUserRated: true,
        latestReadDate: '2026-09-10T11:00:00.000Z',
        libraryId: 1,
      }]), { status: 200 })
    }
    if (url.includes('/api/Series/metadata')) {
      return new Response(JSON.stringify({ writers: [{ name: 'Autora' }] }), { status: 200 })
    }
    return new Response(null, { status: 404 })
  }

  try {
    await pollKavita()
    await pollKavita()
  } finally {
    globalThis.fetch = originalFetch
  }

  const book = db.prepare(`
    SELECT status, rating, pages_total, pages_read, author
    FROM media_items WHERE external_id = 'kavita:42'
  `).get()
  assert.deepEqual(book, {
    status: 'completed', rating: 4.5, pages_total: 200, pages_read: 200, author: 'Autora',
  })
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE source = 'kavita' AND event_type = 'read'").get() as { n: number }).n, 1)
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM diary_entries WHERE source = 'kavita'").get() as { n: number }).n, 1)
})

test('sync repetido do Last.fm não duplica scrobble e atualiza tocando agora', async () => {
  setCfg('LASTFM_ENABLED', '1')
  setCfg('LASTFM_API_KEY', 'lastfm-key')
  setCfg('LASTFM_USER', 'listener')
  setCfg('LASTFM_LAST_UTS', '0')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = new URL(String(input))
    switch (url.searchParams.get('method')) {
      case 'user.getRecentTracks':
        return Response.json({ recenttracks: { track: [
          {
            name: 'Faixa atual', artist: { '#text': 'Artista atual' },
            image: [{ size: 'extralarge', '#text': 'https://images.test/current.jpg' }],
            '@attr': { nowplaying: 'true' },
          },
          {
            name: 'Faixa concluída', artist: { '#text': 'Artista' }, album: { '#text': 'Álbum' },
            image: [{ size: 'extralarge', '#text': 'https://images.test/track.jpg' }],
            date: { uts: '1789038000' },
          },
        ] } })
      case 'track.getInfo':
        return Response.json({ track: { duration: '240000', mbid: 'track-mbid' } })
      case 'artist.getTopTags':
        return Response.json({ toptags: { tag: [{ name: 'Rock' }] } })
      default:
        return new Response(null, { status: 404 })
    }
  }

  try {
    assert.equal((await lastfmRoutes.request('/lastfm/sync', { method: 'POST' })).status, 200)
    assert.equal((await lastfmRoutes.request('/lastfm/sync', { method: 'POST' })).status, 200)
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.deepEqual(getLastfmNowPlaying(), {
    media_type: 'music',
    title: 'Faixa atual',
    subtitle: 'Artista atual',
    cover_url: 'https://images.test/current.jpg',
    state: 'playing',
    position_ms: null,
    duration_ms: null,
    updated_at: getLastfmNowPlaying()?.updated_at,
  })
  assert.deepEqual(db.prepare(`
    SELECT album, duration_ms, genre, mbid, play_count
    FROM music_tracks WHERE artist = 'Artista' AND track = 'Faixa concluída'
  `).get(), {
    album: 'Álbum', duration_ms: 240000, genre: 'Rock', mbid: 'track-mbid', play_count: 1,
  })
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM activity_events WHERE source = 'lastfm'").get() as { n: number }).n, 1)
  assert.equal((db.prepare("SELECT COUNT(*) AS n FROM media_items WHERE external_id = 'Artista|Faixa concluída' AND type = 'music'").get() as { n: number }).n, 1)
  assert.equal(cfg('LASTFM_LAST_UTS'), '1789038000')
})

test('sync de arquivos do Plex preserva a rota e atualiza o filme correspondente', async () => {
  setCfg('PLEX_URL', 'http://plex.test')
  setCfg('PLEX_TOKEN', 'plex-token')
  db.prepare(`
    INSERT INTO media_items (external_id, type, title, year, status)
    VALUES ('plex:movie-file', 'movie', 'Filme do Plex', 2026, 'completed')
  `).run()
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input) => {
    const url = String(input)
    if (url.endsWith('/library/sections')) {
      return Response.json({ MediaContainer: { Directory: [{ key: '1', type: 'movie' }] } })
    }
    if (url.includes('/library/sections/1/all?')) {
      return Response.json({ MediaContainer: { Metadata: [{
        ratingKey: 'movie-file',
        title: 'Filme do Plex',
        year: 2026,
        Media: [{ Part: [{ file: '/movies/Filme do Plex (2026).mkv' }] }],
      }], totalSize: 1 } })
    }
    return new Response(null, { status: 404 })
  }

  let response: Response
  try {
    response = await plexLibraryRoutes.request('/plex/sync-files', { method: 'POST' })
  } finally {
    globalThis.fetch = originalFetch
  }

  assert.equal(response.status, 200)
  assert.deepEqual(await response.json(), {
    sections: 1, scanned: 1, matched: 1, updated: 1, without_file: 0, unmatched: 0,
  })
  assert.equal((db.prepare(
    "SELECT original_filename FROM media_items WHERE external_id = 'plex:movie-file'",
  ).get() as { original_filename: string }).original_filename, 'Filme do Plex (2026).mkv')
})

test('poll do Plex seleciona a sessão ativa do usuário configurado', async () => {
  setCfg('PLEX_ENABLED', '1')
  setCfg('PLEX_URL', 'http://plex.test')
  setCfg('PLEX_TOKEN', 'plex-token')
  setCfg('PLEX_USER', 'Igao')
  const originalFetch = globalThis.fetch
  globalThis.fetch = async () => Response.json({ MediaContainer: { Metadata: [
    {
      type: 'movie', title: 'Filme pausado', Player: { state: 'paused' },
      User: { title: 'Igao' }, viewOffset: 1000, duration: 5000,
    },
    {
      type: 'episode', title: 'Episódio', grandparentTitle: 'Série ativa',
      parentIndex: 2, index: 3, Player: { state: 'playing' }, User: { title: 'Igao' },
      viewOffset: 2000, duration: 6000,
    },
    {
      type: 'movie', title: 'Outro usuário', Player: { state: 'playing' },
      User: { title: 'Outra pessoa' },
    },
  ] } })

  try {
    await pollPlexSessions()
  } finally {
    globalThis.fetch = originalFetch
  }

  const current = getPlexNowPlaying()
  assert.equal(current?.title, 'Série ativa')
  assert.equal(current?.subtitle, 'T2E3 · Episódio')
  assert.equal(current?.state, 'playing')
  assert.equal(current?.position_ms, 2000)
  assert.equal(current?.duration_ms, 6000)
  assert.ok(current?.updated_at)

  setCfg('PLEX_TOKEN', '')
  assert.equal((await plexLiveRoutes.request('/plex/image?path=%2Fthumb')).status, 404)
})

test('retry do webhook Plex não duplica atividade, filme ou diário', async () => {
  setCfg('PLEX_USER', 'Igao')
  const secret = ensurePlexWebhookSecret()
  const payload = {
    event: 'media.scrobble',
    Account: { title: 'Igao' },
    Metadata: {
      type: 'movie',
      title: 'Filme idempotente',
      guid: 'tmdb://987654',
      ratingKey: 'plex-movie-retry',
      lastViewedAt: 1_789_038_000,
      duration: 7_200_000,
      Media: [{ Part: [{ file: '/movies/Filme idempotente.mkv' }] }],
    },
  }
  const send = () => {
    const body = new FormData()
    body.set('payload', JSON.stringify(payload))
    return plexWebhookRoutes.request(`/plex/webhook?token=${secret}`, { method: 'POST', body })
  }

  assert.equal((await send()).status, 200)
  assert.equal((await send()).status, 200)

  assert.equal((db.prepare(
    "SELECT COUNT(*) AS n FROM media_items WHERE external_id = 'tmdb://987654' AND type = 'movie'",
  ).get() as { n: number }).n, 1)
  assert.equal((db.prepare(
    "SELECT COUNT(*) AS n FROM activity_events WHERE source = 'plex' AND external_ref = 'tmdb://987654'",
  ).get() as { n: number }).n, 1)
  assert.equal((db.prepare(`
    SELECT COUNT(*) AS n FROM diary_entries d
    JOIN media_items m ON m.id = d.media_item_id
    WHERE d.source = 'plex' AND m.external_id = 'tmdb://987654'
  `).get() as { n: number }).n, 1)
})
