// Only the public application shell is cached. Account data lives in IndexedDB.
const VERSION = 'dev-v6';
const DEVELOPMENT = ['localhost', '127.0.0.1'].includes(self.location.hostname);
const SCOPE = new URL(self.registration.scope).pathname;
const CACHE_PREFIX = `zk-shell:${SCOPE}:`;
const CACHE = `${CACHE_PREFIX}${VERSION}`;
const FILES = ['index.html', 'styles.css', 'app.js', 'config.js', 'icon.svg', 'manifest.webmanifest', 'lib/model.js', 'lib/wedding-template.js', 'lib/storage.js', 'lib/api.js', 'lib/task-import.js', 'lib/rich-text.js', 'lib/change-history.js', 'vendor/xlsx-0.20.3.mjs', 'vendor/SHEETJS-LICENSE.txt'];
const PATHS = new Set(FILES.map(file => new URL(file, self.registration.scope).pathname));

async function publicShell(request, cacheKey) {
  const cache = await caches.open(CACHE);
  let response;
  if (DEVELOPMENT) {
    try {
      response = await fetch(request, { cache: 'no-store' });
      if (response.ok) {
        // Save only the clean public-file key, including for an OAuth callback navigation.
        await cache.put(cacheKey, response.clone()).catch(() => {});
        return response;
      }
    } catch { /* The previously loaded public shell remains available offline. */ }
  }
  const cached = await cache.match(cacheKey);
  return cached || response || fetch(request);
}

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES.map(file => new Request(new URL(file, self.registration.scope), { cache: 'reload' })))));
  // A new worker waits until existing tabs close; never reload a page with unsaved edits.
});
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(key => key.startsWith(CACHE_PREFIX) && key !== CACHE).map(key => caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('message', event => {
  if (event.data?.type === 'ACTIVATE_UPDATE') event.waitUntil(self.skipWaiting());
  if (event.data?.type === 'CACHE_STATUS') event.ports?.[0]?.postMessage({ cache: CACHE, version: VERSION });
});
self.addEventListener('fetch', event => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || request.headers.has('Authorization')) return;
  // Auth callbacks must reach the app; never put their code/query into the cache.
  const navigation = request.mode === 'navigate' && (url.pathname === SCOPE || url.pathname === `${SCOPE}index.html`);
  if (navigation) {
    event.respondWith(publicShell(request, new URL('index.html', self.registration.scope)));
    return;
  }
  // No APIs, private data, query-bearing requests or unrelated files.
  if (url.search || !PATHS.has(url.pathname)) return;
  event.respondWith(publicShell(request, request));
});
