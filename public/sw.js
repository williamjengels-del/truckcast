const CACHE_NAME = 'truckcast-v3';
const STATIC_ASSETS = ['/manifest.json'];

self.addEventListener('install', (event) => {
  // Take control immediately without waiting for old SW to release
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('activate', (event) => {
  // Delete all old caches on activation
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  // Never cache JS/CSS chunks — always fetch fresh from network
  const url = new URL(event.request.url);
  if (
    url.pathname.startsWith('/_next/') ||
    url.pathname === '/' ||
    url.pathname.startsWith('/dashboard')
  ) {
    // Network-first for app shell and Next.js chunks
    event.respondWith(fetch(event.request).catch(() => caches.match(event.request)));
    return;
  }

  // Don't intercept navigation requests
  if (event.request.mode === 'navigate') return;

  // Cache-first for static assets like manifest, icons
  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});
