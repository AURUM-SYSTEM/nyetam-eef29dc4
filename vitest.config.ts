import { defineConfig } from "vitest/config";

// Config minimale, volontairement séparée de vite.config.ts (qui embarque
// le preset @lovable.dev/vite-tanstack-config — SSR TanStack Start,
// plugin Cloudflare — inutile et potentiellement fragile pour de simples
// tests unitaires sur des fonctions pures).
export default defineConfig({
  test: {
    environment: "node",
  },
});
