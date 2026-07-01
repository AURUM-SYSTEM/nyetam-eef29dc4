import { useEffect, useState } from "react";
import {
  listPending,
  subscribeQueue,
  updateQueueItem,
  deleteQueueItem,
  type QueueItem,
} from "@/lib/offline-store";
import { Clock, Loader2, AlertTriangle, RefreshCw, Trash2, FileAudio, FileText } from "lucide-react";

const STATUS_LABEL: Record<string, string> = {
  pending: "🎤 Audio reçu",
  uploading: "📤 Envoi…",
  transcribing: "📝 Transcription…",
  generating: "🤖 Génération…",
  error: "⚠️ Erreur",
  synced: "📄 Prêt",
};

function StatusBadge({ s }: { s: QueueItem["status"] }) {
  const map: Record<string, string> = {
    pending: "bg-amber-500/10 text-amber-400",
    uploading: "bg-sky-500/10 text-sky-400",
    transcribing: "bg-sky-500/10 text-sky-400",
    generating: "bg-sky-500/10 text-sky-400",
    error: "bg-destructive/15 text-destructive",
    synced: "bg-emerald-500/10 text-emerald-400",
  };
  const cls = map[s] ?? "bg-muted/30 text-muted-foreground";
  const Icon =
    s === "error" ? AlertTriangle :
    s === "pending" ? Clock :
    s === "synced" ? FileText : Loader2;
  const spin = s === "uploading" || s === "transcribing" || s === "generating";
  return (
    <span className={`inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${cls}`}>
      <Icon className={`h-3 w-3 ${spin ? "animate-spin" : ""}`} />
      {STATUS_LABEL[s] ?? s}
    </span>
  );
}

export function PendingQueue() {
  const [items, setItems] = useState<QueueItem[]>([]);

  useEffect(() => {
    let mounted = true;
    async function refresh() {
      const all = await listPending();
      if (mounted) setItems(all);
    }
    void refresh();
    const unsub = subscribeQueue(() => { void refresh(); });
    return () => { mounted = false; unsub(); };
  }, []);

  if (items.length === 0) return null;

  async function retry(id: string) {
    await updateQueueItem(id, { status: "pending", errorMsg: undefined });
  }
  async function remove(id: string) {
    await deleteQueueItem(id);
  }

  return (
    <section className="mt-8">
      <div className="mb-3 flex items-center justify-between">
        <h2 className="font-display text-lg">Documents en attente</h2>
        <span className="text-xs text-muted-foreground">{items.length}</span>
      </div>
      <ul className="space-y-2">
        {items.map(it => (
          <li key={it.id} className="glass-card rounded-xl px-4 py-3">
            <div className="flex items-start gap-3">
              <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
                {it.audioId ? <FileAudio className="h-5 w-5 text-gold" /> : <FileText className="h-5 w-5 text-gold" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gold-soft">
                    {({ rapport: "Rapport", mission_terrain: "Mission", pv: "PV", enquete: "Enquête", recensement: "Recensement", auto: "Auto" } as Record<string, string>)[it.type] ?? it.type}
                  </span>
                  <StatusBadge s={it.status} />
                </div>
                <div className="mt-0.5 truncate text-sm font-medium">
                  {it.title ?? (it.audioId ? "Enregistrement audio" : "Saisie manuelle")}
                </div>
                <div className="text-[11px] text-muted-foreground">
                  {new Date(it.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                </div>
                {it.status === "error" && it.errorMsg && (
                  <div className="mt-1 text-[11px] text-destructive">{it.errorMsg}</div>
                )}
              </div>
              <div className="flex shrink-0 gap-1">
                {it.status === "error" && (
                  <button
                    onClick={() => retry(it.id)}
                    className="rounded-md p-2 text-muted-foreground hover:text-foreground"
                    aria-label="Réessayer"
                  >
                    <RefreshCw className="h-4 w-4" />
                  </button>
                )}
                <button
                  onClick={() => remove(it.id)}
                  className="rounded-md p-2 text-muted-foreground hover:text-destructive"
                  aria-label="Supprimer"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
