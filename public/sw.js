// VendCast service worker — Phase 8.1.
//
// Strategy:
//   - Precache the app shell (offline page, manifest, icons) on install.
//   - Navigation requests: network-first, fall back to /offline.html on failure.
//   - Next.js static assets under /_next/static/: cache-first (they're
//     immutable once built, so stale is impossible by construction).
//   - Everything else (API routes, Supabase, auth, etc.): bypass the SW
//     and go straight to network. We never want to serve stale JSON.
//
// Bump CACHE_VERSION to invalidate and rebuild all caches after structural
// changes to the shell. Browsers install a new SW whenever /sw.js bytes
// change, so bumping the version alone triggers the whole install+activate
// cycle on next visit.

const CACHE_VERSION = "vendcast-v1";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const PRECACHE_URLS = [
  "/offline.html",
  "/manifest.json",
  "/icon-192.png",
  "/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(STATIC_CACHE).then((cache) => cache.addAll(PRECACHE_URLS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((key) => !key.startsWith(CACHE_VERSION))
          .map((key) => caches.delete(key))
      )
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle same-origin GET. POSTs, Supabase calls, cross-origin =
  // pass through untouched.
  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  // API routes never cached — live data always.
  if (url.pathname.startsWith("/api/")) return;

  // Immutable static assets: cache-first (serve from cache, fall back to
  // network and populate cache). Once cached, never revalidated for that URL.
  if (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/manifest.json"
  ) {
    event.respondWith(
      caches.match(req).then((cached) => {
        if (cached) return cached;
        return fetch(req).then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(STATIC_CACHE).then((cache) => cache.put(req, copy));
          }
          return response;
        });
      })
    );
    return;
  }

  // Navigation requests (HTML): network-first, fall back to offline shell.
  // Never cache HTML responses — pages are auth-gated and user-specific.
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/offline.html").then((cached) => cached || Response.error())
      )
    );
    return;
  }

  // Everything else: pass through.
});
