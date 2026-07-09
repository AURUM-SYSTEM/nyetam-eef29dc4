import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, KeyRound, CheckCircle2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/accept-invite")({
  component: AcceptInvitePage,
  head: () => ({ meta: [{ title: "Bienvenue — AURUM SYSTEM" }] }),
});

// Supabase détecte automatiquement le token d'invitation présent dans l'URL
// (fragment #access_token=...) et crée une session temporaire. Cette page
// attend cette session, puis demande simplement au nouvel utilisateur de
// définir son mot de passe pour finaliser son compte.
function AcceptInvitePage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [hasSession, setHasSession] = useState(false);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let attempts = 0;
    const check = async () => {
      const { data } = await supabase.auth.getSession();
      if (data.session) {
        setHasSession(true);
        setChecking(false);
        return;
      }
      attempts += 1;
      if (attempts < 10) {
        setTimeout(check, 400);
      } else {
        setChecking(false);
      }
    };
    void check();
  }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (password.length < 6) { toast.error("6 caractères minimum."); return; }
    if (password !== confirm) { toast.error("Les mots de passe ne correspondent pas."); return; }
    setBusy(true);
    const { error } = await supabase.auth.updateUser({ password });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setDone(true);
    toast.success("Mot de passe défini");
    setTimeout(() => navigate({ to: "/" }), 1200);
  }

  return (
    <div className="px-5 pt-16 pb-32">
      <header className="mb-10 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">AURUM SYSTEM</p>
        <h1 className="mt-3 font-display text-4xl">Bienvenue</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Définis ton mot de passe pour activer ton compte.
        </p>
      </header>

      <div className="glass-card mx-auto max-w-sm rounded-2xl p-6">
        {checking ? (
          <div className="flex flex-col items-center gap-3 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-6 w-6 animate-spin text-gold" />
            Vérification du lien d'invitation…
          </div>
        ) : !hasSession ? (
          <p className="text-center text-sm text-muted-foreground">
            Lien d'invitation invalide ou expiré. Demande à ton administrateur de t'envoyer une
            nouvelle invitation.
          </p>
        ) : done ? (
          <div className="flex flex-col items-center gap-3 py-6 text-sm">
            <CheckCircle2 className="h-8 w-8 text-emerald-400" />
            Compte activé — redirection…
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                Nouveau mot de passe
              </span>
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full rounded-lg border border-border bg-input/50 px-3 py-2.5 text-sm outline-none focus:border-gold"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                Confirmer le mot de passe
              </span>
              <input
                type="password"
                required
                minLength={6}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full rounded-lg border border-border bg-input/50 px-3 py-2.5 text-sm outline-none focus:border-gold"
              />
            </label>
            <button
              type="submit"
              disabled={busy}
              className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl btn-gold px-4 py-3 text-sm disabled:opacity-40"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <KeyRound className="h-4 w-4" />}
              Activer mon compte
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
