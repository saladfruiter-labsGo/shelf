import { Hono } from 'hono'
import { cfg } from '../../integrations/config.js'
import * as steamClient from '../../steam/client.js'
import { syncSteamBacklog } from '../../steam/sync.js'
import { lastDiagnostic, startSteamDiagnostic } from '../../steam/diagnostic.js'
import { syncSteamLibrary } from '../../steam/library.js'
import { syncSteamAchievements } from '../../steam/achievements.js'
import { refreshSteamCovers } from '../../steam/covers.js'

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

/**
 * Diagnóstico só de leitura da conta conectada (biblioteca, conquistas e quanto
 * do "zerado" sairia automático). Roda em segundo plano; o GET acompanha.
 */
app.post('/steam/diagnostic', (c) => {
  if (!cfg('STEAM_ID')) return c.json({ error: 'Entre com a Steam antes de diagnosticar.' }, 400)
  if (!cfg('STEAM_API_KEY')) return c.json({ error: 'Cole a Web API Key da Steam antes de diagnosticar.' }, 400)
  const { started, diagnostic } = startSteamDiagnostic()
  return c.json(diagnostic, started ? 202 : 200)
})

app.get('/steam/diagnostic', (c) => c.json(lastDiagnostic()))

/** Lê a biblioteca da Steam agora, sem esperar a próxima rodada de 30 min. */
app.post('/steam/library/sync', async (c) => {
  if (!cfg('STEAM_ID')) return c.json({ error: 'Entre com a Steam antes de sincronizar a biblioteca.' }, 400)
  if (!cfg('STEAM_API_KEY')) return c.json({ error: 'Cole a Web API Key da Steam antes de sincronizar a biblioteca.' }, 400)
  const library = await syncSteamLibrary()
  // As conquistas seguem em segundo plano; o resultado aparece no card.
  refreshSteamCovers().then(() => syncSteamAchievements()).catch(() => {})
  return c.json(library)
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
