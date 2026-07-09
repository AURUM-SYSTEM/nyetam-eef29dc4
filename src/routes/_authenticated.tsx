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
