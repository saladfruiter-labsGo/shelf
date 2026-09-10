import test from 'node:test'
import assert from 'node:assert/strict'
import { Hono } from 'hono'
import {
  API_BODY_LIMIT, limitedApiBody, noStoreDynamicApi, sameOriginApi, shelfSecurityHeaders,
} from '../security.js'

function securedApp(): Hono {
  const app = new Hono()
  app.use('*', shelfSecurityHeaders)
  app.use('/api/*', sameOriginApi)
  app.use('/api/*', limitedApiBody)
  app.use('/api/*', noStoreDynamicApi)
  app.get('/api/value', c => c.json({ ok: true }))
  app.post('/api/value', c => c.json({ ok: true }))
  return app
}

test('API aceita mesma origem e clientes sem Origin, mas bloqueia navegador externo', async () => {
  const app = securedApp()
  assert.equal((await app.request('http://shelf.test/api/value')).status, 200)
  assert.equal((await app.request('http://shelf.test/api/value', { headers: { Origin: 'http://shelf.test' } })).status, 200)
  assert.equal((await app.request('http://shelf.test/api/value', { headers: { Origin: 'https://evil.test' } })).status, 403)
  assert.equal((await app.request('http://shelf.test/api/value', { headers: { 'Sec-Fetch-Site': 'cross-site' } })).status, 403)
})

test('API limita corpo e marca respostas dinâmicas como no-store', async () => {
  const app = securedApp()
  const normal = await app.request('http://shelf.test/api/value')
  assert.equal(normal.headers.get('cache-control'), 'no-store')

  const oversized = await app.request('http://shelf.test/api/value', {
    method: 'POST',
    headers: { 'Content-Length': String(API_BODY_LIMIT + 1) },
    body: 'x',
  })
  assert.equal(oversized.status, 413)
})

test('respostas recebem cabeçalhos defensivos', async () => {
  const response = await securedApp().request('http://shelf.test/api/value')
  assert.equal(response.headers.get('x-frame-options'), 'DENY')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.match(response.headers.get('permissions-policy') ?? '', /camera=\(\)/)
})
