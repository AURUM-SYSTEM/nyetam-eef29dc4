import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { getSessionOnce } from "@/integrations/supabase/session-once";
import { getCachedProfile, useAuth } from "@/hooks/use-auth";
import { withTimeout, TIMEOUT } from "@/lib/with-timeout";

const SESSION_CHECK_TIMEOUT_MS = 5000;

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;
    if (!navigator.onLine && getCachedProfile()) return;

    const result = await withTimeout(getSessionOnce(), SESSION_CHECK_TIMEOUT_MS);
    if (result === TIMEOUT) {
      if (getCachedProfile()) return;
      return;
    }

    const { data } = result;
    if (!data.session) {
      if (!navigator.onLine && getCachedProfile()) return;
      const redirectPath = location.pathname + (location.searchStr || "");
      throw redirect({ to: "/login", search: { redirect: redirectPath } });
    }

    // One adaptive dashboard: organization/modules drive the UI;
    // roles and permissions control actions inside those modules.
  },
  component: AuthLayout,
});

function AuthLayout() {
  const { loading, session, profile } = useAuth();

  if (loading && !session && !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }
  return <Outlet />;
}
