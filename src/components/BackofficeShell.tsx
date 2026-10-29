// ─────────────────────────────────────────────────────────────────────────
// AURUM — Espace de gestion
// Sidebar premium sur ordinateur, navigation compacte sur mobile.
// La collecte terrain conserve sa propre navigation.
// ─────────────────────────────────────────────────────────────────────────
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { Coins, LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, X, Sprout } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const NAV_ITEMS = [
  { to: "/supervisor", label: "Tableau de bord", icon: LayoutDashboard },
  { to: "/admin", label: "Administration", icon: ShieldCheck },
  { to: "/commissions", label: "Commissions", icon: Coins },
  { to: "/settings", label: "Paramètres", icon: Settings },
] as const;

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav aria-label="Navigation principale" className="flex flex-col gap-1.5">
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
        const active = pathname === to;
        return (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            className={
              active
                ? "relative flex items-center gap-3 rounded-xl border border-white/10 bg-white/10 px-3 py-3 text-sm font-semibold text-white shadow-sm before:absolute before:inset-y-2 before:left-0 before:w-1 before:rounded-r-full before:bg-[#d7b45b]"
                : "flex items-center gap-3 rounded-xl px-3 py-3 text-sm text-white/70 transition-colors hover:bg-white/[0.07] hover:text-white"
            }
          >
            <Icon className={`h-[18px] w-[18px] shrink-0 ${active ? "text-[#e2c675]" : ""}`} />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export function BackofficeShell({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const { signOut } = useAuth();
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const [mobileOpen, setMobileOpen] = useState(false);

  async function handleSignOut() {
    await signOut();
    void navigate({ to: "/login" });
  }

  const signOutButton = (
    <button
      onClick={() => void handleSignOut()}
      className="flex w-full items-center gap-3 rounded-xl border border-white/15 px-3 py-3 text-sm text-white/70 transition-colors hover:border-white/30 hover:bg-white/[0.06] hover:text-white"
    >
      <LogOut className="h-[18px] w-[18px] shrink-0" />
      Déconnexion
    </button>
  );

  return (
    <div className="min-h-screen bg-background">
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-[252px] flex-col border-r border-white/10 bg-[#082f24] text-white shadow-xl lg:flex">
        <div className="border-b border-white/10 px-6 pb-6 pt-7">
          <div className="flex items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-[#d7b45b]/30 bg-[#d7b45b]/10 text-[#e2c675]">
              <Sprout className="h-6 w-6" />
            </span>
            <div>
              <p className="font-display text-[22px] leading-none tracking-wide text-[#e2c675]">AURUM</p>
              <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.32em] text-white/75">AGRO</p>
            </div>
          </div>
          <p className="mt-5 text-[10px] font-medium uppercase tracking-[0.2em] text-white/45">Espace professionnel</p>
        </div>
        <div className="flex-1 overflow-y-auto px-3 py-5">
          <p className="mb-3 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-white/40">Navigation</p>
          <NavLinks pathname={pathname} />
        </div>
        <div className="border-t border-white/10 px-3 py-4">
          <p className="mb-3 px-3 text-[10px] leading-4 text-white/40">Plateforme de gestion et de traçabilité agricole</p>
          {signOutButton}
        </div>
      </aside>

      <header className="sticky top-0 z-40 border-b border-border/80 bg-background/95 shadow-sm backdrop-blur lg:hidden">
        <div className="flex min-h-[64px] items-center justify-between gap-3 px-4 py-3">
          <div className="flex min-w-0 items-center gap-2.5">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[#082f24] text-[#e2c675]">
              <Sprout className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="font-display text-lg leading-none"><span className="gold-text">AURUM</span> <span className="text-foreground">AGRO</span></p>
              <p className="mt-1 text-[9px] font-medium uppercase tracking-[0.16em] text-muted-foreground">Espace de supervision</p>
            </div>
          </div>
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={mobileOpen}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border bg-card text-foreground transition-colors hover:bg-secondary"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {mobileOpen && (
          <div className="space-y-3 border-t border-white/10 bg-[#082f24] px-3 pb-4 pt-3">
            <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            {signOutButton}
          </div>
        )}
      </header>

      <main className="min-h-screen lg:pl-[252px]">{children}</main>
    </div>
  );
}
