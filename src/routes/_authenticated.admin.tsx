import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ChevronLeft, Loader2, Lock, Mail, ShieldCheck, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { listOrgUsers, inviteAgent, updateAgentAssignment } from "@/lib/admin.functions";
import { useAuth } from "@/hooks/use-auth";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminDashboard,
  head: () => ({ meta: [{ title: "AURUM ADMIN — Gestion des utilisateurs" }] }),
});

const MODULE_LABELS: Record<string, string> = {
  agro: "Agriculture",
  health: "Santé",
  ngo: "ONG",
  generic: "Générique",
};
const ROLE_LABELS: Record<string, string> = {
  agent: "Agent",
  supervisor: "Superviseur",
  admin: "Admin",
};
const MODULES = ["generic", "agro", "health", "ngo"];
const ROLES = ["agent", "supervisor", "admin"];

type OrgUser = {
  id: string;
  email: string;
  fullName: string;
  moduleType: string;
  roles: string[];
};

type AdminState =
  | { status: "checking" }
  | { status: "denied" }
  | { status: "error"; message: string }
  | { status: "ready" };

function AdminDashboard() {
  const { session } = useAuth();
  const listUsers = useServerFn(listOrgUsers);
  const invite = useServerFn(inviteAgent);
  const updateAssignment = useServerFn(updateAgentAssignment);

  const [state, setState] = useState<AdminState>({ status: "checking" });
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteModule, setInviteModule] = useState("generic");
  const [inviteRole, setInviteRole] = useState("agent");
  const [inviting, setInviting] = useState(false);

  async function loadUsers() {
    setLoadingUsers(true);
    try {
      const res = await listUsers({ data: undefined as any });
      setUsers(res.users);
      setState({ status: "ready" });
    } catch (e: any) {
      const msg = e?.message ?? "Erreur inconnue";
      if (msg.includes("réservé aux administrateurs")) {
        setState({ status: "denied" });
      } else {
        setState({ status: "error", message: msg });
      }
    } finally {
      setLoadingUsers(false);
    }
  }

  useEffect(() => {
    if (!session?.user) return;
    void loadUsers();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function submitInvite(e: React.FormEvent) {
    e.preventDefault();
    setInviting(true);
    try {
      await invite({
        data: { email: inviteEmail.trim(), fullName: inviteName.trim(), moduleType: inviteModule, role: inviteRole },
      });
      toast.success(`Invitation envoyée à ${inviteEmail}`);
      setInviteEmail(""); setInviteName(""); setInviteModule("generic"); setInviteRole("agent");
      setShowInvite(false);
      void loadUsers();
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de l'invitation");
    } finally {
      setInviting(false);
    }
  }

  async function changeModule(userId: string, moduleType: string) {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, moduleType } : u));
    try {
      await updateAssignment({ data: { userId, moduleType } });
      toast.success("Module mis à jour");
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la mise à jour");
      void loadUsers();
    }
  }

  async function changeRole(userId: string, role: string) {
    setUsers(prev => prev.map(u => u.id === userId ? { ...u, roles: [role] } : u));
    try {
      await updateAssignment({ data: { userId, role } });
      toast.success("Rôle mis à jour");
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la mise à jour");
      void loadUsers();
    }
  }

  if (state.status === "checking") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }

  if (state.status === "denied") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="font-display text-lg">Accès réservé aux administrateurs</p>
        <Link to="/" className="btn-gold rounded-lg px-5 py-2.5 text-sm">Retour à l'accueil</Link>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          {state.message}
        </p>
        <Link to="/" className="text-sm text-muted-foreground underline">Retour à l'accueil</Link>
      </div>
    );
  }

  return (
    <div className="px-5 pb-32 pt-8">
      <Link to="/" className="mb-6 inline-flex items-center gap-1 rounded-lg border border-border bg-card/50 px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground">
        <ChevronLeft className="h-3.5 w-3.5" /> Accueil
      </Link>

      <header className="mb-6">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Administration</p>
        <h1 className="mt-2 font-display text-3xl">
          Gestion des <span className="gold-text">utilisateurs</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Invite des agents et affecte-les à leur module métier.
        </p>
      </header>

      <button
        onClick={() => setShowInvite(v => !v)}
        className="mb-4 flex w-full items-center justify-center gap-2 rounded-xl btn-gold px-4 py-3 text-sm"
      >
        <UserPlus className="h-4 w-4" /> Inviter un nouvel agent
      </button>

      {showInvite && (
        <form onSubmit={submitInvite} className="glass-card mb-6 space-y-3 rounded-2xl p-4">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Email</span>
            <input type="email" required value={inviteEmail} onChange={e => setInviteEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Nom complet</span>
            <input required value={inviteName} onChange={e => setInviteName(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Module</span>
              <select value={inviteModule} onChange={e => setInviteModule(e.target.value)}
                className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold">
                {MODULES.map(m => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Rôle</span>
              <select value={inviteRole} onChange={e => setInviteRole(e.target.value)}
                className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold">
                {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
              </select>
            </label>
          </div>
          <button type="submit" disabled={inviting}
            className="flex w-full items-center justify-center gap-2 rounded-xl btn-gold px-4 py-2.5 text-sm disabled:opacity-40">
            {inviting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Mail className="h-4 w-4" />}
            Envoyer l'invitation
          </button>
        </form>
      )}

      <section className="glass-card rounded-2xl p-4">
        <h2 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-widest text-gold-soft">
          <ShieldCheck className="h-3.5 w-3.5" /> Utilisateurs de l'organisation ({users.length})
        </h2>

        {loadingUsers ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : users.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Aucun utilisateur pour l'instant.</p>
        ) : (
          <div className="space-y-3">
            {users.map(u => (
              <div key={u.id} className="rounded-xl border border-border bg-card/40 p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{u.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">{u.email}</p>
                  </div>
                </div>
                <div className="mt-2 grid grid-cols-2 gap-2">
                  <select
                    value={u.moduleType}
                    onChange={e => void changeModule(u.id, e.target.value)}
                    className="rounded-lg border border-border bg-input/50 px-2 py-1.5 text-xs"
                  >
                    {MODULES.map(m => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
                  </select>
                  <select
                    value={u.roles[0] ?? "agent"}
                    onChange={e => void changeRole(u.id, e.target.value)}
                    className="rounded-lg border border-border bg-input/50 px-2 py-1.5 text-xs"
                  >
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
