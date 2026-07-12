import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSessionOnce } from "@/integrations/supabase/session-once";
import { useAuth } from "@/hooks/use-auth";
import { withTimeout, TIMEOUT } from "@/lib/with-timeout";

const SESSION_CHECK_TIMEOUT_MS = 5000;

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;

    // getSessionOnce() partage l'appel réseau avec AuthProvider (use-auth.ts)
    // — sans ça, les deux déclenchaient chacun leur propre vérification lente
    // (jusqu'à 5s chacun), perçues comme un double délai avant que la page ne
    // s'affiche.
    const result = await withTimeout(getSessionOnce(), SESSION_CHECK_TIMEOUT_MS);
    if (result === TIMEOUT) {
      // Pas de réponse rapide (typiquement hors-ligne, pendant que le SDK
      // Supabase retente un rafraîchissement de jeton en arrière-plan) — on
      // laisse passer plutôt que de rediriger vers /login à tort ; le reste
      // de l'app gère déjà le hors-ligne au niveau de chaque appel réseau.
      return;
    }

    const { data } = result;
    if (!data.session) {
      const redirectPath = location.pathname + (location.searchStr || "");
      throw redirect({ to: "/login", search: { redirect: redirectPath } });
    }

    // Redirection par rôle — uniquement sur l'écran d'accueil de collecte, et
    // seulement si le réseau semble disponible (chaque vérification est un
    // appel RPC ; hors-ligne, mieux vaut laisser l'agent sur l'écran de
    // collecte que d'attendre plusieurs appels voués à l'échec).
    // platform_admin garde un accès libre à tout (collecte ET dashboards).
    // Un admin/superviseur qui navigue explicitement ailleurs (/profile,
    // /settings...) n'est jamais redirigé : seule la racine "/" est concernée.
    if (location.pathname === "/" && navigator.onLine) {
      const userId = data.session.user.id;
      const { data: isPlatformAdmin } = await supabase.rpc("has_role", {
        _user: userId,
        _role: "platform_admin",
      });
      if (!isPlatformAdmin) {
        const { data: isAdmin } = await supabase.rpc("has_role", { _user: userId, _role: "admin" });
        if (isAdmin) throw redirect({ to: "/admin" });

        const { data: isSupervisor } = await supabase.rpc("has_role", { _user: userId, _role: "supervisor" });
        if (isSupervisor) throw redirect({ to: "/supervisor" });
      }
    }
  },
  component: AuthLayout,
});

function AuthLayout() {
  const { loading, session, profile } = useAuth();

  // Un profil déjà en cache (localStorage, restauré instantanément par
  // AuthProvider) suffit à afficher l'écran tout de suite — inutile
  // d'attendre la confirmation réseau de la session avant de rendre une UI
  // que l'agent a déjà vue par le passé. La vérification fraîche continue
  // en arrière-plan et met à jour session/profile normalement à l'arrivée.
  if (loading && !session && !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }
  return <Outlet />;
}
