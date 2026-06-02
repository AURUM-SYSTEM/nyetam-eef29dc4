import { Link } from "@tanstack/react-router";
import { FileText, ClipboardList, Activity, User2, Terminal, LogOut } from "lucide-react";

export function AdminPanel() {
  const handleExit = () => {
    try {
      localStorage.removeItem("aurum_role");
    } catch {}
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.delete("admin");
      window.location.href = url.pathname;
    }
  };

  const log = (label: string) => {
    // eslint-disable-next-line no-console
    console.log(`[AURUM ADMIN] ${label} @ ${new Date().toISOString()}`);
  };

  return (
    <div className="glass-card rounded-2xl p-6 space-y-5 border-gold/40">
      <div className="flex items-center justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-gold/40 bg-gold/10 px-3 py-1 text-[10px] font-semibold uppercase tracking-widest text-gold">
            <Terminal className="h-3 w-3" /> Admin Panel
          </div>
          <h2 className="mt-3 font-display text-xl">AURUM SYSTEM — ADMIN</h2>
          <p className="text-xs text-muted-foreground">Accès interne · supervision · tests</p>
        </div>
        <button
          type="button"
          onClick={handleExit}
          className="inline-flex items-center gap-1.5 rounded-lg border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs font-medium text-red-400 hover:bg-red-400/20"
        >
          <LogOut className="h-3.5 w-3.5" />
          Quitter le mode admin
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Link
          to="/"
          onClick={() => log("open documents")}
          className="glass-card rounded-xl p-3 hover:border-gold/40"
        >
          <FileText className="h-5 w-5 text-gold" />
          <div className="mt-2 text-sm font-medium">Documents</div>
          <div className="text-[11px] text-muted-foreground">Accès direct</div>
        </Link>

        <Link
          to="/recensements"
          onClick={() => log("open recensements")}
          className="glass-card rounded-xl p-3 hover:border-gold/40"
        >
          <ClipboardList className="h-5 w-5 text-gold" />
          <div className="mt-2 text-sm font-medium">Recensements</div>
          <div className="text-[11px] text-muted-foreground">Liste & gestion</div>
        </Link>

        <Link
          to="/recensement"
          onClick={() => log("test pipeline audio→transcription→génération")}
          className="glass-card rounded-xl p-3 hover:border-gold/40"
        >
          <Activity className="h-5 w-5 text-gold" />
          <div className="mt-2 text-sm font-medium">Test pipeline</div>
          <div className="text-[11px] text-muted-foreground">Audio → IA → PDF</div>
        </Link>

        <Link
          to="/new"
          onClick={() => log("simulate user mode")}
          className="glass-card rounded-xl p-3 hover:border-gold/40"
        >
          <User2 className="h-5 w-5 text-gold" />
          <div className="mt-2 text-sm font-medium">Simulation user</div>
          <div className="text-[11px] text-muted-foreground">Vue terrain</div>
        </Link>
      </div>

      <div className="rounded-xl border border-border bg-card/50 p-3">
        <div className="text-[10px] uppercase tracking-widest text-muted-foreground">Logs</div>
        <p className="mt-1 text-xs text-foreground/80">
          Les actions admin sont loggées en console (préfixe <code className="text-gold">[AURUM ADMIN]</code>).
        </p>
      </div>
    </div>
  );
}
