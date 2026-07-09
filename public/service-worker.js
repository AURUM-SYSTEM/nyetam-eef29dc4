/* AURUM service worker — additive offline shell.
 * Strategy:
 *   - HTML navigations: Network-first → cache fallback → /offline.html
 *   - Same-origin static assets (js/css/img/font): Stale-while-revalidate
 *   - Everything else (Supabase, APIs, cross-origin): passthrough
 * Cache name is versioned so we can purge old shells on update.
 */
const CACHE = "aurum-cache-v1";
const OFFLINE_URL = "/offline.html";
const PRECACHE = ["/", OFFLINE_URL, "/manifest.json"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(PRECACHE)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isSameOrigin(url) {
  try { return new URL(url).origin === self.location.origin; }
  catch { return false; }
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // Never intercept cross-origin (Supabase, IA, Nominatim, etc.)
  if (!isSameOrigin(req.url)) return;

  // Never cache server functions / API routes
  if (url.pathname.startsWith("/api/") || url.pathname.startsWith("/_serverFn")) return;

  // HTML navigations → network-first
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      (async () => {
        try {
          const fresh = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put(req, fresh.clone()).catch(() => {});
          return fresh;
        } catch {
          const cached = await caches.match(req);
          if (cached) return cached;
          const offline = await caches.match(OFFLINE_URL);
          return offline || new Response("Offline", { status: 503 });
        }
      })()
    );
    return;
  }

  // Static assets → stale-while-revalidate
  event.respondWith(
    (async () => {
      const cached = await caches.match(req);
      const network = fetch(req)
        .then((res) => {
          if (res && res.status === 200 && res.type === "basic") {
            caches.open(CACHE).then((c) => c.put(req, res.clone())).catch(() => {});
          }
          return res;
        })
        .catch(() => null);
      return cached || (await network) || new Response("Offline", { status: 503 });
    })()
  );
});
