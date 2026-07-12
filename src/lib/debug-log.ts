// DEBUG TEMPORAIRE — capture les mêmes messages [PARCELLES DEBUG] / [IDB
// DEBUG] déjà envoyés à la console, pour un affichage à l'écran (voir
// DebugLogPanel.tsx). Utile pour diagnostiquer sur un téléphone sans accès
// à un ordinateur pour les DevTools distants. À retirer avec le reste de
// cette instrumentation une fois la cause du cache parcelles confirmée.
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
  console.log(...args);
  push(format(args));
}

export function debugWarn(...args: unknown[]) {
  console.warn(...args);
  push("[WARN] " + format(args));
}

export function debugError(...args: unknown[]) {
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
