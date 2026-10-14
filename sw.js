// Bump this name whenever the deployed shell changes.  Otherwise an installed
// phone app can retain an old index.html that points at an asset removed by a
// later deployment, leaving the screen blank.
const CACHE_NAME = 'quange-os-v76-income-categories-1'
const APP_SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-v3.svg',
  './icon-v3-180.png',
  './icon-v3-192.png',
  './icon-v3-512.png',
  './icon-v3-1024.png'
]

function scopedUrl(path) {
  return new URL(path, self.registration.scope).toString()
}

async function cacheResponse(cache, requestUrl) {
  const response = await fetch(requestUrl, { cache: 'no-store' })
  if (response.ok) await cache.put(requestUrl, response.clone())
  return response
}

async function precacheAppShell() {
  const cache = await caches.open(CACHE_NAME)
  const shellUrls = APP_SHELL.map(scopedUrl)
  await Promise.allSettled(shellUrls.map((url) => cacheResponse(cache, url)))

  const indexUrl = scopedUrl('./index.html')
  const index = await cache.match(indexUrl)
  if (!index) return
  const html = await index.text()
  const assets = [...html.matchAll(/(?:src|href)="([^"]+)"/g)]
    .map((match) => new URL(match[1], indexUrl).toString())
    .filter((url) => url.startsWith(self.registration.scope) && /\/assets\//.test(url))
  await Promise.allSettled(assets.map((url) => cacheResponse(cache, url)))
}

self.addEventListener('install', (event) => {
  event.waitUntil(precacheAppShell())
  self.skipWaiting()
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET') return
  const url = new URL(request.url)
  if (url.origin !== self.location.origin || !url.pathname.startsWith(new URL(self.registration.scope).pathname)) return

  event.respondWith((async () => {
    // 页面导航优先拿新版本，断网时回退到已缓存的完整应用壳。
    if (request.mode === 'navigate') {
      try {
        // HTML must not come from the browser HTTP cache: it selects the
        // fingerprinted JS/CSS assets for the current release.
        const response = await fetch(request, { cache: 'no-store' })
        if (response.ok) event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())))
        return response
      } catch {
        return (await caches.match(request, { ignoreVary: true })) ?? caches.match(scopedUrl('./index.html'))
      }
    }

    // JS、CSS、图标等静态资源优先使用缓存，避免断网时等待网络超时。
    const cached = await caches.match(request, { ignoreVary: true })
    if (cached) return cached
    try {
      const response = await fetch(request)
      if (response.ok) event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone())))
      return response
    } catch {
      return new Response('离线状态下暂时无法读取这个资源。', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } })
    }
  })())
})
