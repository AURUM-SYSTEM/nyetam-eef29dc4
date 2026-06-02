import { useEffect, useState } from "react";
import { Wifi, WifiOff, RefreshCw } from "lucide-react";
import { useOnline } from "@/hooks/use-online";
import { listPending, subscribeQueue } from "@/lib/offline-store";

/**
 * Network + sync status badge — 3 states:
 *  🟢 Connected         (online, queue vide)
 *  🟡 Sync en attente   (queue contient des items non synchronisés)
 *  🔴 Hors ligne        (pas de réseau)
 *
 * Mise à jour automatique : aucun bouton, aucune action utilisateur.
 */
export function SyncStatus() {
  const online = useOnline();
  const [pending, setPending] = useState(0);

  useEffect(() => {
    let mounted = true;
    async function refresh() {
      try {
        const items = await listPending();
        if (mounted) setPending(items.length);
      } catch {
        if (mounted) setPending(0);
      }
    }
    void refresh();
    const unsub = subscribeQueue(() => { void refresh(); });
    const id = setInterval(refresh, 15000);
    return () => { mounted = false; unsub(); clearInterval(id); };
  }, []);

  let state: "offline" | "pending" | "online";
  if (!online) state = "offline";
  else if (pending > 0) state = "pending";
  else state = "online";

  const cfg = {
    online: {
      cls: "bg-emerald-500/10 text-emerald-400",
      dot: "bg-emerald-400",
      label: "Connecté",
      Icon: Wifi,
      spin: false,
      title: "En ligne — données synchronisées",
    },
    pending: {
      cls: "bg-amber-500/10 text-amber-400",
      dot: "bg-amber-400 animate-pulse",
      label: `Sync ${pending}`,
      Icon: RefreshCw,
      spin: true,
      title: `${pending} document(s) en attente de synchronisation`,
    },
    offline: {
      cls: "bg-red-500/10 text-red-400",
      dot: "bg-red-400 animate-pulse",
      label: "Hors ligne",
      Icon: WifiOff,
      spin: false,
      title: "Hors ligne — sauvegarde locale automatique",
    },
  }[state];

  const { Icon } = cfg;
  return (
    <div
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[10px] uppercase tracking-widest ${cfg.cls}`}
      title={cfg.title}
      aria-live="polite"
    >
      <span className={`h-1.5 w-1.5 rounded-full ${cfg.dot}`} />
      <Icon className={`h-3 w-3 ${cfg.spin ? "animate-spin" : ""}`} />
      {cfg.label}
    </div>
  );
}
