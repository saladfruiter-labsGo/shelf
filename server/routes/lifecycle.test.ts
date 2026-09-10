import test from 'node:test'
import assert from 'node:assert/strict'
import type { ServerType } from '@hono/node-server'
import type Database from 'better-sqlite3'
import { shutdownServices } from '../lifecycle.js'

test('shutdown espera servidor e jobs antes de checkpoint e close', async () => {
  const events: string[] = []
  const server = {
    close(callback: (error?: Error) => void) {
      events.push('server:stop')
      setTimeout(() => { events.push('server:drained'); callback() }, 5)
      return this
    },
  } as unknown as ServerType
  const database = {
    pragma(value: string) { events.push(`db:${value}`) },
    close() { events.push('db:close') },
  } as unknown as Database.Database

  await shutdownServices({
    server,
    database,
    stopBackgroundJobs: [async () => {
      events.push('jobs:stop')
      await new Promise(resolve => setTimeout(resolve, 10))
      events.push('jobs:drained')
    }],
    timeoutMs: 100,
  })

  assert.deepEqual(events, [
    'server:stop', 'jobs:stop', 'server:drained', 'jobs:drained',
    'db:wal_checkpoint(TRUNCATE)', 'db:close',
  ])
})

test('timeout não fecha o banco enquanto ainda há usuários ativos', async () => {
  let databaseTouched = false
  const server = { close() { return this } } as unknown as ServerType
  const database = {
    pragma() { databaseTouched = true },
    close() { databaseTouched = true },
  } as unknown as Database.Database

  await assert.rejects(
    shutdownServices({ server, database, stopBackgroundJobs: [], timeoutMs: 5 }),
    /excedeu 5 ms/,
  )
  assert.equal(databaseTouched, false)
})
