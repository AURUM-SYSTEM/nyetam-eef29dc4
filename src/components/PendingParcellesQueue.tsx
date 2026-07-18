// Parcelles créées hors-ligne (mission recensement_plantations), en attente
// de synchronisation — même rôle que PendingQueue.tsx pour les documents,
// pour la file dédiée `pendingParcelles` (voir offline-store.ts et
// useSyncEngine). Affiché sur /parcelles, au-dessus des parcelles déjà
// synchronisées.
import { useEffect, useState } from "react";
import { AlertTriangle, Clock, Loader2, RefreshCw, Sprout, Trash2 } from "lucide-react";
import {
  listPendingParcelles,
  updatePendingParcelle,
  deletePendingParcelle,
  subscribeQueue,
  listQueue,
  updateQueueItem,
  type PendingParcelle,
} from "@/lib/offline-store";

const STATUS_LABEL: Record<string, string> = {
  pending: "En attente de synchronisation",
  syncing: "Synchronisation…",
  error: "Erreur de synchronisation",
  conflict: "Doublon potentiel — action requise",
};

function StatusBadge({ status }: { status: PendingParcelle["status"] }) {
  const map: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-400",
    syncing: "bg-sky-500/10 text-sky-400",
    error: "bg-destructive/15 text-destructive",
    conflict: "bg-amber-500/15 text-amber-400",
  };
  const cls = map[status] ?? "bg-muted/30 text-muted-foreground";
  const Icon = status === "error" || status === "conflict" ? AlertTriangle : status === "syncing" ? Loader2 : Clock;
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}>
      <Icon className={`h-3 w-3 ${status === "syncing" ? "animate-spin" : ""}`} />
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

// Une parcelle abandonnée (créée hors-ligne, jamais envoyée) ne doit pas
// laisser un document en file pointer indéfiniment vers un id qui ne verra
// jamais le jour — on délie la référence plutôt que de bloquer la saisie.
async function abandonPendingParcelle(id: string) {
  const allQueued = await listQueue();
  for (const doc of allQueued) {
    if (doc.meta?.parcelleId === id) {
      await updateQueueItem(doc.id, { meta: { ...doc.meta, parcelleId: undefined } });
    }
  }
  await deletePendingParcelle(id);
}

export function PendingParcellesQueue() {
  const [items, setItems] = useState<PendingParcelle[]>([]);
  const [reasonById, setReasonById] = useState<Record<string, string>>({});

  useEffect(() => {
    let mounted = true;
    async function refresh() {
      const all = await listPendingParcelles();
      if (mounted) setItems(all);
    }
    void refresh();
    const unsub = subscribeQueue(() => { void refresh(); });
    return () => { mounted = false; unsub(); };
  }, []);

  if (items.length === 0) return null;

  function triggerSync() {
    if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent("aurum:sync-now"));
  }

  async function retry(id: string) {
    await updatePendingParcelle(id, { status: "pending", errorMsg: undefined, retryCount: 0, nextRetryAt: 0 });
    triggerSync();
  }

  async function forceCreate(id: string) {
    const reason = (reasonById[id] ?? "").trim();
    if (reason.length < 10) return;
    await updatePendingParcelle(id, {
      status: "pending",
      forceCreate: true,
      reason,
      existingParcelle: undefined,
      errorMsg: undefined,
      retryCount: 0,
      nextRetryAt: 0,
    });
    triggerSync();
  }

  return (
    <section className="mb-6">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg">En attente de synchronisation</h2>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>
      <ul className="space-y-2">
        {items.map((p) => (
          <li key={p.id} className="glass-card rounded-xl px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
                <Sprout className="h-5 w-5 text-gold" />
              </div>
              <div className="min-w-0 flex-1">
                <StatusBadge status={p.status} />
                <div className="mt-0.5 truncate text-sm font-medium">{p.culture}</div>
                <div className="text-[11px] text-muted-foreground">
                  {p.surfaceHa != null ? `${p.surfaceHa} ha` : "Surface inconnue"}
                  {p.cooperativeName && <> · {p.cooperativeName}</>}
                  {p.producerName && <> · {p.producerName}</>}
                </div>

                {p.status === "error" && p.errorMsg && (
                  <div className="mt-1 text-[11px] text-destructive">{p.errorMsg}</div>
                )}

                {p.status === "conflict" && p.existingParcelle && (
                  <div className="mt-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                    <p className="flex items-start gap-2 text-xs text-amber-300">
                      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                      Une parcelle avec {p.existingParcelle.culture} existe déjà à {p.existingParcelle.distanceMeters} m
                      de cette position — détecté à la synchronisation (pas vérifiable hors-ligne au moment de la saisie).
                    </p>
                    <textarea
                      value={reasonById[p.id] ?? ""}
                      onChange={(e) => setReasonById((prev) => ({ ...prev, [p.id]: e.target.value }))}
                      placeholder="Justification (10 caractères minimum) pour créer quand même…"
                      rows={2}
                      className="mt-2 w-full rounded-lg border border-amber-500/30 bg-input/50 px-3 py-2 text-xs outline-none focus:border-amber-400"
                    />
                    <div className="mt-2 flex flex-wrap gap-2">
                      <button
                        onClick={() => void forceCreate(p.id)}
                        disabled={(reasonById[p.id] ?? "").trim().length < 10}
                        className="rounded-lg btn-gold px-3 py-1.5 text-xs disabled:opacity-40"
                      >
                        Créer quand même
                      </button>
                      <button
                        onClick={() => void abandonPendingParcelle(p.id)}
                        className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground"
                      >
                        Abandonner
                      </button>
                    </div>
                  </div>
                )}
              </div>
              {p.status !== "conflict" && (
                <div className="flex shrink-0 gap-1">
                  {p.status === "error" && (
                    <button
                      onClick={() => void retry(p.id)}
                      className="rounded-md p-2 text-muted-foreground hover:text-foreground"
                      aria-label="Réessayer"
                    >
                      <RefreshCw className="h-4 w-4" />
                    </button>
                  )}
                  <button
                    onClick={() => void abandonPendingParcelle(p.id)}
                    className="rounded-md p-2 text-muted-foreground hover:text-destructive"
                    aria-label="Supprimer"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
