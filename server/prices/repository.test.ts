/**
 * Repositório e migração. Roda contra um SQLite temporário, criado do zero e
 * também a partir de um banco que já existia antes desta funcionalidade.
 */
import { test, before } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import Database from 'better-sqlite3'

const dataDir = mkdtempSync(join(tmpdir(), 'shelf-repo-'))

// Banco "existente": criado com o schema anterior, sem as tabelas de preços.
{
  const legacy = new Database(join(dataDir, 'shelf.db'))
  legacy.exec(`
    CREATE TABLE media_items (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      external_id TEXT NOT NULL,
      type        TEXT NOT NULL,
      title       TEXT NOT NULL,
      cover_url   TEXT,
      year        INTEGER,
      genre       TEXT,
      runtime     INTEGER,
      rating      REAL DEFAULT 0,
      status      TEXT NOT NULL DEFAULT 'wishlist',
      notes       TEXT,
      added_at    TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at  TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(external_id, type)
    );
    INSERT INTO media_items (external_id, type, title, status) VALUES ('41494', 'game', 'Cyberpunk 2077', 'wishlist');
    INSERT INTO media_items (external_id, type, title, status) VALUES ('3498',  'game', 'GTA V',          'completed');
    INSERT INTO media_items (external_id, type, title, status) VALUES ('550',   'movie','Clube da Luta',  'wishlist');
  `)
  legacy.close()
}

process.env.DATA_DIR = dataDir
process.env.ITAD_API_KEY = 'test-key'

type Repo = typeof import('./repository.js')
let repo: Repo
let db: import('better-sqlite3').Database

const offer = (shop: number, name: string, price: number, regular = 9899, cut = 0) => ({
  shop_id: shop, shop_name: name,
  price_minor: price, regular_minor: regular, currency: 'BRL', discount_percent: cut,
  url: `https://next.isthereanydeal.com/link/${shop}/`,
  drm: null, voucher: null,
  observed_at: '2026-09-01T10:00:00.000Z',
})

before(async () => {
  repo = await import('./repository.js')
  db = (await import('../db.js')).db
})

test('migração cria as tabelas de preços num banco que já existia', () => {
  const tables = db.prepare(`SELECT name FROM sqlite_master WHERE type = 'table'`).all() as { name: string }[]
  const names = tables.map(t => t.name)
  for (const t of ['game_price_products', 'game_price_offers', 'game_price_history']) {
    assert.ok(names.includes(t), `tabela ${t} não foi criada`)
  }
  // As colunas novas de media_items também entram por migração.
  const cols = (db.prepare('PRAGMA table_info(media_items)').all() as { name: string }[]).map(c => c.name)
  assert.ok(cols.includes('game_status'))
  assert.ok(cols.includes('release_date'))
})

test('só jogos no backlog entram na sincronização automática', () => {
  const games = repo.backlogGames()
  assert.deepEqual(games.map(g => g.title), ['Cyberpunk 2077'])
  assert.equal(repo.isBacklogGame(games[0].id), true)
})

test('ensureProduct é idempotente', () => {
  const id = repo.backlogGames()[0].id
  const a = repo.ensureProduct(id)
  const b = repo.ensureProduct(id)
  assert.equal(a.id, b.id)
  assert.equal(a.match_status, 'pending')
  assert.equal((db.prepare('SELECT COUNT(*) AS n FROM game_price_products').get() as { n: number }).n, 1)
})

test('saveOffers grava ofertas e um snapshot, sem duplicar quando repetido', () => {
  const mediaId = repo.backlogGames()[0].id
  const p = repo.ensureProduct(mediaId)
  repo.saveMatch(p.id, {
    provider_game_id: '018d937f-012f-73b8-ab2c-898516969e6a',
    matched_title: 'Cyberpunk 2077', match_method: 'steam_id', match_status: 'resolved',
  })

  const offers = [offer(35, 'Nuuvem', 3959, 9899, 60), offer(61, 'Steam', 4949, 9899, 50)]
  repo.saveOffers(p.id, offers)
  repo.saveOffers(p.id, offers)   // segunda sincronização, mesmos preços

  assert.equal(repo.getOffers(p.id).length, 2)
  assert.equal(repo.getHistory(p.id).length, 2, 'snapshots equivalentes não podem duplicar')

  const best = repo.getOffers(p.id)[0]
  assert.equal(best.shop_name, 'Nuuvem')
  assert.equal(best.price_minor, 3959)
  assert.equal(best.available, 1)
})

