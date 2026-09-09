import { Hono } from 'hono'
import * as prices from '../prices/service.js'
import * as repo from '../prices/repository.js'
import { itadEnabled } from '../prices/providers/isthereanydeal.js'
import { syncBacklog, syncState } from '../prices/sync.js'

const app = new Hono()

function mediaId(c: { req: { param: (k: string) => string } }): number | null {
  const id = parseInt(c.req.param('mediaItemId'))
  return Number.isFinite(id) ? id : null
}

/** Resumo de todos os jogos do backlog — uma chamada para alimentar os cards. */
app.get('/backlog', (c) => {
  return c.json({
    enabled: itadEnabled(),
    sync:    syncState(),
    items:   prices.backlogSummary(),
  })
})

/** Detalhe de um jogo: indicadores, gráfico, ofertas e dados da correspondência. */
app.get('/games/:mediaItemId', (c) => {
  const id = mediaId(c)
  if (id == null) return c.json({ error: 'id inválido' }, 400)
  return c.json(prices.gameDetails(id, c.req.query('range'), c.req.query('shop')))
})

/** Atualização manual, com cooldown para impedir chamadas repetidas. */
app.post('/games/:mediaItemId/refresh', async (c) => {
  const id = mediaId(c)
  if (id == null) return c.json({ error: 'id inválido' }, 400)
  const r = await prices.refreshGame(id)
  if (r.ok) return c.json(r)
  // 429 é só para o cooldown; falha do provedor é erro de gateway.
  return r.retry_in != null
    ? c.json({ error: r.error, retry_in: r.retry_in }, 429)
    : c.json({ error: r.error }, 502)
})

/** Candidatos para uma correção manual da correspondência. */
app.get('/games/:mediaItemId/matches', async (c) => {
  const id = mediaId(c)
  if (id == null) return c.json({ error: 'id inválido' }, 400)
  try {
    return c.json(await prices.searchMatches(id, c.req.query('q') ?? ''))
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502)
  }
})

/** Confirma, troca ou desassocia o produto correspondente. */
app.patch('/games/:mediaItemId/match', async (c) => {
  const id = mediaId(c)
  if (id == null) return c.json({ error: 'id inválido' }, 400)

  const body = (await c.req.json().catch(() => ({}))) as { provider_game_id?: unknown; title?: unknown; clear?: unknown }
  const providerId = body.clear === true ? null
    : typeof body.provider_game_id === 'string' && body.provider_game_id.trim() ? body.provider_game_id.trim()
    : undefined
  if (providerId === undefined) return c.json({ error: 'provider_game_id obrigatório' }, 400)

  try {
    return c.json(await prices.setManualMatch(id, providerId, typeof body.title === 'string' ? body.title : null))
  } catch (e) {
    return c.json({ error: (e as Error).message }, 502)
  }
})

/** Dispara um ciclo completo de sincronização do backlog. */
app.post('/sync', async (c) => {
  if (!itadEnabled()) return c.json({ error: 'Integração de preços desativada ou sem chave de API.' }, 400)
  await syncBacklog()
  return c.json({ ok: true, sync: syncState(), tracked: repo.backlogGames().length })
})

export default app
