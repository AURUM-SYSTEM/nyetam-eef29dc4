import { useState, useEffect, useCallback } from "react";
import { MessageCircle, ArrowRight, Sparkles, CheckCircle2, ChevronRight } from "lucide-react";
import { AdminPanel } from "@/components/AdminPanel";

const ROLE_KEY = "aurum_role";

function detectAdmin(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const search = window.location.search || "";
    if (search.includes("admin=true")) {
      localStorage.setItem(ROLE_KEY, "admin");
      return true;
    }
    return localStorage.getItem(ROLE_KEY) === "admin";
  } catch {
    return false;
  }
}

const DEVICE_ID_KEY = "aurum_device_id";
const PILOT_STARTED_KEY = "aurum_pilot_started";
const LAST_VISIT_KEY = "aurum_last_visit";

const WHATSAPP_JOIN_URL =
  "https://wa.me/237695599387?text=Je%20souhaite%20rejoindre%20le%20programme%20pilote%20AURUM%20SYSTEM%20pour%20tester%20la%20solution%20en%20contexte%20terrain.";
const WHATSAPP_CONTINUE_URL =
  "https://wa.me/237695599387?text=Je%20souhaite%20continuer%20mon%20exp%C3%A9rience%20avec%20AURUM%20SYSTEM.";

function getOrCreateDeviceId(): string {
  if (typeof window === "undefined") return "";
  let id = localStorage.getItem(DEVICE_ID_KEY);
  if (!id) {
    id = crypto.randomUUID
      ? crypto.randomUUID()
      : Math.random().toString(36).substring(2) + Date.now().toString(36);
    localStorage.setItem(DEVICE_ID_KEY, id);
  }
  return id;
}

type PilotState = "new_user" | "active_user" | "returning_user";

function computePilotState(): PilotState {
  if (typeof window === "undefined") return "new_user";
  const started = localStorage.getItem(PILOT_STARTED_KEY);
  const lastVisit = parseInt(localStorage.getItem(LAST_VISIT_KEY) || "0");
  const diffDays = Math.floor((Date.now() - lastVisit) / 86400000);

  if (!started) return "new_user";
  if (diffDays <= 7) return "active_user";
  return "returning_user";
}

function markVisit() {
  if (typeof window === "undefined") return;
  localStorage.setItem(LAST_VISIT_KEY, Date.now().toString());
}

function markStarted() {
  if (typeof window === "undefined") return;
  localStorage.setItem(PILOT_STARTED_KEY, "true");
  localStorage.setItem(LAST_VISIT_KEY, Date.now().toString());
}

/* ─── New user ─── */
function NewUserView({ onJoin }: { onJoin: () => void }) {
  return (
    <div className="space-y-5">
      <div className="inline-flex items-center gap-2 rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-xs font-medium text-gold">
        <Sparkles className="h-3.5 w-3.5" />
        Accès gratuit — Programme pilote 30 jours
      </div>

      <h2 className="font-display text-2xl leading-tight md:text-3xl">
        Rejoignez le programme pilote AURUM SYSTEM
      </h2>

      <p className="text-sm leading-relaxed text-muted-foreground">
        AURUM SYSTEM permet de transformer des notes terrain, observations ou dictées vocales en rapports structurés automatiquement, même en conditions difficiles.
      </p>

      <a
        href={WHATSAPP_JOIN_URL}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onJoin}
        className="flex w-full items-center justify-center gap-2 rounded-2xl btn-gold px-5 py-4 text-sm font-semibold"
      >
        <MessageCircle className="h-5 w-5" />
        Rejoindre le programme pilote gratuit
        <ArrowRight className="h-4 w-4" />
      </a>
    </div>
  );
}

