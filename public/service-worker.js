/* AURUM service worker — additive offline shell.
 * Strategy:
 *   - Install: precache "/" plus *every* hashed JS/CSS bundle the build
 *     produced, listed in /asset-manifest.json (regenerated on every build
 *     by scripts/generate-sw-manifest.mjs — never hand-maintained, so it
 *     can't drift out of sync with the hashed filenames). This matters
 *     because the app is code-split per route: only precaching the chunks
 *     referenced by "/" left every other route's chunk (e.g. /login) to be
 *     cached lazily on first visit — if that visit never happened online,
 *     a dynamic import() for that chunk had no fallback and threw "Failed
 *     to fetch dynamically imported module" the moment it was needed
 *     offline (e.g. a redirect to /login triggered while offline).
 *     Falls back to scraping "/" for referenced .js/.css if the manifest
 *     is missing (e.g. a dev build that skipped the postbuild step).
 *   - HTML navigations: Network-first → cache fallback → /offline.html
 *   - Same-origin static assets (js/css/img/font): Stale-while-revalidate
 *   - Everything else (Supabase, APIs, cross-origin): passthrough
 * Cache name is versioned so we can purge old shells on update.
 */
const CACHE = "aurum-cache-v3";
const OFFLINE_URL = "/offline.html";
const ASSET_MANIFEST_URL = "/asset-manifest.json";
const STATIC_PRECACHE = [OFFLINE_URL, "/manifest.json", "/icon-192.png", "/icon-512.png"];

// Same-origin script/link URLs referenced by the app shell HTML — fallback
// discovery used only if the build-generated asset manifest is unavailable.
function extractShellAssetUrls(html) {
  const urls = new Set();
  const re = /(?:src|href)="(\/[^"?#]+\.(?:js|css))"/g;
  let m;
  while ((m = re.exec(html))) urls.add(m[1]);
  return Array.from(urls);
}

async function cacheAll(cache, urls) {
  await Promise.all(
    urls.map((u) =>
      fetch(u, { cache: "no-store" })
        .then((r) => (r.ok ? cache.put(u, r) : null))
        .catch(() => {})
    )
  );
}

async function precacheAppShell(cache) {
  try {
    const res = await fetch("/", { cache: "no-store" });
    if (res.ok) await cache.put("/", res);
  } catch {
    // Offline at install time (or first install ever) — "/" will be cached
    // opportunistically the next time it's fetched online.
  }

  try {
    const manifestRes = await fetch(ASSET_MANIFEST_URL, { cache: "no-store" });
    if (manifestRes.ok) {
      const { assets } = await manifestRes.json();
      if (Array.isArray(assets) && assets.length > 0) {
        await cacheAll(cache, assets);
        return;
      }
    }
  } catch {
    // Fall through to HTML-scrape discovery below.
  }

  // Fallback: no usable manifest — discover assets from "/"'s own markup.
  try {
    const cachedRoot = await cache.match("/");
    const html = cachedRoot ? await cachedRoot.clone().text() : null;
    if (html) await cacheAll(cache, extractShellAssetUrls(html));
  } catch {
    // Nothing more we can do offline-first here.
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
