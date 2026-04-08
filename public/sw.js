const CACHE_NAME = 'truckcast-v1';
const STATIC_ASSETS = ['/', '/dashboard', '/manifest.json'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
});

self.addEventListener('fetch', (event) => {
  // Don't intercept navigation requests — Safari rejects service worker responses
  // that contain redirects (e.g. auth callbacks), causing "Response served by
  // service worker has redirections" errors.
  if (event.request.mode === 'navigate') return;

  event.respondWith(
    caches.match(event.request).then((response) => response || fetch(event.request))
  );
});
