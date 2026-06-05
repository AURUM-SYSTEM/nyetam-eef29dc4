/**
 * Service worker registration with strict preview/dev guards.
 *
 * Why guards: a service worker registered in the Lovable editor preview or
 * any iframe context can serve stale HTML/chunks after deploy and is very
 * hard to recover from. We only register in published production, in a
 * top-level window, on real lovable.app / custom domains.
 *
 * Kill switch: append `?sw=off` to any URL to unregister the SW.
 */
const SW_URL = "/service-worker.js";

function isUnsafeContext(): boolean {
  if (typeof window === "undefined") return true;
  if (!("serviceWorker" in navigator)) return true;
  if (!import.meta.env.PROD) return true;

  try {
    if (window.top !== window.self) return true; // iframe (Lovable preview)
  } catch {
    return true; // cross-origin frame access denied
  }

  const host = window.location.hostname;
  if (
    host.startsWith("id-preview--") ||
    host.startsWith("preview--") ||
    host === "lovableproject.com" || host.endsWith(".lovableproject.com") ||
    host === "lovableproject-dev.com" || host.endsWith(".lovableproject-dev.com") ||
    host === "beta.lovable.dev" || host.endsWith(".beta.lovable.dev") ||
    host === "localhost" || host === "127.0.0.1"
  ) return true;

  if (new URLSearchParams(window.location.search).has("sw")) {
    if (new URLSearchParams(window.location.search).get("sw") === "off") return true;
  }
  return false;
}

async function unregisterAll() {
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(
      regs
        .filter((r) => !r.active?.scriptURL || r.active.scriptURL.endsWith(SW_URL))
        .map((r) => r.unregister()),
    );
  } catch {}
}

export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return;

  if (isUnsafeContext()) {
    void unregisterAll();
    return;
  }

  window.addEventListener("load", () => {
    navigator.serviceWorker
      .register(SW_URL, { scope: "/" })
      .then(() => console.log("[AURUM] Service worker registered"))
      .catch((err) => console.warn("[AURUM] SW registration failed", err));
  });
}
