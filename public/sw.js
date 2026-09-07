/* Shelved. service worker — app-shell + runtime caching */
const VERSION = 'shelved-v1'
const SHELL = `${VERSION}-shell`
const RUNTIME = `${VERSION}-runtime`
const API = `${VERSION}-api`

const SHELL_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-192.png',
  '/pwa-512.png',
  '/apple-touch-icon.png',
]

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((cache) => cache.addAll(SHELL_ASSETS)).then(() => self.skipWaiting())
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

self.addEventListener('message', (event) => {
  if (event.data === 'SKIP_WAITING') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  const sameOrigin = url.origin === self.location.origin

  // SPA navigations → network-first, fall back to cached shell (offline boot)
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(SHELL).then((c) => c.put('/index.html', copy))
          return res
        })
        .catch(() => caches.match('/index.html').then((r) => r || caches.match('/')))
    )
    return
  }

  // API → network-first, cache fallback when offline
  if (sameOrigin && url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(request)
        .then((res) => {
          const copy = res.clone()
          caches.open(API).then((c) => c.put(request, copy))
          return res
        })
        .catch(() => caches.match(request))
    )
    return
  }

  // Same-origin static assets → stale-while-revalidate
  if (sameOrigin) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            if (res && res.status === 200) {
              const copy = res.clone()
              caches.open(RUNTIME).then((c) => c.put(request, copy))
            }
            return res
          })
          .catch(() => cached)
        return cached || network
      })
    )
    return
  }

  // Cross-origin (fonts, poster images) → cache-first with runtime fill
  event.respondWith(
    caches.match(request).then((cached) => {
      if (cached) return cached
      return fetch(request)
        .then((res) => {
          if (res && (res.status === 200 || res.type === 'opaque')) {
            const copy = res.clone()
            caches.open(RUNTIME).then((c) => c.put(request, copy))
          }
          return res
        })
        .catch(() => cached)
    })
  )
})
