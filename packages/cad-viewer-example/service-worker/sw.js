/*
 * Service worker of the online viewer (template).
 *
 * scripts/self-host.mjs writes it to dist/sw.js after `vite build`, replacing
 * the two placeholders below with the build version and the precache
 * manifest: [path relative to the app root, content hash, size in bytes] for
 * every file in dist/ except the offline download (dist/offline/).
 *
 * - install: downloads every manifest file into a versioned cache (reusing
 *   unchanged files from the previous version's cache) and reports progress
 *   to the pages with `{ type: 'cad-precache', ... }` messages.
 * - activate: deletes caches of other versions and claims the open pages.
 * - fetch: the app page (navigation) is network-first with a timeout and the
 *   cached index.html as fallback; every other same-origin GET/HEAD is
 *   served from the caches first, then from the network. dist/offline/ and
 *   other origins are never intercepted.
 * - updates: the first version activates right away. Later versions wait
 *   (the open page keeps the assets of its own build) until the old pages are
 *   gone, or until the only open page already runs the new build.
 */
'use strict'

const VERSION = self.__CAD_PRECACHE_VERSION__
const MANIFEST = self.__CAD_PRECACHE_MANIFEST__

const CACHE_PREFIX = 'cad-viewer-precache-'
const CACHE_NAME = CACHE_PREFIX + VERSION
const REVISION_HEADER = 'x-cad-precache-revision'
const NAVIGATION_TIMEOUT_MS = 5000
const CONCURRENCY = 4

const SCOPE_URL = new URL('./', self.location.href)
const INDEX_URL = new URL('index.html', SCOPE_URL).href
const OFFLINE_DOWNLOAD_PATH = new URL('offline/', SCOPE_URL).pathname

/** Decoded path → { url, revision, size } for every precached file. */
const ENTRIES = new Map(
  MANIFEST.map(([path, revision, size]) => {
    const url = new URL(path, SCOPE_URL)
    return [decodeURIComponent(url.pathname), { url: url.href, revision, size }]
  })
)
const TOTAL_BYTES = MANIFEST.reduce((sum, entry) => sum + entry[2], 0)

let progress = { state: 'idle', done: 0, bytes: 0 }

function status() {
  // Install always runs to completion in the worker's first lifetime; a
  // restarted (installed or active) worker therefore has everything cached.
  const state = progress.state === 'idle' ? 'ready' : progress.state
  return {
    type: 'cad-precache',
    version: VERSION,
    state,
    total: MANIFEST.length,
    totalBytes: TOTAL_BYTES,
    done: state === 'ready' ? MANIFEST.length : progress.done,
    bytes: state === 'ready' ? TOTAL_BYTES : progress.bytes,
    error: progress.error
  }
}

async function broadcast() {
  const pages = await self.clients.matchAll({
    type: 'window',
    includeUncontrolled: true
  })
  const message = status()
  for (const page of pages) page.postMessage(message)
}

let lastBroadcast = 0
function reportProgress() {
  const now = Date.now()
  if (now - lastBroadcast > 500) {
    lastBroadcast = now
    void broadcast()
  }
}

/** Cached response of `url` with `revision` in any of our caches. */
async function findRevision(url, revision) {
  for (const name of await caches.keys()) {
    if (!name.startsWith(CACHE_PREFIX)) continue
    const response = await (await caches.open(name)).match(url)
    if (response && response.headers.get(REVISION_HEADER) === revision) {
      return response
    }
  }
  return undefined
}

async function download(entry) {
  const response = await fetch(entry.url, { cache: 'no-cache' })
  if (!response.ok) {
    throw new Error(`${entry.url}: HTTP ${response.status}`)
  }
  const headers = new Headers(response.headers)
  headers.set(REVISION_HEADER, entry.revision)
  const body = await response.arrayBuffer()
  return new Response(body, {
    status: response.status,
    statusText: response.statusText,
    headers
  })
}

async function precache() {
  progress = { state: 'installing', done: 0, bytes: 0 }
  void broadcast()
  const cache = await caches.open(CACHE_NAME)
  const queue = [...ENTRIES.values()]
  const worker = async () => {
    while (queue.length > 0) {
      const entry = queue.shift()
      const current = await cache.match(entry.url)
      if (current?.headers.get(REVISION_HEADER) !== entry.revision) {
        const response =
          (await findRevision(entry.url, entry.revision)) ??
          (await download(entry))
        await cache.put(entry.url, response)
      }
      progress.done += 1
      progress.bytes += entry.size
      reportProgress()
    }
  }
  try {
    await Promise.all(Array.from({ length: CONCURRENCY }, worker))
    progress.state = 'ready'
  } catch (error) {
    progress.state = 'error'
    progress.error = String(error?.message ?? error)
    throw error
  } finally {
    await broadcast()
  }
}

self.addEventListener('install', event => {
  event.waitUntil(
    precache().then(() => {
      // First install: nothing to keep consistent, take over right away.
      if (!self.registration.active) return self.skipWaiting()
    })
  )
})

self.addEventListener('activate', event => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        if (name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME) {
          await caches.delete(name)
        }
      }
      await self.clients.claim()
      await broadcast()
    })()
  )
})

self.addEventListener('message', event => {
  const data = event.data ?? {}
  if (data.type === 'cad-precache-status') {
    event.source?.postMessage(status())
  } else if (data.type === 'cad-precache-activate') {
    // Sent by a page whose entry script belongs to this (waiting) version.
    event.waitUntil(
      (async () => {
        const pages = await self.clients.matchAll({ type: 'window' })
        const entry = decodeURIComponent(
          new URL(String(data.entry), SCOPE_URL).pathname
        )
        if (pages.length <= 1 && ENTRIES.has(entry)) {
          await self.skipWaiting()
        }
      })()
    )
  }
})

/** First cached copy of `url` (own cache first, then other versions). */
async function fromCache(url) {
  const own = await (await caches.open(CACHE_NAME)).match(url)
  return own ?? (await caches.match(url))
}

function headersOnly(response) {
  return new Response(null, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers
  })
}

async function cacheFirst(request) {
  const url = new URL(request.url)
  const entry = ENTRIES.get(decodeURIComponent(url.pathname))
  const cached = await fromCache(entry && !url.search ? entry.url : url.href)
  if (cached) {
    return request.method === 'HEAD' ? headersOnly(cached) : cached
  }
  return fetch(request)
}

async function networkFirst(request) {
  if (self.navigator.onLine !== false) {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), NAVIGATION_TIMEOUT_MS)
    try {
      const response = await fetch(request, { signal: controller.signal })
      if (response.ok) return response
    } catch {
      // offline, timed out or blocked: fall back to the cached app shell
    } finally {
      clearTimeout(timer)
    }
  }
  return (await fromCache(INDEX_URL)) ?? fetch(request)
}

self.addEventListener('fetch', event => {
  const request = event.request
  if (request.method !== 'GET' && request.method !== 'HEAD') return
  const url = new URL(request.url)
  if (url.origin !== SCOPE_URL.origin) return
  if (url.pathname.startsWith(OFFLINE_DOWNLOAD_PATH)) return
  if (url.pathname === new URL(self.location.href).pathname) return
  const page = url.origin + url.pathname
  const isAppPage = page === SCOPE_URL.href || page === INDEX_URL
  event.respondWith(
    request.mode === 'navigate' && isAppPage
      ? networkFirst(request)
      : cacheFirst(request)
  )
})
