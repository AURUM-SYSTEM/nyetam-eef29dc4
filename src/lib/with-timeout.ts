export const TIMEOUT = Symbol("timeout");

// @supabase/auth-js retries a token refresh with exponential backoff for up
// to 30s (AUTO_REFRESH_TICK_DURATION_MS) before giving up. Offline, with a
// locally stored session close to its expiry margin, `getSession()` walks
// straight into that retry loop — anything awaiting it (route guards, the
// auth provider) sits on a spinner for up to 30s, which looks exactly like
// "the app doesn't load". Bound the wait instead of trusting it to resolve
// promptly.
export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T | typeof TIMEOUT> {
  return Promise.race([
    promise,
    new Promise<typeof TIMEOUT>((resolve) => setTimeout(() => resolve(TIMEOUT), ms)),
  ]);
}
