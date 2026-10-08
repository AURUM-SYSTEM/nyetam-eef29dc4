import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useServerFn } from "@tanstack/react-start";
import { Building2, CheckCircle2, Loader2, Lock, Mail, Save, ShieldCheck, Trash2, UserPlus, XCircle } from "lucide-react";
import { toast } from "sonner";
import { listOrgUsers, inviteAgent, updateAgentAssignment, getOrgSettings, updateOrgSettings, createOrganizationWithAdmin, checkPlatformAdmin, listAllOrganizations, deleteOrganization, listOrganizationAdmins, updateOrganizationAdmin, listRoleDefinitions, listPermissionCatalog, createOrganizationRole, updateOrganizationRolePermissions, assignRoleToOrganizationUser } from "@/lib/admin.functions";
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
const ORG_TYPE_LABELS: Record<string, string> = {
  agriculture: "Agriculture",
  health: "Santé",
  ngo: "ONG",
  generic: "Générique",
};
const ORG_TYPES = ["agriculture", "health", "ngo", "generic"];

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

type OrgAdmin = {
  id: string;
  email: string;
  fullName: string;
  organizationId: string;
  organizationName: string;
  isAdmin: boolean;
};

type RoleDefinition = {
  id: string; organization_id: string | null; code: string; name: string; description: string; is_system: boolean; permissions: string[];
};
type PermissionDef = { permission: string; label: string; module: string; description: string };

