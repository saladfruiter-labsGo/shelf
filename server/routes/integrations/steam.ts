import { Hono } from 'hono'
import { cfg } from '../../integrations/config.js'
import * as steamClient from '../../steam/client.js'
import { syncSteamBacklog } from '../../steam/sync.js'

const app = new Hono()

// Testa leitura da wishlist/biblioteca e informa se a escrita por cookie está disponível.
app.post('/steam/test', async (c) => {
  try {
    const steamid = cfg('STEAM_ID')
    if (!steamid) {
      return c.json({ ok: false, error: 'Informe o SteamID (ou o link do perfil) e salve.' }, 400)
    }

    const wishlist = await steamClient.fetchWishlist()
    let owned: number | null = null
    if (cfg('STEAM_API_KEY')) {
      owned = (await steamClient.fetchOwnedGames().catch(() => [])).length || null
    }
    return c.json({ ok: true, wishlist: wishlist.length, owned, can_write: steamClient.steamCanWrite() })
  } catch (error) {
    return c.json({ ok: false, error: (error as Error).message }, 400)
  }
})

app.post('/steam/sync', async (c) => {
  const result = await syncSteamBacklog()
  return c.json(result)
})

/** Converte um link de perfil ou vanity em SteamID64. */
app.post('/steam/resolve', async (c) => {
  const body = (await c.req.json().catch(() => ({}))) as { input?: string }
  try {
    const id = await steamClient.normalizeSteamId(body.input ?? '')
    if (!id) {
      return c.json({
        ok: false,
        error: 'Não consegui resolver esse perfil. Cole o SteamID64 (17 dígitos) ou configure a API key.',
      }, 400)
    }
    return c.json({ ok: true, steam_id: id })
  } catch (error) {
    return c.json({ ok: false, error: (error as Error).message }, 400)
  }
})

export default app