test('mudança de preço no mesmo dia gera um ponto novo', () => {
  const p = repo.getProduct(repo.backlogGames()[0].id)!
  repo.saveOffers(p.id, [offer(35, 'Nuuvem', 2999, 9899, 70), offer(61, 'Steam', 4949, 9899, 50)])

  const nuuvem = repo.getHistory(p.id, { shopId: 35 })
  assert.deepEqual(nuuvem.map(h => h.price_minor).sort((a, b) => a - b), [2999, 3959])
})

test('oferta que some vira indisponível, mas o histórico é preservado', () => {
  const p = repo.getProduct(repo.backlogGames()[0].id)!
  const antes = repo.getHistory(p.id).length

  repo.saveOffers(p.id, [offer(61, 'Steam', 4949, 9899, 50)])   // Nuuvem sumiu da resposta

  const nuuvem = repo.getOffers(p.id).find(o => o.shop_id === 35)!
  assert.equal(nuuvem.available, 0)
  assert.equal(nuuvem.price_minor, 2999, 'o último preço conhecido continua ali')
  assert.equal(repo.getHistory(p.id).length, antes, 'histórico não pode encolher')
})

test('importHistory aceita o log do provedor sem duplicar reimportações', () => {
  const p = repo.getProduct(repo.backlogGames()[0].id)!
  const points = [
    { shop_id: 61, shop_name: 'Steam', price_minor: 9899, regular_minor: 9899, currency: 'BRL', discount_percent: 0,  observed_at: '2026-06-10T09:21:08.000Z' },
    { shop_id: 61, shop_name: 'Steam', price_minor: 2474, regular_minor: 9899, currency: 'BRL', discount_percent: 75, observed_at: '2026-07-04T08:00:00.000Z' },
  ]
  repo.importHistory(p.id, points)
  const depois = repo.getHistory(p.id).length
  repo.importHistory(p.id, points)
  assert.equal(repo.getHistory(p.id).length, depois)

  const shops = repo.getShops(p.id)
  assert.ok(shops.some(s => s.name === 'Steam'))
  assert.equal(repo.getShopLows(p.id)[61], 2474)
})

test('erro do provedor não apaga o último preço conhecido', () => {
  const p = repo.getProduct(repo.backlogGames()[0].id)!
  const antes = repo.getOffers(p.id)

  repo.saveError(p.id, 'ITAD respondeu 503')

  assert.deepEqual(repo.getOffers(p.id), antes)
  assert.equal(repo.getProduct(p.media_item_id)!.last_error, 'ITAD respondeu 503')
})

test('sair e voltar ao backlog preserva ofertas e histórico', () => {
  const mediaId = repo.backlogGames()[0].id
  const p = repo.getProduct(mediaId)!
  const historico = repo.getHistory(p.id).length
  const ofertas   = repo.getOffers(p.id).length

  db.prepare(`UPDATE media_items SET status = 'completed' WHERE id = ?`).run(mediaId)
  assert.deepEqual(repo.backlogGames(), [], 'fora do backlog não é mais consultado')
  assert.equal(repo.getHistory(p.id).length, historico)

  db.prepare(`UPDATE media_items SET status = 'wishlist' WHERE id = ?`).run(mediaId)
  assert.equal(repo.backlogGames().length, 1)
  assert.equal(repo.getProduct(mediaId)!.id, p.id, 'o acompanhamento continua do mesmo produto')
  assert.equal(repo.getOffers(p.id).length, ofertas)
})

test('o resumo do backlog traz a melhor oferta e o menor local numa consulta', () => {
  const p = repo.getProduct(repo.backlogGames()[0].id)!
  repo.markSynced(p.id, 'BRL', 2474)
  repo.saveOffers(p.id, [offer(61, 'Steam', 4949, 9899, 50), offer(35, 'Nuuvem', 3959, 9899, 60)])

  const [row] = repo.backlogSummaries()
  assert.equal(row.best_price_minor, 3959)
  assert.equal(row.best_shop_name, 'Nuuvem')
  assert.equal(row.best_shop_id, 35)
  assert.equal(row.currency, 'BRL')
  assert.equal(row.history_low_minor, 2474)
  assert.equal(row.local_low_minor, 2474)
  assert.equal(repo.backlogSummaries().length, 1, 'um item por jogo do backlog')
})

test('desassociar limpa a correspondência sem apagar o histórico', () => {
  const p = repo.getProduct(repo.backlogGames()[0].id)!
  const historico = repo.getHistory(p.id).length

  repo.clearMatch(p.id)

  const depois = repo.getProduct(p.media_item_id)!
  assert.equal(depois.match_status, 'pending')
  assert.equal(depois.provider_game_id, null)
  assert.equal(repo.getHistory(p.id).length, historico)
  assert.ok(repo.getOffers(p.id).every(o => o.available === 0))
})
