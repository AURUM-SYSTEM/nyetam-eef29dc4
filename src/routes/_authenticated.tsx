import { createFileRoute, Outlet, redirect } from "@tanstack/react-router";
import { Loader2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { getSessionOnce } from "@/integrations/supabase/session-once";
import { getCachedProfile, useAuth } from "@/hooks/use-auth";
import { withTimeout, TIMEOUT } from "@/lib/with-timeout";

const SESSION_CHECK_TIMEOUT_MS = 5000;

export const Route = createFileRoute("/_authenticated")({
  beforeLoad: async ({ location }) => {
    if (typeof window === "undefined") return;

    // OFFLINE-FIRST AUTH:
    // A field agent who was already authenticated on this device must be
    // able to continue collecting data without Internet. The GPS and the
    // IndexedDB queues are local capabilities; they must not depend on a
    // fresh Supabase session check.
    if (!navigator.onLine && getCachedProfile()) {
      return;
    }

    // getSessionOnce() shares the auth check with AuthProvider. Bound it so a
    // lost network never blocks the field UI indefinitely.
    const result = await withTimeout(getSessionOnce(), SESSION_CHECK_TIMEOUT_MS);
    if (result === TIMEOUT) {
      // No quick response (typically offline or token refresh retry).
      // If a previously authenticated profile exists, allow local collection.
      if (getCachedProfile()) return;
      return;
    }

    const { data } = result;
    if (!data.session) {
      // If the network is unavailable but the local profile exists, keep the
      // agent in the authenticated field workspace. Do not send them to login
      // just because Supabase cannot refresh a token offline.
      if (!navigator.onLine && getCachedProfile()) return;

      const redirectPath = location.pathname + (location.searchStr || "");
      throw redirect({ to: "/login", search: { redirect: redirectPath } });
    }

    // Role redirects are online-only because they require RPC calls.
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

  // A cached profile is sufficient to render the field workspace offline.
  // Network authentication continues in the background when available.
  if (loading && !session && !profile) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }
  return <Outlet />;
}
