// Panneau texte repliable affichant en direct les logs internes (voir
// src/lib/debug-log.ts), pour diagnostiquer directement à l'écran sur un
// téléphone, sans DevTools distant. Réservé au développement : ne s'affiche
// jamais en production, même si des entrées sont présentes.
import { useState, useSyncExternalStore } from "react";
import { getDebugEntries, subscribeDebugLog, clearDebugLog } from "@/lib/debug-log";

export function DebugLogPanel() {
  const entries = useSyncExternalStore(subscribeDebugLog, getDebugEntries, getDebugEntries);
  const [open, setOpen] = useState(false);

  if (!import.meta.env.DEV) return null;
  if (entries.length === 0) return null;

  return (
    <div className="fixed inset-x-0 bottom-0 z-[100] border-t border-amber-500/50 bg-black/95 text-amber-200">
      <div className="flex items-center justify-between px-3 py-2 text-[11px] uppercase tracking-widest">
        <button type="button" onClick={() => setOpen(o => !o)} className="flex-1 text-left">
          Debug ({entries.length}) {open ? "▲ replier" : "▼ déplier"}
        </button>
        <button
          type="button"
          onClick={() => clearDebugLog()}
          className="ml-3 shrink-0 rounded border border-amber-500/40 px-2 py-0.5 normal-case tracking-normal text-amber-300"
        >
          Vider
        </button>
      </div>
      {open && (
        <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words border-t border-amber-500/20 p-2 text-[10px] leading-snug">
          {entries.map(e => `${new Date(e.at).toLocaleTimeString()}  ${e.text}`).join("\n\n")}
        </pre>
      )}
    </div>
  );
}
