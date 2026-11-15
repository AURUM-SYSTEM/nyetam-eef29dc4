// Public client configuration for the dedicated DO Fast Supabase project.
// Publishable keys are designed for browser use; never place service_role/secret keys here.
(() => {
  if (!window.supabase?.createClient) {
    console.error("Supabase JS SDK did not load.");
    return;
  }
  const SUPABASE_URL = "https://hfezyhdimucdfoklzqok.supabase.co";
  const SUPABASE_PUBLISHABLE_KEY = "sb_publishable_l3Hw4rCgHazqJBnpU196Tw_VrrpUBw_";
  window.doFastSupabase = window.supabase.createClient(
    SUPABASE_URL,
    SUPABASE_PUBLISHABLE_KEY,
    {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true
      }
    }
  );
})();
