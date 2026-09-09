/**
 * Sincronização automática dos preços do backlog.
 *
 * Só jogos com `type = 'game'` e `status = 'wishlist'` são consultados. Sair do
 * backlog apenas interrompe as consultas — ofertas e histórico continuam no
 * banco, e voltar ao backlog retoma o acompanhamento de onde parou.
 */
import * as itad from './providers/isthereanydeal.js'
import * as repo from './repository.js'
import { resolveMatch } from './matcher.js'
import { applyPrices } from './service.js'

const FIRST_RUN_DELAY_MS = 30_000
const INTERVAL_MS        = 6 * 3_600_000
const BATCH_SIZE         = 200
/** Pausa entre resoluções para não estourar o limite do provedor. */
const RESOLVE_GAP_MS     = 250

let running = false
let scheduled = false
let timer: NodeJS.Timeout | null = null
let lastRun: { at: string; ok: number; failed: number; error: string | null } | null = null

export function syncState() {
  return { running, last_run: lastRun }
}

/**
 * Um ciclo completo. Nunca lança: falhas viram `last_error` por produto e o
 * último preço conhecido é preservado.
 */
export async function syncBacklog(): Promise<void> {
  if (running) return
  if (!itad.itadEnabled()) return
  running = true

  let ok = 0, failed = 0
  let fatal: string | null = null
  let retryAfter: number | null = null

  try {
    const games = repo.backlogGames()

    // 1. Correspondência dos jogos ainda não resolvidos.
    for (const g of games) {
      const p = repo.ensureProduct(g.id)
      if (p.match_status === 'resolved' || p.match_status === 'ambiguous') continue
      if (p.match_method === 'manual') continue
      try {
        const m = await resolveMatch(g)
        repo.saveMatch(p.id, m)
        if (m.match_status === 'resolved' && m.provider_game_id) {
          const since = new Date(Date.now() - 365 * 86_400_000).toISOString()
          repo.importHistory(p.id, await itad.fetchHistory(m.provider_game_id, since))
        }
      } catch (e) {
        failed++
        const err = e as itad.ItadError
        repo.saveError(p.id, err.message)
        if (err instanceof itad.ItadError && err.status === 429) {
          retryAfter = err.retryAfter ?? 60
          fatal = err.message
          break
        }
      }
      await new Promise(r => setTimeout(r, RESOLVE_GAP_MS))
    }

    // 2. Preços em lote — só o que está resolvido entra na consulta.
    if (!fatal) {
      const targets: { productId: number; providerId: string }[] = []
      for (const g of games) {
        const p = repo.getProduct(g.id)
        if (p?.match_status === 'resolved' && p.provider_game_id) {
          targets.push({ productId: p.id, providerId: p.provider_game_id })
        }
      }

      for (let i = 0; i < targets.length; i += BATCH_SIZE) {
        const batch = targets.slice(i, i + BATCH_SIZE)
        try {
          const prices = await itad.fetchPrices(batch.map(t => t.providerId))
          const byId = new Map(prices.map(p => [p.provider_game_id, p]))
          for (const t of batch) {
            const p = byId.get(t.providerId)
            if (p) { applyPrices(t.productId, p); ok++ }
            else   { repo.saveError(t.productId, 'Provedor não retornou preços para este jogo'); failed++ }
          }
        } catch (e) {
          failed += batch.length
          const err = e as itad.ItadError
          for (const t of batch) repo.saveError(t.productId, err.message)
          if (err instanceof itad.ItadError && err.status === 429) {
            retryAfter = err.retryAfter ?? 60
            fatal = err.message
            break
          }
        }
      }
    }
  } catch (e) {
    fatal = (e as Error).message
  } finally {
    running = false
    lastRun = { at: new Date().toISOString(), ok, failed, error: fatal }
  }

  // Rate limit: reagenda respeitando o Retry-After em vez de insistir agora.
  if (scheduled) {
    schedule(retryAfter != null ? Math.min(retryAfter * 1000 + 1000, INTERVAL_MS) : INTERVAL_MS)
  }
}

function schedule(delayMs: number) {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => { syncBacklog().catch(() => {}) }, delayMs)
  timer.unref?.()
}

/** Liga o agendamento: primeira passada logo após o boot, depois a cada 6 h. */
export function startPriceSync() {
  scheduled = true
  schedule(FIRST_RUN_DELAY_MS)
}
