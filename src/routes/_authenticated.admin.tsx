import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, CheckCircle2, Loader2, Lock, Mail, Save, ShieldCheck, UserPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { listOrgUsers, inviteAgent, updateAgentAssignment, getOrgSettings, updateOrgSettings } from "@/lib/admin.functions";
import { listPendingModificationRequests, decideModificationRequest } from "@/lib/moderation.functions";
import { useAuth } from "@/hooks/use-auth";
import { BackofficeShell } from "@/components/BackofficeShell";

export const Route = createFileRoute("/_authenticated/admin")({
  component: AdminPage,
  head: () => ({ meta: [{ title: "AURUM ADMIN — Gestion des utilisateurs" }] }),
});

function AdminPage() {
  return (
    <BackofficeShell>
      <AdminDashboard />
    </BackofficeShell>
  );
}

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

type ModRequest = {
  id: string;
  documentTitle: string;
  requestedByName: string;
  fieldName: string;
  currentValue: unknown;
  proposedValue: unknown;
  reason: string;
  expiresAt: string;
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
  const listRequests = useServerFn(listPendingModificationRequests);
  const decideRequest = useServerFn(decideModificationRequest);
  const fetchOrgSettings = useServerFn(getOrgSettings);
  const saveOrg = useServerFn(updateOrgSettings);

  const [state, setState] = useState<AdminState>({ status: "checking" });
  const [users, setUsers] = useState<OrgUser[]>([]);
  const [loadingUsers, setLoadingUsers] = useState(false);
  const [requests, setRequests] = useState<ModRequest[]>([]);
  const [loadingRequests, setLoadingRequests] = useState(false);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  const [showInvite, setShowInvite] = useState(false);
  const [inviteEmail, setInviteEmail] = useState("");
  const [inviteName, setInviteName] = useState("");
  const [inviteModule, setInviteModule] = useState("generic");
  const [inviteRole, setInviteRole] = useState("agent");
  const [inviting, setInviting] = useState(false);

  // ── Paramètres de l'organisation ──
  const [orgLoaded, setOrgLoaded] = useState(false);
  const [orgName, setOrgName] = useState("");
  const [orgModules, setOrgModules] = useState<string[]>(MODULES);
  const [orgComplianceModules, setOrgComplianceModules] = useState<string[]>([]);
  const [orgDelay, setOrgDelay] = useState<number>(48);
  const [savingOrg, setSavingOrg] = useState(false);

  // Modules réellement activés pour l'organisation — pilotent le formulaire
  // d'invitation et le sélecteur de module par agent.
  const availableModules = orgLoaded ? orgModules : MODULES;

  async function loadOrgSettings() {
    try {
      const org = await fetchOrgSettings({ data: undefined as any });
      setOrgName(org.name);
      setOrgModules(org.enabled_modules);
      setOrgComplianceModules(org.enabled_compliance_modules);
      setOrgDelay(org.modification_request_delay_hours);
      setOrgLoaded(true);
      // Le module pré-sélectionné du formulaire d'invitation doit rester
      // dans la liste des modules activés.
      setInviteModule(prev => (org.enabled_modules.includes(prev) ? prev : org.enabled_modules[0]));
    } catch {
      // silencieux : la section users gère déjà le cas "non admin"
    }
  }

  function toggleOrgModule(m: string) {
    setOrgModules(prev => (prev.includes(m) ? prev.filter(x => x !== m) : [...prev, m]));
  }

  function toggleEudrCompliance() {
    setOrgComplianceModules(prev => (prev.includes("eudr") ? prev.filter(x => x !== "eudr") : [...prev, "eudr"]));
  }

  async function submitOrgSettings(e: React.FormEvent) {
    e.preventDefault();
    if (orgModules.length === 0) {
      toast.error("Au moins un module doit rester activé.");
      return;
    }
    if (!orgName.trim()) {
      toast.error("Le nom de l'organisation est requis.");
      return;
    }
    setSavingOrg(true);
    try {
      await saveOrg({
        data: {
          name: orgName.trim(),
          enabledModules: orgModules,
          enabledComplianceModules: orgComplianceModules,
          modificationRequestDelayHours: Math.max(1, Math.round(orgDelay)),
        },
      });
      toast.success("Organisation mise à jour");
      void loadOrgSettings();
    } catch (err: any) {
      toast.error(err?.message ?? "Échec de la mise à jour");
    } finally {
      setSavingOrg(false);
    }
  }

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

  async function loadRequests() {
    setLoadingRequests(true);
    try {
      const res = await listRequests({ data: undefined as any });
      setRequests(res.requests);
    } catch (e: any) {
      // silencieux : la section users a déjà géré le cas "non admin"
    } finally {
      setLoadingRequests(false);
    }
  }

  useEffect(() => {
    if (!session?.user) return;
    void loadUsers();
    void loadRequests();
    void loadOrgSettings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session?.user?.id]);

  async function decide(requestId: string, decision: "approved" | "rejected") {
    setDecidingId(requestId);
    try {
      await decideRequest({ data: { requestId, decision } });
      toast.success(decision === "approved" ? "Modification approuvée et appliquée" : "Demande rejetée");
      setRequests(prev => prev.filter(r => r.id !== requestId));
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la décision");
    } finally {
      setDecidingId(null);
    }
  }

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
                {availableModules.map(m => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
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

      {requests.length > 0 && (
        <section className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <h2 className="mb-3 text-xs uppercase tracking-widest text-amber-300">
            Demandes de modification en attente ({requests.length})
          </h2>
          <div className="space-y-3">
            {requests.map(r => (
              <div key={r.id} className="rounded-xl border border-amber-500/20 bg-card/40 p-3">
                <p className="text-sm font-medium">{r.documentTitle}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Par {r.requestedByName} — champ « {r.fieldName} »
                </p>
                <p className="mt-1 text-xs text-amber-200/90">
                  {JSON.stringify(r.currentValue)} → {JSON.stringify(r.proposedValue)}
                </p>
                <p className="mt-1 text-xs text-muted-foreground italic">« {r.reason} »</p>
                <p className="mt-1 text-[10px] text-muted-foreground">
                  Auto-approuvée le {new Date(r.expiresAt).toLocaleString("fr-FR")} si aucune décision
                </p>
                <div className="mt-2 flex gap-2">
                  <button
                    onClick={() => void decide(r.id, "approved")}
                    disabled={decidingId === r.id}
                    className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs text-emerald-400 disabled:opacity-40"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Approuver
                  </button>
                  <button
                    onClick={() => void decide(r.id, "rejected")}
                    disabled={decidingId === r.id}
                    className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground disabled:opacity-40"
                  >
                    <XCircle className="h-3.5 w-3.5" /> Rejeter
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="glass-card mb-6 rounded-2xl p-4">
        <h2 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-widest text-gold-soft">
          <Building2 className="h-3.5 w-3.5" /> Organisation
        </h2>

        {!orgLoaded ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : (
          <form onSubmit={submitOrgSettings} className="space-y-3">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Nom de l'organisation</span>
              <input required value={orgName} onChange={e => setOrgName(e.target.value)}
                className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
            </label>

            <div>
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Modules activés</span>
              <div className="grid grid-cols-2 gap-2">
                {MODULES.map(m => (
                  <label
                    key={m}
                    className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                      orgModules.includes(m) ? "border-gold bg-gold/10 text-gold" : "border-border text-muted-foreground"
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={orgModules.includes(m)}
                      onChange={() => toggleOrgModule(m)}
                      className="accent-[var(--gold)]"
                    />
                    {MODULE_LABELS[m]}
                  </label>
                ))}
              </div>
              {orgModules.length === 0 && (
                <p className="mt-1 text-xs text-destructive">Au moins un module doit rester activé.</p>
              )}
            </div>

            <div>
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Extensions de conformité</span>
              <label
                className={`flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm ${
                  orgComplianceModules.includes("eudr") ? "border-gold bg-gold/10 text-gold" : "border-border text-muted-foreground"
                }`}
              >
                <input
                  type="checkbox"
                  checked={orgComplianceModules.includes("eudr")}
                  onChange={toggleEudrCompliance}
                  className="accent-[var(--gold)]"
                />
                Conformité EUDR
              </label>
              <p className="mt-1 text-xs text-muted-foreground">
                Extension du module Agriculture — n'apparaît que si ce module est activé.
              </p>
            </div>

            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                Délai d'auto-approbation des demandes de modification (heures)
              </span>
              <input
                type="number" min={1} max={720} required value={orgDelay}
                onChange={e => setOrgDelay(Number(e.target.value))}
                className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold"
              />
            </label>

            <button type="submit" disabled={savingOrg || orgModules.length === 0}
              className="flex w-full items-center justify-center gap-2 rounded-xl btn-gold px-4 py-2.5 text-sm disabled:opacity-40">
              {savingOrg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              Enregistrer
            </button>
          </form>
        )}
      </section>

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
                    {/* Si le module actuel de l'agent a été désactivé, on le
                        garde visible (non sélectionnable) pour ne pas fausser
                        l'affichage ni écraser la valeur par accident. */}
                    {!availableModules.includes(u.moduleType) && (
                      <option value={u.moduleType} disabled>
                        {MODULE_LABELS[u.moduleType] ?? u.moduleType} (désactivé)
                      </option>
                    )}
                    {availableModules.map(m => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
                  </select>
                  {/* Sur sa propre ligne, le rôle n'est pas modifiable : évite
                      de se retirer soi-même l'accès admin par accident (un
                      autre admin peut toujours le faire). */}
                  <select
                    value={u.roles[0] ?? "agent"}
                    onChange={e => void changeRole(u.id, e.target.value)}
                    disabled={u.id === session?.user?.id}
                    title={u.id === session?.user?.id ? "Vous ne pouvez pas modifier votre propre rôle" : undefined}
                    className="rounded-lg border border-border bg-input/50 px-2 py-1.5 text-xs disabled:opacity-50"
                  >
                    {ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                  </select>
                </div>
                {u.id === session?.user?.id && (
                  <p className="mt-1.5 text-[10px] text-muted-foreground">
                    Votre compte — le rôle ne peut être modifié que par un autre admin.
                  </p>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
