// Un déploiement pendant qu'un onglet reste ouvert change les noms hashés
// des bundles JS. Le service worker (self.skipWaiting() + clients.claim())
// peut prendre le contrôle d'un onglet déjà ouvert sans rechargement — le JS
// déjà chargé en mémoire continue alors de référencer les anciens hashs.
// Le prochain import() dynamique vers une route (ex. navigation vers "/")
// échoue avec "Failed to fetch dynamically imported module" : ce chunk n'a
// jamais été mis en cache sous ce hash et n'existe plus sur le serveur
// (remplacé par le nouveau déploiement). La seule sortie propre est un
// rechargement complet de la page, qui récupère le HTML/JS à jour.
import { debugLog, debugWarn } from "./debug-log";

const RELOAD_FLAG_KEY = "aurum.chunk-reload-attempted";
const CHUNK_ERROR_RE = /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i;

export function isChunkLoadError(message: string): boolean {
  return CHUNK_ERROR_RE.test(message);
}

// Exporté séparément : le routeur (errorComponent dans __root.tsx) attrape
// ces erreurs via sa PROPRE limite d'erreur React — elles ne remontent
// jamais jusqu'aux écouteurs globaux window.onerror/unhandledrejection
// ci-dessous, qui ne suffisent donc pas à eux seuls.
export function reloadOnChunkError(source: string, message: string) {
  let alreadyTried = false;
  try { alreadyTried = sessionStorage.getItem(RELOAD_FLAG_KEY) === "1"; } catch {}

  if (alreadyTried) {
    // Un seul essai automatique par incident, pour ne jamais boucler si le
    // problème persiste (ex. réellement hors-ligne et sans cache).
    debugWarn("[CHUNK RELOAD] déjà tenté un rechargement automatique récemment — abandon", { source, message });
    return;
  }

  try { sessionStorage.setItem(RELOAD_FLAG_KEY, "1"); } catch {}
  debugLog("[CHUNK RELOAD] chunk introuvable (probablement un nouveau déploiement pendant que l'onglet était ouvert) — rechargement automatique", { source, message });
  window.location.reload();
}

export function registerChunkErrorReload() {
  if (typeof window === "undefined") return;

  window.addEventListener("unhandledrejection", (event) => {
    const reason = event.reason as unknown;
    const message = reason instanceof Error ? reason.message : String(reason ?? "");
    if (isChunkLoadError(message)) reloadOnChunkError("unhandledrejection", message);
  });

  window.addEventListener("error", (event) => {
    if (isChunkLoadError(event.message || "")) reloadOnChunkError("error", event.message);
  });

  // Page stable après quelques secondes → on réarme la protection anti-
  // boucle pour un éventuel futur incident (ex. un prochain déploiement).
  window.setTimeout(() => {
    try { sessionStorage.removeItem(RELOAD_FLAG_KEY); } catch {}
  }, 8000);
}
