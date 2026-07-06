import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { zodValidator, fallback } from "@tanstack/zod-adapter";
import { z } from "zod";
import { useEffect, useState } from "react";
import { Loader2, LogIn, Sparkles, ArrowRight } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/use-auth";

const loginSearchSchema = z.object({
  redirect: fallback(z.string(), "/").default("/"),
});

export const Route = createFileRoute("/login")({
  validateSearch: zodValidator(loginSearchSchema),
  component: LoginPage,
  head: () => ({ meta: [{ title: "Connexion — AURUM SYSTEM" }] }),
});

function LoginPage() {
  const { t } = useI18n();
  const navigate = useNavigate();
  const search = Route.useSearch();
  const { session, loading } = useAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!loading && session) navigate({ to: search.redirect || "/" });
  }, [loading, session, navigate, search.redirect]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("auth.signed_in"));
    navigate({ to: search.redirect || "/" });
  }

  async function google() {
    setBusy(true);
    // OAuth Google natif Supabase (indépendant de l'hébergement Lovable).
    // Redirection pleine page ; au retour sur /login, la session détectée
    // dans l'URL déclenche la navigation via le useEffect ci-dessus.
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/login?redirect=${encodeURIComponent(search.redirect || "/")}`,
        // La passerelle Supabase (nouvelles clés sb_publishable_…) exige
        // l'apikey sur /auth/v1/authorize ; supabase-js ne l'ajoute pas lui-même.
        queryParams: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string },
      },
    });
    if (error) { toast.error(error.message); setBusy(false); }
  }

  return (
    <div className="px-5 pt-12 pb-32">
      <header className="mb-10 text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">AURUM SYSTEM</p>
        <h1 className="mt-3 font-display text-4xl">{t("auth.signin_title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("auth.signin_sub")}</p>
      </header>

      <div className="glass-card rounded-2xl p-6">
        <button
          onClick={google}
          disabled={busy}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-4 py-3 text-sm hover:border-gold/40 disabled:opacity-40"
        >
          <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.2 35 24 35c-6.1 0-11-4.9-11-11s4.9-11 11-11c2.8 0 5.3 1 7.3 2.7l5.7-5.7C33.6 7.1 29 5 24 5 12.4 5 3 14.4 3 26s9.4 21 21 21 21-9.4 21-21c0-1.9-.2-3.7-.4-5.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c2.8 0 5.3 1 7.3 2.7l5.7-5.7C33.6 7.1 29 5 24 5 16.3 5 9.5 9.4 6.3 14.7z"/><path fill="#4CAF50" d="M24 47c5.2 0 10-2 13.6-5.3l-6.3-5.3C29.3 38 26.8 39 24 39c-5.2 0-9.6-2.6-11.2-6.7l-6.5 5C9.4 42.5 16.1 47 24 47z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.4l6.3 5.3C41.2 36 45 30.5 45 26c0-1.9-.2-3.7-.4-5.5z"/></svg>
          {t("auth.google")}
        </button>

        <div className="my-5 flex items-center gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
          <div className="h-px flex-1 bg-border" /> {t("auth.or")} <div className="h-px flex-1 bg-border" />
        </div>

        <form onSubmit={submit} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">{t("auth.email")}</span>
            <input type="email" required value={email} onChange={e => setEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2.5 text-sm outline-none focus:border-gold" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">{t("auth.password")}</span>
            <input type="password" required minLength={6} value={password} onChange={e => setPassword(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2.5 text-sm outline-none focus:border-gold" />
          </label>
          <button type="submit" disabled={busy}
            className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl btn-gold px-4 py-3 text-sm disabled:opacity-40">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <LogIn className="h-4 w-4" />}
            {t("auth.signin_cta")}
          </button>
        </form>
      </div>

      <Link to="/about" className="mt-6 flex items-center justify-center gap-2 rounded-xl border border-gold/30 bg-gold/5 px-4 py-3 text-sm text-gold transition hover:bg-gold/10">
        <Sparkles className="h-4 w-4" />
        Programme pilote gratuit — 30 jours
        <ArrowRight className="h-3.5 w-3.5" />
      </Link>

      <p className="mt-4 text-center text-sm text-muted-foreground">
        {t("auth.no_account")} <Link to="/register" className="text-gold hover:underline">{t("auth.signup_cta")}</Link>
      </p>
    </div>
  );
}