type OrgSummary = {
  id: string;
  name: string;
  type: string;
  moduleType: string;
  createdAt: string;
  userCount: number;
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

  // ── Création / suppression d'organisations (réservé platform_admin) ──
  const createOrg = useServerFn(createOrganizationWithAdmin);
  const checkPlatformAdminFn = useServerFn(checkPlatformAdmin);
  const listOrgsFn = useServerFn(listAllOrganizations);
  const deleteOrgFn = useServerFn(deleteOrganization);
  const listAdminsFn = useServerFn(listOrganizationAdmins);
  const updateOrgAdminFn = useServerFn(updateOrganizationAdmin);
  const [isPlatformAdmin, setIsPlatformAdmin] = useState(false);
  const [showCreateOrg, setShowCreateOrg] = useState(false);
  const [newOrgName, setNewOrgName] = useState("");
  const [newOrgType, setNewOrgType] = useState("generic");
  const [newOrgModule, setNewOrgModule] = useState("generic");
  const [newOrgAdminEmail, setNewOrgAdminEmail] = useState("");
  const [newOrgAdminName, setNewOrgAdminName] = useState("");
  const [creatingOrg, setCreatingOrg] = useState(false);
  const [allOrgs, setAllOrgs] = useState<OrgSummary[]>([]);
  const [loadingOrgs, setLoadingOrgs] = useState(false);
  const [deletingOrgId, setDeletingOrgId] = useState<string | null>(null);
  const [orgAdmins, setOrgAdmins] = useState<OrgAdmin[]>([]);
  const [loadingOrgAdmins, setLoadingOrgAdmins] = useState(false);
  const [updatingAdminId, setUpdatingAdminId] = useState<string | null>(null);
  const listRolesFn = useServerFn(listRoleDefinitions);
  const listPermissionsFn = useServerFn(listPermissionCatalog);
  const createRoleFn = useServerFn(createOrganizationRole);
  const updateRolePermissionsFn = useServerFn(updateOrganizationRolePermissions);
  const assignRoleFn = useServerFn(assignRoleToOrganizationUser);
  const [roles, setRoles] = useState<RoleDefinition[]>([]);
  const [permissions, setPermissions] = useState<PermissionDef[]>([]);
  const [loadingRoles, setLoadingRoles] = useState(false);
  const [editingRoleId, setEditingRoleId] = useState<string | null>(null);
  const [rolePermissionsDraft, setRolePermissionsDraft] = useState<string[]>([]);
  const [savingRolePermissions, setSavingRolePermissions] = useState(false);
  const [newRoleName, setNewRoleName] = useState("");
  const [newRoleCode, setNewRoleCode] = useState("");
  const [creatingRole, setCreatingRole] = useState(false);

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

  async function loadRoles() {
    setLoadingRoles(true);
    try {
      const [rr, pp] = await Promise.all([
        listRolesFn({ data: undefined as any }),
        listPermissionsFn({ data: undefined as any }),
      ]);
      setRoles(rr.roles as RoleDefinition[]);
      setPermissions(pp.permissions as PermissionDef[]);
    } catch (e: any) {
      toast.error(e?.message ?? "Échec du chargement des rôles");
    } finally {
      setLoadingRoles(false);
    }
  }

  function startEditRole(role: RoleDefinition) {
    setEditingRoleId(role.id);
    setRolePermissionsDraft([...role.permissions]);
  }

  async function saveRolePermissions() {
    if (!editingRoleId) return;
    setSavingRolePermissions(true);
    try {
      await updateRolePermissionsFn({ data: { roleId: editingRoleId, permissions: rolePermissionsDraft } });
      toast.success("Permissions du rôle enregistrées");
      setEditingRoleId(null);
      await loadRoles();
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de l'enregistrement");
    } finally {
      setSavingRolePermissions(false);
    }
  }

  async function createRole() {
    if (!newRoleName.trim() || !newRoleCode.trim()) {
      toast.error("Nom et code du rôle requis");
      return;
    }
    setCreatingRole(true);
    try {
      await createRoleFn({ data: { name: newRoleName.trim(), code: newRoleCode.trim().toLowerCase(), permissions: [] } });
      setNewRoleName(""); setNewRoleCode("");
      toast.success("Rôle créé");
      await loadRoles();
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la création");
    } finally {
      setCreatingRole(false);
    }
  }

  async function assignUserRole(userId: string, roleCode: string) {
    try {
      await assignRoleFn({ data: { userId, roleCode } });
      toast.success("Rôle affecté");
      await loadUsers();
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de l'affectation du rôle");
    }
  }

  async function loadPlatformAdminStatus() {
    try {
      const res = await checkPlatformAdminFn({ data: undefined as any });
      setIsPlatformAdmin(res.isPlatformAdmin);
      if (res.isPlatformAdmin) { void loadAllOrgs(); void loadOrganizationAdmins(); }
      void loadRoles();
    } catch {
      setIsPlatformAdmin(false);
    }
  }

  async function loadOrganizationAdmins() {
    setLoadingOrgAdmins(true);
    try {
      const res = await listAdminsFn({ data: undefined as any });
      setOrgAdmins(res.users);
    } catch (e: any) {
      toast.error(e?.message ?? "Échec du chargement des administrateurs");
    } finally {
      setLoadingOrgAdmins(false);
    }
  }

  async function changeOrganizationAdmin(userId: string, makeAdmin: boolean) {
    setUpdatingAdminId(userId);
    try {
      await updateOrgAdminFn({ data: { userId, makeAdmin } });
      toast.success(makeAdmin ? "Administrateur ajouté" : "Administrateur retiré");
      await loadOrganizationAdmins();
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la mise à jour");
    } finally {
      setUpdatingAdminId(null);
    }
  }

  async function loadAllOrgs() {
    setLoadingOrgs(true);
    try {
      const res = await listOrgsFn({ data: undefined as any });
      setAllOrgs(res.organizations);
    } catch (e: any) {
      toast.error(e?.message ?? "Échec du chargement des organisations");
    } finally {
      setLoadingOrgs(false);
    }
  }

  async function handleDeleteOrg(org: OrgSummary) {
    if (!window.confirm(`Supprimer définitivement l'organisation « ${org.name} » ? Cette action est irréversible.`)) return;
    setDeletingOrgId(org.id);
    try {
      await deleteOrgFn({ data: { organizationId: org.id } });
      toast.success(`Organisation « ${org.name} » supprimée`);
      setAllOrgs(prev => prev.filter(o => o.id !== org.id));
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la suppression");
    } finally {
      setDeletingOrgId(null);
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
    void loadPlatformAdminStatus();
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

  async function submitCreateOrg(e: React.FormEvent) {
    e.preventDefault();
    setCreatingOrg(true);
    try {
      const res = await createOrg({
        data: {
          orgName: newOrgName.trim(),
          orgType: newOrgType,
          moduleType: newOrgModule,
          adminEmail: newOrgAdminEmail.trim(),
          adminFullName: newOrgAdminName.trim(),
        },
      });
      toast.success(`Organisation créée — un email d'invitation a été envoyé à ${res.adminEmail} pour qu'il devienne administrateur de ${res.orgName}.`);
      setNewOrgName(""); setNewOrgType("generic"); setNewOrgModule("generic");
      setNewOrgAdminEmail(""); setNewOrgAdminName("");
      setShowCreateOrg(false);
      void loadAllOrgs();
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la création de l'organisation");
    } finally {
      setCreatingOrg(false);
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
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{isPlatformAdmin ? "Super Administrateur AURUM" : "Administration de l’organisation"}</p>
        <h1 className="mt-2 font-display text-3xl">
          Centre de <span className="gold-text">contrôle AURUM</span>
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Organisations, administrateurs, utilisateurs, modules et paramètres au même endroit.
        </p>
      </header>

      <div className={`mb-4 grid grid-cols-1 gap-2 ${isPlatformAdmin ? "sm:grid-cols-2" : ""}`}>
        <button
          onClick={() => setShowInvite(v => !v)}
          className="flex w-full items-center justify-center gap-2 rounded-xl btn-gold px-4 py-3 text-sm"
        >
          <UserPlus className="h-4 w-4" /> Inviter un nouvel agent
        </button>
        <section className="glass-card mb-6 rounded-2xl p-4">
        <h2 className="mb-2 flex items-center gap-2 text-xs uppercase tracking-widest text-gold-soft">
          <Lock className="h-3.5 w-3.5" /> Rôles & permissions
        </h2>
        <p className="mb-4 text-xs text-muted-foreground">
          Un seul endroit pour définir ce que chaque rôle peut faire. Les permissions sont contrôlées côté serveur et peuvent ensuite être appliquées aux utilisateurs.
        </p>
        {loadingRoles ? (
          <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : (
          <>
            <div className="mb-4 grid gap-2 sm:grid-cols-3">
              {roles.map(role => (
                <button key={role.id} type="button" onClick={() => startEditRole(role)}
                  className={`rounded-xl border p-3 text-left ${editingRoleId === role.id ? "border-gold bg-gold/10" : "border-border bg-card/40"}`}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-medium">{role.name}</span>
                    {role.is_system && <span className="text-[10px] uppercase text-muted-foreground">Système</span>}
                  </div>
                  <p className="mt-1 text-[11px] text-muted-foreground">{role.description || role.code} · {role.permissions.length} permissions</p>
                </button>
              ))}
            </div>

            {editingRoleId && (
              <div className="mb-4 rounded-xl border border-border p-3">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-sm font-medium">Permissions du rôle</span>
                  <button type="button" onClick={() => setEditingRoleId(null)} className="text-xs text-muted-foreground">Fermer</button>
                </div>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {permissions.map(p => (
                    <label key={p.permission} className="flex cursor-pointer items-start gap-2 rounded-lg border border-border/60 p-2 text-xs">
                      <input type="checkbox" checked={rolePermissionsDraft.includes(p.permission)}
                        onChange={e => setRolePermissionsDraft(prev => e.target.checked ? [...prev, p.permission] : prev.filter(x => x !== p.permission))} />
                      <span><strong>{p.label}</strong><br/><span className="text-muted-foreground">{p.module}</span></span>
                    </label>
                  ))}
                </div>
                <button type="button" onClick={() => void saveRolePermissions()} disabled={savingRolePermissions}
                  className="mt-3 rounded-lg bg-gold px-3 py-2 text-xs font-medium text-black disabled:opacity-50">
                  {savingRolePermissions ? "Enregistrement…" : "Enregistrer les permissions"}
                </button>
              </div>
            )}

            <div className="rounded-xl border border-dashed border-border p-3">
              <p className="mb-2 text-xs font-medium">Créer un rôle personnalisé</p>
              <div className="grid gap-2 sm:grid-cols-[1fr_180px_auto]">
                <input value={newRoleName} onChange={e => setNewRoleName(e.target.value)} placeholder="Ex. Agent collecte" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                <input value={newRoleCode} onChange={e => setNewRoleCode(e.target.value)} placeholder="agent_collecte" className="rounded-lg border border-border bg-background px-3 py-2 text-sm" />
                <button type="button" onClick={() => void createRole()} disabled={creatingRole} className="rounded-lg border border-gold/40 px-3 py-2 text-xs text-gold disabled:opacity-50">
                  {creatingRole ? "…" : "Créer"}
                </button>
              </div>
            </div>
          </>
        )}
      </section>

      {isPlatformAdmin && (
          <button
            onClick={() => setShowCreateOrg(v => !v)}
            className="flex w-full items-center justify-center gap-2 rounded-xl border border-gold/40 px-4 py-3 text-sm text-gold hover:bg-gold/10"
          >
            <Building2 className="h-4 w-4" /> Créer une nouvelle organisation
          </button>
        )}
      </div>

      {isPlatformAdmin && showCreateOrg && (
        <form onSubmit={submitCreateOrg} className="glass-card mb-6 space-y-3 rounded-2xl p-4">
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Nom de l'organisation</span>
            <input required value={newOrgName} onChange={e => setNewOrgName(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Type</span>
              <select value={newOrgType} onChange={e => setNewOrgType(e.target.value)}
                className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold">
                {ORG_TYPES.map(t => <option key={t} value={t}>{ORG_TYPE_LABELS[t]}</option>)}
              </select>
            </label>
            <label className="block">
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Module principal</span>
              <select value={newOrgModule} onChange={e => setNewOrgModule(e.target.value)}
                className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold">
                {MODULES.map(m => <option key={m} value={m}>{MODULE_LABELS[m]}</option>)}
              </select>
            </label>
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Email de l'administrateur</span>
            <input type="email" required value={newOrgAdminEmail} onChange={e => setNewOrgAdminEmail(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Nom complet de l'administrateur</span>
            <input required value={newOrgAdminName} onChange={e => setNewOrgAdminName(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>
          <button type="submit" disabled={creatingOrg}
            className="flex w-full items-center justify-center gap-2 rounded-xl btn-gold px-4 py-2.5 text-sm disabled:opacity-40">
            {creatingOrg ? <Loader2 className="h-4 w-4 animate-spin" /> : <Building2 className="h-4 w-4" />}
            Créer
          </button>
        </form>
      )}

      {isPlatformAdmin && (
        <section className="glass-card mb-6 rounded-2xl p-4">
          <h2 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-widest text-gold-soft">
            <ShieldCheck className="h-3.5 w-3.5" /> Utilisateurs & administrateurs ({orgAdmins.length})
          </h2>
          <p className="mb-4 text-xs text-muted-foreground">
            Centre de contrôle du Super Administrateur AURUM : tu peux nommer ou retirer les administrateurs de chaque organisation. Ton propre accès Super Administrateur reste indépendant.
          </p>
          {loadingOrgAdmins ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : orgAdmins.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Aucun administrateur d'organisation.</p>
          ) : (
            <div className="space-y-2">
              {orgAdmins.map(a => (
                <div key={a.id} className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card/40 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{a.fullName}</p>
                    <p className="truncate text-xs text-muted-foreground">{a.email} · {a.organizationName} {a.isAdmin ? "· Administrateur" : ""}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => void changeOrganizationAdmin(a.id, !a.isAdmin)}
                    disabled={updatingAdminId === a.id}
                    className={a.isAdmin
                      ? "shrink-0 rounded-lg border border-destructive/30 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
                      : "shrink-0 rounded-lg border border-gold/40 px-2.5 py-1.5 text-xs text-gold hover:bg-gold/10 disabled:opacity-40"}
                  >
                    {updatingAdminId === a.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : a.isAdmin ? "Retirer admin" : "Nommer admin"}
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {isPlatformAdmin && (
        <section className="glass-card mb-6 rounded-2xl p-4">
          <h2 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-widest text-gold-soft">
            <Building2 className="h-3.5 w-3.5" /> Toutes les organisations ({allOrgs.length})
          </h2>

          {loadingOrgs ? (
            <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
          ) : allOrgs.length === 0 ? (
            <p className="py-6 text-center text-sm text-muted-foreground">Aucune organisation pour l'instant.</p>
          ) : (
            <div className="space-y-2">
              {allOrgs.map(o => (
                <div key={o.id} className="flex items-center justify-between gap-2 rounded-xl border border-border bg-card/40 p-3">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{o.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {ORG_TYPE_LABELS[o.type] ?? o.type} · {MODULE_LABELS[o.moduleType] ?? o.moduleType} · {o.userCount} utilisateur(s)
                    </p>
                  </div>
                  <button
                    onClick={() => void handleDeleteOrg(o)}
                    disabled={deletingOrgId === o.id}
                    className="flex shrink-0 items-center gap-1 rounded-lg border border-destructive/30 px-2.5 py-1.5 text-xs text-destructive hover:bg-destructive/10 disabled:opacity-40"
                  >
                    {deletingOrgId === o.id ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                    Supprimer
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

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
