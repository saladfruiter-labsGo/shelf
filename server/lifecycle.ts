import type Database from 'better-sqlite3'
import type { ServerType } from '@hono/node-server'

export type StopBackgroundJob = () => void | Promise<void>

function closeServer(server: ServerType): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (!error || (error as NodeJS.ErrnoException).code === 'ERR_SERVER_NOT_RUNNING') resolve()
      else reject(error)
    })
  })
}

/**
 * Para novas conexões e novos jobs em paralelo, espera o trabalho corrente e
 * fecha o SQLite apenas depois do último usuário do banco ter terminado.
 */
export async function shutdownServices(options: {
  server: ServerType
  database: Database.Database
  stopBackgroundJobs: StopBackgroundJob[]
  timeoutMs?: number
}): Promise<void> {
  const timeoutMs = options.timeoutMs ?? 20_000
  let timedOut = false
  let timeout: NodeJS.Timeout | undefined

  const drained = Promise.all([
    closeServer(options.server),
    Promise.allSettled(options.stopBackgroundJobs.map(stop => Promise.resolve().then(stop))),
  ]).then(() => {
    // Se o chamador já desistiu, ele encerrará o processo sem voltar a tocar
    // num banco que pode estar em estado desconhecido.
    if (timedOut) return
    options.database.pragma('wal_checkpoint(TRUNCATE)')
    options.database.close()
  })

  const deadline = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => {
      timedOut = true
      reject(new Error(`Shutdown excedeu ${timeoutMs} ms.`))
    }, timeoutMs)
  })

  try {
    await Promise.race([drained, deadline])
  } finally {
    if (timeout) clearTimeout(timeout)
  }
}
