import { Hono } from 'hono'
import { db } from '../db.js'

const app = new Hono()

/** Modos de exibição de uma lista. */
const MODES = ['list', 'ranking', 'tier'] as const
type ListMode = (typeof MODES)[number]
const isMode = (v: unknown): v is ListMode => MODES.includes(v as ListMode)

/** Tiers padrão de uma tierlist nova — cores são chaves de token, não hex (tema claro/escuro). */
const DEFAULT_TIERS: { name: string; color: string }[] = [
  { name: 'S', color: 'movies' },
  { name: 'A', color: 'books'  },
  { name: 'B', color: 'gold'   },
  { name: 'C', color: 'games'  },
  { name: 'D', color: 'series' },
]

/** Capas (na ordem da lista) que alimentam a colagem do card de cada lista. */
const coversStmt = db.prepare(`
  SELECT m.cover_url
  FROM list_items li
  JOIN media_items m ON m.id = li.media_item_id
  WHERE li.list_id = ? AND m.cover_url IS NOT NULL AND TRIM(m.cover_url) <> ''
  ORDER BY li.position, li.id
  LIMIT 6
`)

/** Quantos itens de cada tipo — vira o subtítulo do card ("32 filmes · 8 séries"). */
const typeCountsStmt = db.prepare(`
  SELECT m.type, COUNT(*) AS n
  FROM list_items li
  JOIN media_items m ON m.id = li.media_item_id
  WHERE li.list_id = ?
  GROUP BY m.type
`)

const tiersStmt = db.prepare('SELECT id, name, color, position FROM list_tiers WHERE list_id = ? ORDER BY position, id')

const touchStmt = db.prepare("UPDATE lists SET updated_at = datetime('now') WHERE id = ?")

/** Próxima posição livre da lista (as inclusões entram no fim). */
function nextPosition(listId: number | string): number {
  const row = db.prepare('SELECT MAX(position) AS max FROM list_items WHERE list_id = ?').get(listId) as { max: number | null }
  return (row.max ?? -1) + 1
}

function seedTiers(listId: number | string) {
  const insert = db.prepare('INSERT INTO list_tiers (list_id, name, color, position) VALUES (?, ?, ?, ?)')
  db.transaction(() => {
    DEFAULT_TIERS.forEach((t, i) => insert.run(listId, t.name, t.color, i))
  })()
}

app.get('/', (c) => {
  const lists = db.prepare(`
    SELECT l.*, COUNT(li.id) as item_count
    FROM lists l
    LEFT JOIN list_items li ON li.list_id = l.id
    GROUP BY l.id
    ORDER BY l.updated_at DESC
  `).all() as { id: number }[]

  return c.json(lists.map(list => ({
    ...list,
    covers: (coversStmt.all(list.id) as { cover_url: string }[]).map(r => r.cover_url),
    type_counts: Object.fromEntries(
      (typeCountsStmt.all(list.id) as { type: string; n: number }[]).map(r => [r.type, r.n]),
    ),
  })))
})

// Check which lists contain a specific media item
app.get('/check/:mediaItemId', (c) => {
  return c.json(db.prepare(`
    SELECT l.id, l.name,
           CASE WHEN li.media_item_id IS NOT NULL THEN 1 ELSE 0 END AS contains
    FROM lists l
    LEFT JOIN list_items li ON li.list_id = l.id AND li.media_item_id = ?
    ORDER BY l.name
  `).all(c.req.param('mediaItemId')))
})

app.get('/:id', (c) => {
  const id = c.req.param('id')
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id)
  if (!list) return c.json({ error: 'Not found' }, 404)
  // `position` é a ordem manual (ranking) e `tier_id` o tier em que a capa está.
  const items = db.prepare(`
    SELECT m.*, li.added_at AS list_added_at, li.position AS list_position, li.tier_id
    FROM media_items m
    JOIN list_items li ON li.media_item_id = m.id
    WHERE li.list_id = ?
    ORDER BY li.position, li.id
  `).all(id)
  return c.json({ ...list, items, tiers: tiersStmt.all(id) })
})

app.post('/', async (c) => {
  const { name, description, mode } = await c.req.json()
  if (!name?.trim()) return c.json({ error: 'name is required' }, 400)
  const listMode: ListMode = isMode(mode) ? mode : 'list'
  const res = db.prepare('INSERT INTO lists (name, description, mode) VALUES (?, ?, ?)')
    .run(name.trim(), description?.trim() ?? null, listMode)
  if (listMode === 'tier') seedTiers(res.lastInsertRowid as number)
  return c.json(db.prepare('SELECT * FROM lists WHERE id = ?').get(res.lastInsertRowid), 201)
})

