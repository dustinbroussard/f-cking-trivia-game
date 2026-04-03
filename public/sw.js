const CACHE_NAME = 'aftg-cache-v5';
const APP_SHELL = 'index.html';

const PRECACHE_ASSETS = [
  './',
  APP_SHELL,
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'logo.png',
  'theme.mp3',
  'theme1.mp3',
  'theme2.mp3',
  'welcome1.mp3',
  'welcome2.mp3',
  'correct.mp3',
  'wrong.mp3',
  'times-up.mp3',
  'won.mp3',
  'lost.mp3',
  'spin.mp3',
];

function shouldCacheResponse(request, response) {
  return (
    request.method === 'GET' &&
    !request.headers.has('range') &&
    response &&
    response.ok &&
    response.status !== 206 &&
    response.status === 200 &&
    response.type === 'basic' &&
    response.type !== 'opaque' &&
    response.type !== 'opaqueredirect' &&
    response.type !== 'error'
  );
}

async function putInCache(request, response) {
  if (!shouldCacheResponse(request, response)) {
    return;
  }

  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(request, response);
  } catch (error) {
    console.warn('[sw] cache.put skipped:', request.url, error);
  }
}

async function precacheAssets() {
  const cache = await caches.open(CACHE_NAME);

  await Promise.allSettled(
    PRECACHE_ASSETS.map(async (assetPath) => {
      try {
        await cache.add(assetPath);
      } catch (error) {
        console.warn('[sw] precache failed:', assetPath, error);
      }
    })
  );
}

async function cacheFirst(request) {
  const cachedResponse = await caches.match(request);
  if (cachedResponse) {
    return cachedResponse;
  }

  const response = await fetch(request);
  const cacheResponse = shouldCacheResponse(request, response) ? response.clone() : null;
  if (cacheResponse) {
    await putInCache(request, cacheResponse);
  }
  return response;
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE_NAME);
  const cachedResponse = await cache.match(request);
  const networkPromise = fetch(request)
    .then((networkResponse) => {
      const cacheResponse = shouldCacheResponse(request, networkResponse) ? networkResponse.clone() : null;
      if (cacheResponse) {
        void putInCache(request, cacheResponse);
      }
      return networkResponse;
    })
    .catch(() => cachedResponse);

  return cachedResponse || networkPromise;
}

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(precacheAssets());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => Promise.all(
      cacheNames
        .filter((name) => name !== CACHE_NAME)
        .map((name) => caches.delete(name))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') {
    return;
  }

  if (event.request.headers.has('range')) {
    return;
  }

  const requestUrl = new URL(event.request.url);

  if (requestUrl.origin !== self.location.origin) {
    return;
  }

  if (requestUrl.pathname.startsWith('/api/')) {
    return;
  }

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(async () => {
        const cache = await caches.open(CACHE_NAME);
        return cache.match(APP_SHELL);
      })
    );
    return;
  }

  if (['script', 'style', 'worker'].includes(event.request.destination)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  if (['image', 'font', 'audio', 'video'].includes(event.request.destination)) {
    event.respondWith(cacheFirst(event.request));
    return;
  }

  event.respondWith(staleWhileRevalidate(event.request));
});
