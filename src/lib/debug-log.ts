// Double logging console + buffer en mémoire, affichable à l'écran via
// DebugLogPanel.tsx (dev uniquement — voir ce fichier). Utile pour
// diagnostiquer sur un téléphone sans accès à un ordinateur pour les
// DevTools distants. Utilisé aussi par du code permanent (ex.
// chunk-reload.ts) qui a besoin de logs visibles en dev sans dépendre de la
// console distante.
//
// No-op en production (ni console.*, ni buffer) : ces fonctions restent
// appelables partout dans le code sans risque — un appelant n'a jamais à se
// demander s'il expose un détail technique à un utilisateur final.
type Entry = { at: number; text: string };

const MAX_ENTRIES = 200;
let entries: Entry[] = [];
type Listener = () => void;
const listeners = new Set<Listener>();

function notify() {
  listeners.forEach((l) => { try { l(); } catch {} });
}

function format(args: unknown[]): string {
  return args
    .map((a) => {
      if (typeof a === "string") return a;
      try { return JSON.stringify(a); } catch { return String(a); }
    })
    .join(" ");
}

function push(text: string) {
  entries = [...entries, { at: Date.now(), text }].slice(-MAX_ENTRIES);
  notify();
}

export function debugLog(...args: unknown[]) {
  if (!import.meta.env.DEV) return;
  console.log(...args);
  push(format(args));
}

export function debugWarn(...args: unknown[]) {
  if (!import.meta.env.DEV) return;
  console.warn(...args);
  push("[WARN] " + format(args));
}

export function debugError(...args: unknown[]) {
  if (!import.meta.env.DEV) return;
  console.error(...args);
  push("[ERROR] " + format(args));
}

export function getDebugEntries(): Entry[] {
  return entries;
}

export function clearDebugLog() {
  entries = [];
  notify();
}

export function subscribeDebugLog(l: Listener) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}
