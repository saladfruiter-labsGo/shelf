import { Hono } from 'hono'
import { fetchShops } from '../../prices/providers/isthereanydeal.js'
import { syncBacklog, syncState } from '../../prices/sync.js'

const app = new Hono()

// Confere a chave pela chamada mais barata do provedor e valida a região ativa.
app.post('/itad/test', async (c) => {
  try {
    const shops = await fetchShops()
    if (shops.length === 0) {
      return c.json({ ok: false, error: 'Nenhuma loja ativa para o país configurado.' }, 400)
    }
    return c.json({ ok: true, shops: shops.length })
  } catch (error) {
    return c.json({ ok: false, error: (error as Error).message }, 400)
  }
})

app.post('/itad/sync', async (c) => {
  await syncBacklog()
  return c.json({ ok: true, sync: syncState() })
})

export default app
