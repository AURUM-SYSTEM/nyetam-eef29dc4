// Post-build step (runs automatically after `npm run build` via the npm
// `postbuild` lifecycle hook) — writes the exact, current list of every
// hashed JS/CSS bundle the build produced to a JSON file the service worker
// fetches at install time. This is what lets the service worker precache
// *every* code-split chunk (not just the ones referenced by "/"), so a
// dynamic import() for any route (e.g. the /login chunk) can still resolve
// offline even if that route was never actually visited online.
//
// Regenerated on every build, so it can never drift out of sync with the
// hashed filenames the way a hand-maintained list would.
import { readdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const ASSETS_DIR = fileURLToPath(new URL("../.output/public/assets/", import.meta.url));
const OUT_FILE = fileURLToPath(new URL("../.output/public/asset-manifest.json", import.meta.url));

const entries = await readdir(ASSETS_DIR, { withFileTypes: true });
const assets = entries
  .filter((e) => e.isFile() && (e.name.endsWith(".js") || e.name.endsWith(".css")))
  .map((e) => `/assets/${e.name}`)
  .sort();

await writeFile(OUT_FILE, JSON.stringify({ generatedAt: new Date().toISOString(), assets }, null, 2));
console.log(`[sw-manifest] ${assets.length} asset(s) listed in asset-manifest.json`);
