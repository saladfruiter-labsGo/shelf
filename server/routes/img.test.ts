import test from 'node:test'
import assert from 'node:assert/strict'
import app, { allowedImageUrl } from './img.js'

test('allowlist aceita provedores conhecidos e recusa rede interna, HTTP e porta customizada', () => {
  assert.equal(allowedImageUrl('https://image.tmdb.org/t/p/w500/a.jpg')?.hostname, 'image.tmdb.org')
  assert.equal(allowedImageUrl('http://image.tmdb.org/a.jpg'), null)
  assert.equal(allowedImageUrl('https://127.0.0.1/admin'), null)
  assert.equal(allowedImageUrl('https://image.tmdb.org:8443/a.jpg'), null)
  assert.equal(allowedImageUrl('https://user:pass@image.tmdb.org/a.jpg'), null)
})

test('host extra precisa ser explicitamente configurado', () => {
  const previous = process.env.IMG_PROXY_ALLOWED_HOSTS
  try {
    process.env.IMG_PROXY_ALLOWED_HOSTS = 'covers.example.test'
    assert.equal(allowedImageUrl('https://covers.example.test/a.jpg')?.hostname, 'covers.example.test')
    assert.equal(allowedImageUrl('https://sub.covers.example.test/a.jpg'), null)
  } finally {
    if (previous === undefined) delete process.env.IMG_PROXY_ALLOWED_HOSTS
    else process.env.IMG_PROXY_ALLOWED_HOSTS = previous
  }
})

test('proxy não chama fetch para host bloqueado', async () => {
  const original = globalThis.fetch
  let called = false
  globalThis.fetch = async () => { called = true; throw new Error('não deveria chamar') }
  try {
    const response = await app.request('/?url=' + encodeURIComponent('http://127.0.0.1:3000/api/settings'))
    assert.equal(response.status, 403)
    assert.equal(called, false)
  } finally {
    globalThis.fetch = original
  }
})

test('proxy revalida redirects e exige resposta de imagem', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(null, {
      status: 302,
      headers: { Location: 'http://192.168.0.1/admin' },
    })
    const redirected = await app.request('/?url=' + encodeURIComponent('https://image.tmdb.org/a.jpg'))
    assert.equal(redirected.status, 403)

    globalThis.fetch = async () => new Response('não é imagem', { headers: { 'Content-Type': 'text/html' } })
    const wrongType = await app.request('/?url=' + encodeURIComponent('https://image.tmdb.org/a.jpg'))
    assert.equal(wrongType.status, 415)

    globalThis.fetch = async () => new Response('<svg/>', { headers: { 'Content-Type': 'image/svg+xml' } })
    const svg = await app.request('/?url=' + encodeURIComponent('https://image.tmdb.org/a.svg'))
    assert.equal(svg.status, 415)
  } finally {
    globalThis.fetch = original
  }
})

test('proxy preserva imagem válida e impede corpo acima de 10 MB', async () => {
  const original = globalThis.fetch
  try {
    globalThis.fetch = async () => new Response(new Uint8Array([1, 2, 3]), {
      headers: { 'Content-Type': 'image/png' },
    })
    const ok = await app.request('/?url=' + encodeURIComponent('https://image.tmdb.org/a.png'))
    assert.equal(ok.status, 200)
    assert.equal(ok.headers.get('access-control-allow-origin'), null)
    assert.deepEqual(new Uint8Array(await ok.arrayBuffer()), new Uint8Array([1, 2, 3]))

    globalThis.fetch = async () => new Response(null, {
      headers: { 'Content-Type': 'image/jpeg', 'Content-Length': String(10 * 1024 * 1024 + 1) },
    })
    const tooLarge = await app.request('/?url=' + encodeURIComponent('https://image.tmdb.org/a.jpg'))
    assert.equal(tooLarge.status, 502)
  } finally {
    globalThis.fetch = original
  }
})
