import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'shelf-roundtrip-'))
process.env.DATA_DIR = dataDir
process.env.BACKUP_DIR = join(dataDir, 'backups')

let db: import('better-sqlite3').Database
let buildExport: typeof import('./export.js').buildExport
let importShelfBackup: typeof import('./importer.js').importShelfBackup

before(async () => {
  db = (await import('../db.js')).db
  buildExport = (await import('./export.js')).buildExport
  importShelfBackup = (await import('./importer.js')).importShelfBackup
})

test('export v2 restaura tiers, atividade musical e histórico de preços sem credenciais', () => {
  db.prepare("INSERT INTO settings (key, value) VALUES ('PLEX_TOKEN', 'nao-exportar')").run()
  const mediaId = Number(db.prepare(`
    INSERT INTO media_items (external_id, type, title, status, rating, notes)
    VALUES ('game-1', 'game', 'Jogo de teste', 'completed', 4.5, 'nota pessoal')
  `).run().lastInsertRowid)
  db.prepare(`
    INSERT INTO diary_entries (media_item_id, watched_at, rating, comment, source)
    VALUES (?, '2026-08-01T20:00:00.000Z', 4.5, 'ótimo', 'manual')
  `).run(mediaId)
  db.prepare(`
    INSERT INTO diary_entries
      (media_item_id, watched_at, rating, source, progress_day, progress_value, progress_total, progress_unit)
    VALUES (?, '2026-08-02T01:00:00.000Z', 4, 'playnite', '2026-08-01', 5400, NULL, 'seconds')
  `).run(mediaId)
  db.prepare(`
    INSERT INTO diary_progress
      (media_item_id, source, progress_day, progress_value, progress_total, progress_unit, rating, observed_at)
    VALUES (?, 'playnite', '2026-08-04', 6000, NULL, 'seconds', 4.5, '2026-08-05T01:00:00.000Z')
  `).run(mediaId)

  const seriesId = Number(db.prepare(`
    INSERT INTO media_items (external_id, type, title, status)
    VALUES ('series-1', 'series', 'Série de teste', 'completed')
  `).run().lastInsertRowid)
  db.prepare(`
    INSERT INTO series_seasons
      (media_item_id, season_number, title, episode_count, status, completed_at, rating)
    VALUES (?, 1, 'Temporada 1', 1, 'completed', '2026-08-06', 4.5)
  `).run(seriesId)
  db.prepare(`
    INSERT INTO series_episodes
      (media_item_id, season_number, episode_number, title, watched, watched_at)
    VALUES (?, 1, 1, 'Final', 1, '2026-08-06T20:00:00.000Z')
  `).run(seriesId)
  db.prepare(`
    INSERT INTO diary_entries
      (media_item_id, watched_at, rating, source, season_number, episode_number)
    VALUES (?, '2026-08-06T20:00:00.000Z', 4.5, 'manual', 1, NULL)
  `).run(seriesId)

  const listId = Number(db.prepare(`
    INSERT INTO lists (name, description, mode, dim_seen) VALUES ('Favoritos', 'ranking pessoal', 'tier', 1)
  `).run().lastInsertRowid)
  db.prepare("INSERT INTO lists (name, description, mode) VALUES ('Lista vazia', 'também é dado', 'list')").run()
  const tierId = Number(db.prepare(`
    INSERT INTO list_tiers (list_id, name, color, position) VALUES (?, 'S', 'movies', 0)
  `).run(listId).lastInsertRowid)
  db.prepare(`
    INSERT INTO list_items (list_id, media_item_id, position, tier_id) VALUES (?, ?, 3, ?)
  `).run(listId, mediaId, tierId)
  db.prepare(`
    INSERT INTO list_only_items
      (list_id, external_id, type, title, cover_url, year, genre, position, tier_id)
    VALUES (?, 'tmdb-only-1', 'movie', 'Filme só da lista', 'https://example.test/poster.jpg', 2024, 'Drama', 4, ?)
  `).run(listId, tierId)

  db.prepare(`
    INSERT INTO activity_events
      (source, event_type, media_type, external_ref, title, subtitle, duration_ms, genre, occurred_at, raw)
    VALUES ('lastfm', 'listen', 'music', 'artista|faixa', 'Faixa', 'Artista', 180000, 'Rock',
            '2026-08-02T10:00:00.000Z', '{"segredo":"nao-portar"}')
  `).run()
  db.prepare(`
    INSERT INTO music_tracks
      (artist, track, album, duration_ms, genre, play_count, first_played, last_played, enriched)
    VALUES ('Artista', 'Faixa', 'Álbum', 180000, 'Rock', 7,
            '2026-01-01T00:00:00.000Z', '2026-08-02T10:00:00.000Z', 1)
  `).run()

  const productId = Number(db.prepare(`
    INSERT INTO game_price_products
      (media_item_id, provider, platform, provider_game_id, matched_title, match_status, currency)
    VALUES (?, 'itad', 'pc', 'itad-1', 'Jogo de teste', 'resolved', 'BRL')
  `).run(mediaId).lastInsertRowid)
  db.prepare(`
    INSERT INTO game_price_offers
      (game_price_product_id, shop_id, shop_name, price_minor, regular_minor, currency,
       discount_percent, url, observed_at, last_seen_at)
    VALUES (?, 61, 'Steam', 4990, 9990, 'BRL', 50, 'https://example.test/deal',
            '2026-08-03T00:00:00.000Z', '2026-08-03T00:00:00.000Z')
  `).run(productId)
  db.prepare(`
    INSERT INTO game_price_history
      (game_price_product_id, shop_id, shop_name, price_minor, regular_minor, currency,
       discount_percent, observed_at, observed_day, source)
    VALUES (?, 61, 'Steam', 4990, 9990, 'BRL', 50,
            '2026-08-03T00:00:00.000Z', '2026-08-03', 'shelf_poll')
  `).run(productId)

  const exported = buildExport('all')
  assert.equal(exported.shelf_export, 2)
  assert.equal('id' in exported.items[0], false)
  assert.equal(JSON.stringify(exported).includes('nao-exportar'), false)
  assert.equal(JSON.stringify(exported).includes('nao-portar'), false)
  assert.deepEqual(exported.diary_progress, [{
    external_id: 'game-1', type: 'game', source: 'playnite', progress_day: '2026-08-04',
    progress_value: 6000, progress_total: null, progress_unit: 'seconds', rating: 4.5,
    observed_at: '2026-08-05T01:00:00.000Z',
  }])
  assert.equal((exported.series[0] as any).seasons[0].rating, 4.5)
  assert.equal((exported.lists[0] as any).tiers[0].name, 'S')
  assert.equal((exported.lists[0] as any).items[0].tier_key, (exported.lists[0] as any).tiers[0].key)
  assert.deepEqual((exported.lists[0] as any).items[1], {
    external_id: 'tmdb-only-1', type: 'movie', position: 4,
    tier_key: (exported.lists[0] as any).tiers[0].key,
    added_at: (exported.lists[0] as any).items[1].added_at,
    list_only: true, title: 'Filme só da lista',
    cover_url: 'https://example.test/poster.jpg', year: 2024,
    genre: 'Drama', author: null, release_date: null,
  })
  assert.equal(exported.lists.some((list: any) => list.name === 'Lista vazia' && list.items.length === 0), true)

  db.exec(`
    DELETE FROM game_price_history;
    DELETE FROM game_price_offers;
    DELETE FROM game_price_products;
    DELETE FROM diary_entries;
    DELETE FROM list_items;
    DELETE FROM list_only_items;
    DELETE FROM list_tiers;
    DELETE FROM lists;
    DELETE FROM activity_events;
    DELETE FROM music_tracks;
    DELETE FROM media_items;
  `)

  const report = importShelfBackup(exported, 'replace')
  assert.deepEqual(report.errors, [])
  assert.equal(report.created, 2)
  assert.deepEqual(report.restored, { lists: 2, activity: 1, tracks: 1, prices: 1 })
  assert.equal((db.prepare('SELECT COUNT(*) n FROM diary_entries').get() as any).n, 3)
  assert.equal((db.prepare(`
    SELECT rating FROM series_seasons WHERE media_item_id = (
      SELECT id FROM media_items WHERE external_id = 'series-1' AND type = 'series'
    ) AND season_number = 1
  `).get() as any).rating, 4.5)
  assert.deepEqual(db.prepare(`
    SELECT progress_day, progress_value, progress_unit
      FROM diary_entries WHERE source = 'playnite'
  `).get(), { progress_day: '2026-08-01', progress_value: 5400, progress_unit: 'seconds' })
  assert.deepEqual(db.prepare(`
    SELECT source, progress_day, progress_value, progress_unit, finalized_at
      FROM diary_progress
  `).get(), { source: 'playnite', progress_day: '2026-08-04', progress_value: 6000, progress_unit: 'seconds', finalized_at: null })
  assert.deepEqual(
    db.prepare(`
      SELECT l.mode, l.dim_seen, t.name tier, li.position
        FROM lists l JOIN list_tiers t ON t.list_id = l.id
        JOIN list_items li ON li.list_id = l.id AND li.tier_id = t.id
    `).get(),
    { mode: 'tier', dim_seen: 1, tier: 'S', position: 3 },
  )
  assert.deepEqual(db.prepare(`
    SELECT loi.external_id, loi.title, loi.year, loi.genre, loi.position, t.name AS tier
      FROM list_only_items loi
      JOIN list_tiers t ON t.id = loi.tier_id
  `).get(), {
    external_id: 'tmdb-only-1', title: 'Filme só da lista', year: 2024,
    genre: 'Drama', position: 4, tier: 'S',
  })
  assert.equal((db.prepare('SELECT play_count FROM music_tracks').get() as any).play_count, 7)
  assert.equal((db.prepare('SELECT COUNT(*) n FROM activity_events').get() as any).n, 1)
  assert.equal((db.prepare('SELECT COUNT(*) n FROM game_price_offers').get() as any).n, 1)
  assert.equal((db.prepare('SELECT COUNT(*) n FROM game_price_history').get() as any).n, 1)
  assert.equal((db.prepare('SELECT COUNT(*) n FROM list_only_items').get() as any).n, 1)

  // Reimportar é idempotente para estruturas auxiliares.
  const again = importShelfBackup(exported, 'replace')
  assert.deepEqual(again.errors, [])
  assert.equal((db.prepare('SELECT COUNT(*) n FROM activity_events').get() as any).n, 1)
  assert.equal((db.prepare('SELECT COUNT(*) n FROM list_tiers').get() as any).n, 1)
  assert.equal((db.prepare('SELECT COUNT(*) n FROM game_price_history').get() as any).n, 1)
})

test('importador continua aceitando o formato v1', () => {
  const report = importShelfBackup({
    shelf_export: 1,
    items: [{ external_id: 'movie-v1', type: 'movie', title: 'Filme antigo', status: 'wishlist' }],
    lists: [{ name: 'Lista antiga', mode: 'list', items: [{ external_id: 'movie-v1', type: 'movie' }] }],
  }, 'merge')
  assert.deepEqual(report.errors, [])
  assert.equal(report.created, 1)
  assert.equal((db.prepare("SELECT COUNT(*) n FROM media_items WHERE external_id = 'movie-v1'").get() as any).n, 1)
})

test('importador rejeita versões futuras em vez de tentar interpretá-las', () => {
  const report = importShelfBackup({ shelf_export: 99, items: [] })
  assert.match(report.errors[0], /não suportada/)
})