/* ─── Active user ─── */
function ActiveUserView({ diffDays }: { diffDays: number }) {
  return (
    <div className="space-y-4">
      <div className="inline-flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-400">
        <CheckCircle2 className="h-3.5 w-3.5" />
        Accès pilote actif
      </div>

      <p className="text-sm text-muted-foreground">
        ✅ Accès pilote actif • J+{diffDays} / 30
      </p>

      <a
        href={WHATSAPP_JOIN_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="flex w-full items-center justify-center gap-2 rounded-2xl btn-gold px-5 py-4 text-sm font-semibold"
      >
        <MessageCircle className="h-5 w-5" />
        Continuer sur WhatsApp
        <ChevronRight className="h-4 w-4" />
      </a>
    </div>
  );
}

/* ─── Returning user ─── */
function ReturningUserView({ onContinue }: { onContinue: () => void }) {
  const [showExplore, setShowExplore] = useState(false);

  if (showExplore) {
    return (
      <div className="space-y-5">
        <h2 className="font-display text-xl">Explorer AURUM SYSTEM</h2>
        <p className="text-sm leading-relaxed text-muted-foreground">
          AURUM SYSTEM est conçu pour transformer les notes en rapports automatiquement.
        </p>
        <button
          type="button"
          onClick={() => setShowExplore(false)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-medium hover:border-gold/40"
        >
          <ArrowRight className="h-4 w-4 rotate-180" />
          Retour
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <h2 className="font-display text-2xl leading-tight md:text-3xl">
        Bienvenue à nouveau
      </h2>

      <p className="text-sm text-muted-foreground">
        Souhaitez-vous continuer votre expérience avec AURUM SYSTEM ?
      </p>

      <div className="space-y-3">
        <a
          href={WHATSAPP_CONTINUE_URL}
          target="_blank"
          rel="noopener noreferrer"
          onClick={onContinue}
          className="flex w-full items-center justify-center gap-2 rounded-2xl btn-gold px-5 py-4 text-sm font-semibold"
        >
          <MessageCircle className="h-5 w-5" />
          Continuer l’expérience
          <ArrowRight className="h-4 w-4" />
        </a>

        <button
          type="button"
          onClick={() => setShowExplore(true)}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-medium hover:border-gold/40"
        >
          Explorer rapidement
          <ArrowRight className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

/* ─── Main component ─── */
export function PilotSection() {
  const [state, setState] = useState<PilotState>("new_user");
  const [diffDays, setDiffDays] = useState(0);
  const [mounted, setMounted] = useState(false);

  const refresh = useCallback(() => {
    const s = computePilotState();
    setState(s);
    if (s === "active_user") {
      const lastVisit = parseInt(localStorage.getItem(LAST_VISIT_KEY) || "0");
      setDiffDays(Math.floor((Date.now() - lastVisit) / 86400000));
    }
  }, []);

  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    const admin = detectAdmin();
    setIsAdmin(admin);
    if (!admin) {
      getOrCreateDeviceId();
      markVisit();
      refresh();
    }
    setMounted(true);
  }, [refresh]);

  const handleJoin = () => {
    markStarted();
    refresh();
  };

  const handleContinue = () => {
    markVisit();
    refresh();
  };

  // Avoid SSR mismatch / flash
  if (!mounted) {
    return (
      <div className="glass-card rounded-2xl p-6 animate-pulse">
        <div className="h-4 w-2/3 rounded bg-muted" />
        <div className="mt-4 h-8 w-full rounded bg-muted" />
        <div className="mt-2 h-4 w-full rounded bg-muted" />
        <div className="mt-4 h-12 w-full rounded bg-muted" />
      </div>
    );
  }

  if (isAdmin) {
    return <AdminPanel />;
  }

  const enterAdmin = () => {
    try {
      localStorage.setItem(ROLE_KEY, "admin");
    } catch {}
    window.location.href = "/?admin=true";
  };

  return (
    <div className="space-y-3">
      <div className="glass-card rounded-2xl p-6">
        {state === "new_user" && <NewUserView onJoin={handleJoin} />}
        {state === "active_user" && <ActiveUserView diffDays={diffDays} />}
        {state === "returning_user" && <ReturningUserView onContinue={handleContinue} />}
      </div>
      <div className="flex justify-center">
        <button
          type="button"
          onClick={enterAdmin}
          className="text-[10px] uppercase tracking-widest text-muted-foreground/60 hover:text-gold transition-colors"
        >
          · Mode administrateur ·
        </button>
      </div>
    </div>
  );
}
