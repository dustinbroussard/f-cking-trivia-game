const CACHE_NAME = 'aftg-cache-v2';

const PRECACHE_ASSETS = [
  './',
  'index.html',
  'manifest.webmanifest',
  'icon-192.png',
  'icon-512.png',
  'logo.jpg',
  'theme.mp3',
  'welcome.mp3',
  'correct.mp3',
  'wrong.mp3',
  'won.mp3',
  'lost.mp3'
];

self.addEventListener('install', event => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        return cache.addAll(PRECACHE_ASSETS);
      })
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames
          .filter(name => name !== CACHE_NAME)
          .map(name => caches.delete(name))
      );
    })
  );
});

self.addEventListener('fetch', event => {
  // Skip cross-origin requests
  if (!event.request.url.startsWith(self.location.origin)) {
    return;
  }
  
  // Skip API/Firestore requests
  if (event.request.url.includes('firestore') || event.request.url.includes('identitytoolkit')) {
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(cachedResponse => {
        // Cache-first strategy
        if (cachedResponse) {
          // Stale-while-revalidate for html/scripts
          if (event.request.destination === 'document' || event.request.destination === 'script') {
            const fetchPromise = fetch(event.request).then(networkResponse => {
              caches.open(CACHE_NAME).then(cache => {
                cache.put(event.request, networkResponse.clone());
              });
              return networkResponse;
            }).catch(() => cachedResponse);
            return cachedResponse || fetchPromise;
          }
          return cachedResponse;
        }

        // Network fallbacks
        return fetch(event.request).then(response => {
          if (!response || response.status !== 200 || response.type !== 'basic') {
            return response;
          }
          const responseToCache = response.clone();
          caches.open(CACHE_NAME)
            .then(cache => {
              cache.put(event.request, responseToCache);
            });
          return response;
        });
      })
  );
});