app.patch('/:id', async (c) => {
  const id   = c.req.param('id')
  const body = await c.req.json()

  const sets: string[] = []
  const args: unknown[] = []
  if (typeof body.name === 'string' && body.name.trim()) {
    sets.push('name = ?'); args.push(body.name.trim())
  }
  // `description: ''` limpa a descrição — por isso não dá para usar COALESCE aqui.
  if ('description' in body) {
    sets.push('description = ?'); args.push(body.description?.trim() || null)
  }
  if ('mode' in body) {
    if (!isMode(body.mode)) return c.json({ error: 'invalid mode' }, 400)
    sets.push('mode = ?'); args.push(body.mode)
  }
  if ('dim_seen' in body) {
    sets.push('dim_seen = ?'); args.push(body.dim_seen ? 1 : 0)
  }
  if (sets.length === 0) return c.json({ error: 'nothing to update' }, 400)

  db.prepare(`UPDATE lists SET ${sets.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...args, id)
  const list = db.prepare('SELECT * FROM lists WHERE id = ?').get(id) as { id: number; mode: string } | undefined
  if (!list) return c.json({ error: 'Not found' }, 404)
  // Virar tierlist sem nenhum tier criado não mostraria nada: semeia os padrões.
  if (list.mode === 'tier' && (tiersStmt.all(id) as unknown[]).length === 0) seedTiers(id)
  return c.json({ ...list, tiers: tiersStmt.all(id) })
})

app.delete('/:id', (c) => {
  const res = db.prepare('DELETE FROM lists WHERE id = ?').run(c.req.param('id'))
  if (res.changes === 0) return c.json({ error: 'Not found' }, 404)
  return c.json({ ok: true })
})

app.post('/:id/items', async (c) => {
  const id = c.req.param('id')
  const { media_item_id, tier_id } = await c.req.json()
  try {
    db.prepare('INSERT INTO list_items (list_id, media_item_id, position, tier_id) VALUES (?, ?, ?, ?)')
      .run(id, media_item_id, nextPosition(id), tier_id ?? null)
    touchStmt.run(id)
    return c.json({ ok: true }, 201)
  } catch (e: any) {
    if (e.message?.includes('UNIQUE')) return c.json({ error: 'Already in list' }, 409)
    throw e
  }
})

app.delete('/:id/items/:mediaItemId', (c) => {
  db.prepare('DELETE FROM list_items WHERE list_id = ? AND media_item_id = ?')
    .run(c.req.param('id'), c.req.param('mediaItemId'))
  touchStmt.run(c.req.param('id'))
  return c.json({ ok: true })
})

/**
 * Reordenação em lote — cobre tanto o ranking (arrastar para outra posição)
 * quanto a tierlist (arrastar entre tiers). O cliente manda a ordem inteira.
 */
app.put('/:id/order', async (c) => {
  const id = c.req.param('id')
  const { items } = await c.req.json()
  if (!Array.isArray(items)) return c.json({ error: 'items must be an array' }, 400)

  const update = db.prepare('UPDATE list_items SET position = ?, tier_id = ? WHERE list_id = ? AND media_item_id = ?')
  db.transaction(() => {
    items.forEach((it: { media_item_id: number; tier_id?: number | null }, i: number) => {
      update.run(i, it.tier_id ?? null, id, it.media_item_id)
    })
    touchStmt.run(id)
  })()
  return c.json({ ok: true })
})

/* ─── Tiers ─── */

app.post('/:id/tiers', async (c) => {
  const id = c.req.param('id')
  const { name, color } = await c.req.json()
  if (!name?.trim()) return c.json({ error: 'name is required' }, 400)
  const row = db.prepare('SELECT MAX(position) AS max FROM list_tiers WHERE list_id = ?').get(id) as { max: number | null }
  const res = db.prepare('INSERT INTO list_tiers (list_id, name, color, position) VALUES (?, ?, ?, ?)')
    .run(id, name.trim().slice(0, 24), color?.trim() || 'accent', (row.max ?? -1) + 1)
  touchStmt.run(id)
  return c.json(db.prepare('SELECT id, name, color, position FROM list_tiers WHERE id = ?').get(res.lastInsertRowid), 201)
})

app.patch('/:id/tiers/:tierId', async (c) => {
  const { id, tierId } = c.req.param()
  const body = await c.req.json()
  const sets: string[] = []
  const args: unknown[] = []
  if (typeof body.name === 'string' && body.name.trim()) { sets.push('name = ?');  args.push(body.name.trim().slice(0, 24)) }
  if (typeof body.color === 'string' && body.color.trim()) { sets.push('color = ?'); args.push(body.color.trim()) }
  if (typeof body.position === 'number') { sets.push('position = ?'); args.push(body.position) }
  if (sets.length === 0) return c.json({ error: 'nothing to update' }, 400)

  const res = db.prepare(`UPDATE list_tiers SET ${sets.join(', ')} WHERE id = ? AND list_id = ?`).run(...args, tierId, id)
  if (res.changes === 0) return c.json({ error: 'Not found' }, 404)
  touchStmt.run(id)
  return c.json(db.prepare('SELECT id, name, color, position FROM list_tiers WHERE id = ?').get(tierId))
})

/** Reordena os tiers em lote (mover linha para cima/baixo). */
app.put('/:id/tiers/order', async (c) => {
  const id = c.req.param('id')
  const { tiers } = await c.req.json()
  if (!Array.isArray(tiers)) return c.json({ error: 'tiers must be an array' }, 400)
  const update = db.prepare('UPDATE list_tiers SET position = ? WHERE id = ? AND list_id = ?')
  db.transaction(() => {
    tiers.forEach((t: { id: number }, i: number) => update.run(i, t.id, id))
    touchStmt.run(id)
  })()
  return c.json(tiersStmt.all(id))
})

/** Apagar um tier devolve as capas dele para a bandeja "sem tier" (ON DELETE SET NULL). */
app.delete('/:id/tiers/:tierId', (c) => {
  const { id, tierId } = c.req.param()
  const res = db.prepare('DELETE FROM list_tiers WHERE id = ? AND list_id = ?').run(tierId, id)
  if (res.changes === 0) return c.json({ error: 'Not found' }, 404)
  touchStmt.run(id)
  return c.json({ ok: true })
})

export default app
