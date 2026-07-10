/* AURUM service worker — additive offline shell.
 * Strategy:
 *   - Install: fetch "/" fresh, discover every same-origin JS/CSS bundle it
 *     references (script/link tags — entry chunk, vendor chunks, route
 *     chunks preloaded via modulepreload) and cache all of them alongside
 *     the HTML itself. This is what makes offline work after a SINGLE
 *     online visit — without it, only the HTML shell was cached and the JS
 *     it depends on was cached lazily (or never, if the entry bundle loaded
 *     before the SW existed), so a fresh offline load rendered a blank page.
 *   - HTML navigations: Network-first → cache fallback → /offline.html
 *   - Same-origin static assets (js/css/img/font): Stale-while-revalidate
 *   - Everything else (Supabase, APIs, cross-origin): passthrough
 * Cache name is versioned so we can purge old shells on update.
 */
const CACHE = "aurum-cache-v2";
const OFFLINE_URL = "/offline.html";
const STATIC_PRECACHE = [OFFLINE_URL, "/manifest.json", "/icon-192.png", "/icon-512.png"];

// Same-origin script/link URLs referenced by the app shell HTML — this is
// how the entry bundle, its vendor chunks and any modulepreload'd route
// chunks get discovered without needing a build-time asset manifest.
function extractShellAssetUrls(html) {
  const urls = new Set();
  const re = /(?:src|href)="(\/[^"?#]+\.(?:js|css))"/g;
  let m;
  while ((m = re.exec(html))) urls.add(m[1]);
  return Array.from(urls);
}

async function precacheAppShell(cache) {
  try {
    const res = await fetch("/", { cache: "no-store" });
    if (!res.ok) return;
    const html = await res.clone().text();
    await cache.put("/", res);
    const assetUrls = extractShellAssetUrls(html);
    await Promise.all(
      assetUrls.map((u) =>
        fetch(u, { cache: "no-store" })
          .then((r) => (r.ok ? cache.put(u, r) : null))
          .catch(() => {})
      )
    );
  } catch {
    // Offline at install time (or first install ever) — nothing to precache
    // yet, the runtime stale-while-revalidate handler will fill the cache
    // in as the app is used online.
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(STATIC_PRECACHE).catch(() => {});
      await precacheAppShell(cache);
    })()
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
          const cache = await caches.open(CACHE);
          const cached = (await cache.match(req)) || (await cache.match("/"));
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
