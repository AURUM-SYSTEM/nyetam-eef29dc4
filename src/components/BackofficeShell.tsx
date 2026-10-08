// ─────────────────────────────────────────────────────────────────────────
// AURUM — Espace de gestion
//
// Sidebar fixe à gauche sur desktop, menu burger sur mobile. Concerne
// uniquement les pages backoffice (/supervisor, /admin) — l'app de
// collecte terrain (agents, mobile) garde sa propre navigation.
// ─────────────────────────────────────────────────────────────────────────
import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useState } from "react";
import { LayoutDashboard, LogOut, Menu, Settings, ShieldCheck, X } from "lucide-react";
import { useAuth } from "@/hooks/use-auth";

const NAV_ITEMS = [
  { to: "/supervisor", label: "Pilotage", icon: LayoutDashboard },
  { to: "/admin", label: "Administration", icon: ShieldCheck },
  { to: "/settings", label: "Paramètres", icon: Settings },
] as const;

function NavLinks({ pathname, onNavigate }: { pathname: string; onNavigate?: () => void }) {
  return (
    <nav className="flex flex-col gap-1">
      {NAV_ITEMS.map(({ to, label, icon: Icon }) => {
        const active = pathname === to;
        return (
          <Link
            key={to}
            to={to}
            onClick={onNavigate}
            className={
              active
                ? "flex items-center gap-2.5 rounded-lg bg-gold/10 px-3 py-2.5 text-sm font-medium text-gold"
                : "flex items-center gap-2.5 rounded-lg px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:bg-secondary/60 hover:text-foreground"
            }
          >
            <Icon className="h-4 w-4 shrink-0" />
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
    await signOut(); // appelle supabase.auth.signOut() et vide le cache profil
    void navigate({ to: "/login" });
  }

  const signOutButton = (
    <button
      onClick={() => void handleSignOut()}
      className="flex w-full items-center gap-2.5 rounded-lg border border-border px-3 py-2.5 text-sm text-muted-foreground transition-colors hover:border-gold/30 hover:text-foreground"
    >
      <LogOut className="h-4 w-4 shrink-0" />
      Déconnexion
    </button>
  );

  return (
    <div className="min-h-screen">
      {/* ── Sidebar desktop ─────────────────────────────────────────── */}
      <aside className="glass-card fixed inset-y-0 left-0 z-40 hidden w-60 flex-col rounded-none border-y-0 border-l-0 lg:flex">
        <div className="px-5 pb-4 pt-8">
          <p className="font-display text-xl">
            <span className="gold-text">AURUM</span>
          </p>
          <p className="mt-1 text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Backoffice</p>
        </div>
        <div className="flex-1 overflow-y-auto px-3">
          <NavLinks pathname={pathname} />
        </div>
        <div className="px-3 pb-6 pt-3">{signOutButton}</div>
      </aside>

      {/* ── Barre mobile + menu burger ──────────────────────────────── */}
      <header className="sticky top-0 z-40 border-b border-border bg-background/80 backdrop-blur lg:hidden">
        <div className="flex items-center justify-between px-4 py-3">
          <p className="font-display text-lg">
            <span className="gold-text">AURUM</span>{" "}
            <span className="text-xs uppercase tracking-widest text-muted-foreground">Backoffice</span>
          </p>
          <button
            onClick={() => setMobileOpen((v) => !v)}
            aria-label={mobileOpen ? "Fermer le menu" : "Ouvrir le menu"}
            aria-expanded={mobileOpen}
            className="rounded-lg border border-border p-2 text-muted-foreground hover:text-foreground"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </div>
        {mobileOpen && (
          <div className="space-y-3 border-t border-border px-3 pb-4 pt-3">
            <NavLinks pathname={pathname} onNavigate={() => setMobileOpen(false)} />
            {signOutButton}
          </div>
        )}
      </header>

      {/* ── Contenu ─────────────────────────────────────────────────── */}
      <main className="lg:pl-60">{children}</main>
    </div>
  );
}
