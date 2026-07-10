import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    const { data } = await supabase.auth.getSession();
    if (!data.session) {
      const redirectPath = location.pathname + (location.searchStr || "");
      throw redirect({ to: "/login", search: { redirect: redirectPath } });
    }

    // Redirection par rôle — uniquement sur l'écran d'accueil de collecte.
    // platform_admin garde un accès libre à tout (collecte ET dashboards).
    // Un admin/superviseur qui navigue explicitement ailleurs (/profile,
    // /settings...) n'est jamais redirigé : seule la racine "/" est concernée.
    if (location.pathname === "/") {
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
  const { loading, session } = useAuth();

  if (loading && !session) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }
  return <Outlet />;
}
