// VendCast service worker — Phase 8.2.
//
// Responsibilities:
//   1. Precache the app shell (offline page, manifest, icons) on install.
//   2. Navigation: network-first, fall back to /offline.html.
//   3. Static assets (/_next/static/, icons, manifest): cache-first.
//   4. Everything else (API, Supabase, cross-origin): pass-through.
//   5. Web push: show notification on incoming push event.
//   6. Notification click: focus an existing tab or open /dashboard/bookings
//      (or whatever url was in the payload).
//
// Bump CACHE_VERSION to force a rebuild of caches after structural changes.
// Browsers install a new SW whenever /sw.js bytes change, so a version bump
// alone triggers install + activate on next visit.

const CACHE_VERSION = "vendcast-v2";
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

  if (req.method !== "GET" || url.origin !== self.location.origin) return;

  if (url.pathname.startsWith("/api/")) return;

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

  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req).catch(() =>
        caches.match("/offline.html").then((cached) => cached || Response.error())
      )
    );
    return;
  }
});

// ─── Web push ─────────────────────────────────────────────────────────────
//
// Payload shape (server side):
//   { title, body, url?, tag? }
// `tag` collapses duplicate notifications so retries / repeated triggers
// don't stack. `url` is where the user lands when they tap the notification.

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    // Non-JSON payload (shouldn't happen from our /api/push/send but be safe).
    data = { body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "VendCast";
  const options = {
    body: data.body || "",
    icon: "/icon-192.png",
    badge: "/icon-192.png",
    data: { url: data.url || "/dashboard" },
  };
  if (data.tag) options.tag = data.tag;

  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = (event.notification.data && event.notification.data.url) || "/dashboard";
  const targetUrl = new URL(target, self.location.origin).href;

  event.waitUntil(
    self.clients
      .matchAll({ type: "window", includeUncontrolled: true })
      .then((clientsList) => {
        // Focus an existing tab on the same origin if one's open; else
        // open a new window to the target URL.
        for (const client of clientsList) {
          try {
            const clientUrl = new URL(client.url);
            if (clientUrl.origin === self.location.origin && "focus" in client) {
              // Navigate that tab to the target if it's not already there.
              if (client.url !== targetUrl && "navigate" in client) {
                return client.navigate(targetUrl).then(() => client.focus());
              }
              return client.focus();
            }
          } catch {
            // Ignore malformed client URLs.
          }
        }
        return self.clients.openWindow(targetUrl);
      })
  );
});
