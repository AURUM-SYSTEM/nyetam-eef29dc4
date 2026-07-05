// ─────────────────────────────────────────────────────────────────────────
// AURUM SUPERVISOR — Tableau de bord (V2, données réelles)
//
// Prérequis (Phase 1 du ROADMAP, maintenant en place) :
//   - table `organizations`
//   - table `user_roles` + fonction `has_role()`
//   - policies RLS additives sur `documents` et `profiles`
//
// V2.1 : ajout de la demande de modification (superviseur → admin), voir
// `src/lib/moderation.functions.ts`. Une donnée validée ne peut plus être
// modifiée directement par le superviseur — il soumet une demande, journalisée
// et gouvernée par un délai d'approbation automatique (pg_cron côté DB).
//
// Cette page ne modifie AUCUN fichier de la partie COLLECT existante et
// ne touche à aucune policy RLS existante (uniquement des ajouts).
// ─────────────────────────────────────────────────────────────────────────
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState, Fragment } from "react";
import { useServerFn } from "@tanstack/react-start";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  Radio,
  Users,
} from "lucide-react";
import { toast } from "sonner";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip as RechartsTooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import type { ModuleType } from "@/lib/offline-store";
import { requestModification } from "@/lib/moderation.functions";

export const Route = createFileRoute("/_authenticated/supervisor")({
  component: SupervisorDashboard,
  head: () => ({
    meta: [
      { title: "AURUM SUPERVISOR — Tableau de bord" },
      { name: "description", content: "Supervision des activités terrain — activités, carte, statistiques, alertes." },
    ],
  }),
});

// ── Types ────────────────────────────────────────────────────────────────

type DocRow = {
  id: string;
  user_id: string;
  module_type: ModuleType | null;
  title: string | null;
  status: string | null;
  location: string | null;
  location_data: { lat?: number; lng?: number; city?: string } | null;
  created_at: string;
};

type ProfileRow = {
  id: string;
  full_name: string | null;
};

const MODULE_LABELS: Record<string, string> = {
  agro: "Agriculture",
  health: "Santé",
  ngo: "ONG",
  generic: "Générique",
};

const MODULE_COLORS: Record<string, string> = {
  agro: "oklch(0.72 0.15 145)",
  health: "oklch(0.65 0.2 25)",
  ngo: "oklch(0.7 0.15 250)",
  generic: "var(--gold)",
};

function moduleLabel(m: string | null) {
  return MODULE_LABELS[m ?? "generic"] ?? m ?? "Générique";
}
function moduleColor(m: string | null) {
  return MODULE_COLORS[m ?? "generic"] ?? "var(--gold)";
}

// ── Vérification du rôle superviseur ────────────────────────────────────

type RoleState =
  | { status: "checking" }
  | { status: "denied" }
  | { status: "error"; message: string }
  | { status: "authorized" };

function useSupervisorRole() {
  const { session } = useAuth();
  const [state, setState] = useState<RoleState>({ status: "checking" });

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!session?.user) return; // le layout _authenticated gère déjà le login
      const { data, error } = await supabase.rpc("has_role", {
        _user: session.user.id,
        _role: "supervisor",
      });
      if (cancelled) return;
      if (error) {
        setState({ status: "error", message: error.message });
        return;
      }
      setState(data ? { status: "authorized" } : { status: "denied" });
    }

    void check();
    return () => {
      cancelled = true;
    };
  }, [session?.user?.id]);

  return state;
}

// ── Chargement des données réelles ─────────────────────────────────────

function useSupervisorData() {
  const [docs, setDocs] = useState<DocRow[]>([]);
  const [profilesById, setProfilesById] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);

    const { data: docsData, error: docsError } = await supabase
      .from("documents")
      .select("id, user_id, module_type, title, status, location, location_data, created_at")
      .order("created_at", { ascending: false })
      .limit(500);

    if (docsError) {
      setError(docsError.message);
      setLoading(false);
      return;
    }

    const userIds = Array.from(new Set((docsData ?? []).map((d) => d.user_id)));
    let profileMap: Record<string, string> = {};

    if (userIds.length > 0) {
      const { data: profilesData } = await supabase
        .from("profiles")
        .select("id, full_name")
        .in("id", userIds);

      profileMap = Object.fromEntries(
        ((profilesData ?? []) as ProfileRow[]).map((p) => [p.id, p.full_name || "Agent"]),
      );
    }

    setDocs((docsData ?? []) as DocRow[]);
    setProfilesById(profileMap);
    setLoading(false);
  }

  useEffect(() => {
    void load();
  }, []);

  return { docs, profilesById, loading, error, reload: load };
}

// ── Petite carte en CSS pur ──────────────────────────────────────────────

function MiniMap({ docs }: { docs: DocRow[] }) {
  const points = docs
    .map((d) => ({ id: d.id, module_type: d.module_type, ...d.location_data }))
    .filter((p): p is { id: string; module_type: string | null; lat: number; lng: number; city?: string } =>
      typeof p.lat === "number" && typeof p.lng === "number",
    );

  if (points.length === 0) {
    return (
      <div className="flex h-64 w-full items-center justify-center rounded-xl border border-border bg-secondary/40 text-sm text-muted-foreground">
        Aucune coordonnée GPS disponible pour le moment.
      </div>
    );
  }

  const lats = points.map((p) => p.lat);
  const lngs = points.map((p) => p.lng);
  const minLat = Math.min(...lats);
  const maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs);
  const maxLng = Math.max(...lngs);

  const pad = 0.06;
  const spanLat = Math.max(maxLat - minLat, 0.5);
  const spanLng = Math.max(maxLng - minLng, 0.5);

  return (
    <div className="relative h-64 w-full overflow-hidden rounded-xl border border-border bg-secondary/40">
      <div className="absolute inset-3 rounded-lg border border-dashed border-border/60" />
      {points.map((p) => {
        const x = pad + ((p.lng - minLng) / spanLng) * (1 - 2 * pad);
        const y = pad + (1 - (p.lat - minLat) / spanLat) * (1 - 2 * pad);
        return (
          <div
            key={p.id}
            title={`${moduleLabel(p.module_type)}${p.city ? " · " + p.city : ""}`}
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background/80 transition-transform hover:scale-150"
            style={{ left: `${x * 100}%`, top: `${y * 100}%`, backgroundColor: moduleColor(p.module_type) }}
          />
        );
      })}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-background/70 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
        <MapPin className="h-3 w-3" /> {points.length} points
      </div>
    </div>
  );
}

// ── Formulaire compact de demande de modification ────────────────────────

function ModificationRequestRow({ doc, onClose }: { doc: DocRow; onClose: () => void }) {
  const submit = useServerFn(requestModification);
  const [fieldName, setFieldName] = useState<"title" | "location">("title");
  const [proposedValue, setProposedValue] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  const currentValue = fieldName === "title" ? doc.title ?? "" : doc.location ?? "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!proposedValue.trim() || !reason.trim()) {
      toast.error("Renseigne la nouvelle valeur et la justification.");
      return;
    }
    setBusy(true);
    try {
      await submit({
        data: {
          documentId: doc.id,
          fieldName,
          currentValue: [currentValue],
          proposedValue: [proposedValue.trim()],
          reason: reason.trim(),
        },
      });
      toast.success("Demande envoyée à l'administrateur");
      onClose();
    } catch (err: any) {
      toast.error(err?.message ?? "Échec de l'envoi");
    } finally {
      setBusy(false);
    }
  }

  return (
    <TableRow>
      <TableCell colSpan={7} className="bg-card/30">
        <form onSubmit={handleSubmit} className="space-y-2 py-2">
          <div className="grid grid-cols-2 gap-2">
            <select
              value={fieldName}
              onChange={(e) => setFieldName(e.target.value as "title" | "location")}
              className="rounded-lg border border-border bg-input px-2 py-1.5 text-xs"
            >
              <option value="title">Titre</option>
              <option value="location">Lieu</option>
            </select>
            <input
              value={proposedValue}
              onChange={(e) => setProposedValue(e.target.value)}
              placeholder={`Nouvelle valeur (actuel : ${currentValue || "—"})`}
              className="rounded-lg border border-border bg-input px-2 py-1.5 text-xs"
            />
          </div>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Justification de la correction"
            className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs"
          />
          <div className="flex gap-2">
            <button type="submit" disabled={busy} className="btn-gold rounded-lg px-3 py-1.5 text-xs disabled:opacity-40">
              {busy ? "Envoi…" : "Envoyer la demande"}
            </button>
            <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">
              Annuler
            </button>
          </div>
        </form>
      </TableCell>
    </TableRow>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

function SupervisorDashboard() {
  const roleState = useSupervisorRole();

  if (roleState.status === "checking") {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }

  if (roleState.status === "denied") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-4 px-6 text-center">
        <Lock className="h-8 w-8 text-muted-foreground" />
        <p className="font-display text-lg">Accès réservé aux superviseurs</p>
        <p className="max-w-xs text-sm text-muted-foreground">
          Ton compte n'a pas encore le rôle superviseur sur cette organisation.
        </p>
        <Link to="/" className="btn-gold rounded-lg px-5 py-2.5 text-sm">
          Retour à l'accueil
        </Link>
      </div>
    );
  }

  if (roleState.status === "error") {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Erreur lors de la vérification du rôle : {roleState.message}
        </p>
        <Link to="/" className="text-sm text-muted-foreground underline">
          Retour à l'accueil
        </Link>
      </div>
    );
  }

  return <SupervisorDashboardContent />;
}

function SupervisorDashboardContent() {
  const { docs, profilesById, loading, error, reload } = useSupervisorData();

  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "ready">("all");
  const [validated, setValidated] = useState<Set<string>>(new Set());
  const [requestingId, setRequestingId] = useState<string | null>(null);

  const agentOptions = useMemo(
    () => Array.from(new Set(Object.values(profilesById))).sort(),
    [profilesById],
  );
  const moduleOptions = useMemo(
    () => Array.from(new Set(docs.map((d) => d.module_type || "generic"))),
    [docs],
  );

  const filteredDocs = docs.filter((d) => {
    const agentName = profilesById[d.user_id] || "Agent";
    if (moduleFilter !== "all" && (d.module_type || "generic") !== moduleFilter) return false;
    if (agentFilter !== "all" && agentName !== agentFilter) return false;
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    return true;
  });

  const total = docs.length;
  const activeAgents = new Set(docs.map((d) => d.user_id)).size;
  const todayCount = docs.filter(
    (d) => new Date(d.created_at).toDateString() === new Date().toDateString(),
  ).length;
  const syncRate = total === 0 ? 0 : Math.round((docs.filter((d) => d.status === "ready").length / total) * 100);

  const byDay = useMemo(() => {
    const days: { day: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const label = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
      const count = docs.filter(
        (doc) => new Date(doc.created_at).toDateString() === d.toDateString(),
      ).length;
      days.push({ day: label, count });
    }
    return days;
  }, [docs]);

  const alerts = useMemo(() => {
    const lastByAgent = new Map<string, number>();
    docs.forEach((d) => {
      const agentName = profilesById[d.user_id] || "Agent";
      const t = +new Date(d.created_at);
      if (!lastByAgent.has(agentName) || t > lastByAgent.get(agentName)!) {
        lastByAgent.set(agentName, t);
      }
    });
    const now = Date.now();
    return Array.from(lastByAgent.entries())
      .map(([agent, last]) => ({ agent, hoursAgo: Math.round((now - last) / 3_600_000) }))
      .filter((a) => a.hoursAgo > 48)
      .sort((a, b) => b.hoursAgo - a.hoursAgo);
  }, [docs, profilesById]);

  function toggleValidate(id: string) {
    setValidated((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  if (loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-5 pt-8">
        <p className="rounded-lg border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive">
          Erreur de chargement : {error}
        </p>
        <button onClick={() => reload()} className="btn-gold mt-4 rounded-lg px-4 py-2 text-sm">
          Réessayer
        </button>
      </div>
    );
  }

  return (
    <div className="px-5 pb-32 pt-8">
      <div className="mb-6 flex items-center justify-between gap-2">
        <Link
          to="/"
          className="flex items-center gap-1 rounded-lg border border-border bg-card/50 px-2.5 py-2 text-xs text-muted-foreground hover:text-foreground"
        >
          <ChevronLeft className="h-3.5 w-3.5" /> Accueil agent
        </Link>
        <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-[10px] uppercase tracking-widest text-emerald-400">
          Données réelles
        </span>
      </div>

      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Supervision</p>
        <h1 className="mt-2 font-display text-3xl leading-tight sm:text-4xl">
          Tableau de bord <span className="gold-text">Superviseur</span>
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Vue d'ensemble des activités terrain de ton organisation, en temps réel.
        </p>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard icon={Activity} label="Total activités" value={total} />
        <MetricCard icon={Users} label="Agents actifs" value={activeAgents} />
        <MetricCard icon={Radio} label="Aujourd'hui" value={todayCount} />
        <MetricCard icon={CheckCircle2} label="Taux de synchro" value={`${syncRate}%`} />
      </section>

      <section className="glass-card mb-6 rounded-2xl p-5">
        <h2 className="mb-3 font-display text-lg">Répartition géographique</h2>
        <MiniMap docs={docs} />
        <div className="mt-3 flex flex-wrap gap-3">
          {moduleOptions.map((m) => (
            <div key={m} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="h-2 w-2 rounded-full" style={{ backgroundColor: moduleColor(m) }} />
              {moduleLabel(m)}
            </div>
          ))}
        </div>
      </section>

      <section className="glass-card mb-6 rounded-2xl p-5">
        <h2 className="mb-3 font-display text-lg">Activité — 14 derniers jours</h2>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={{ stroke: "var(--border)" }} tickLine={false} />
              <YAxis allowDecimals={false} tick={{ fill: "var(--muted-foreground)", fontSize: 10 }} axisLine={false} tickLine={false} width={24} />
              <RechartsTooltip contentStyle={{ background: "var(--card)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }} />
              <Bar dataKey="count" fill="var(--gold)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {alerts.length > 0 && (
        <section className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg text-amber-300">
            <AlertTriangle className="h-4 w-4" /> Alertes — agents inactifs
          </h2>
          <ul className="space-y-1.5 text-sm">
            {alerts.map((a) => (
              <li key={a.agent} className="flex items-center justify-between text-amber-200/90">
                <span>{a.agent}</span>
                <span className="text-xs text-amber-300/70">Dernière saisie il y a {a.hoursAgo}h</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="glass-card rounded-2xl p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg">Activités récentes</h2>
          <div className="flex flex-wrap gap-2">
            <select value={moduleFilter} onChange={(e) => setModuleFilter(e.target.value)} className="rounded-lg border border-border bg-input px-2 py-1.5 text-xs">
              <option value="all">Tous les modules</option>
              {moduleOptions.map((m) => (
                <option key={m} value={m}>{moduleLabel(m)}</option>
              ))}
            </select>
            <select value={agentFilter} onChange={(e) => setAgentFilter(e.target.value)} className="rounded-lg border border-border bg-input px-2 py-1.5 text-xs">
              <option value="all">Tous les agents</option>
              {agentOptions.map((a) => (
                <option key={a} value={a}>{a}</option>
              ))}
            </select>
            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as "all" | "draft" | "ready")} className="rounded-lg border border-border bg-input px-2 py-1.5 text-xs">
              <option value="all">Tous les statuts</option>
              <option value="ready">Synchronisé</option>
              <option value="draft">Brouillon</option>
            </select>
          </div>
        </div>

        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Agent</TableHead>
              <TableHead>Module</TableHead>
              <TableHead>Titre</TableHead>
              <TableHead>Lieu</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Statut</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDocs.slice(0, 30).map((d) => (
              <Fragment key={d.id}>
                <TableRow>
                  <TableCell className="font-medium">{profilesById[d.user_id] || "Agent"}</TableCell>
                  <TableCell>
                    <span
                      className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider"
                      style={{
                        backgroundColor: `color-mix(in oklch, ${moduleColor(d.module_type)} 18%, transparent)`,
                        color: moduleColor(d.module_type),
                      }}
                    >
                      {moduleLabel(d.module_type)}
                    </span>
                  </TableCell>
                  <TableCell className="max-w-[180px] truncate">{d.title || "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{d.location_data?.city || d.location || "—"}</TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(d.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </TableCell>
                  <TableCell>
                    <span className={d.status === "ready" ? "text-xs text-emerald-400" : "text-xs text-muted-foreground"}>
                      {d.status === "ready" ? "Synchronisé" : "Brouillon"}
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1.5">
                      <button
                        onClick={() => setRequestingId(requestingId === d.id ? null : d.id)}
                        title="Demander une modification"
                        className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={() => toggleValidate(d.id)}
                        className={
                          validated.has(d.id)
                            ? "rounded-lg bg-emerald-500/15 px-2.5 py-1 text-xs text-emerald-400"
                            : "rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
                        }
                      >
                        {validated.has(d.id) ? "Validé ✓" : "Valider"}
                      </button>
                    </div>
                  </TableCell>
                </TableRow>
                {requestingId === d.id && (
                  <ModificationRequestRow doc={d} onClose={() => setRequestingId(null)} />
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>

        {filteredDocs.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">Aucune activité ne correspond à ces filtres.</p>
        )}
        {filteredDocs.length > 30 && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {filteredDocs.length - 30} activités supplémentaires non affichées (pagination à ajouter).
          </p>
        )}
      </section>
    </div>
  );
}

function MetricCard({ icon: Icon, label, value }: { icon: typeof Activity; label: string; value: string | number }) {
  return (
    <div className="glass-card rounded-xl p-4">
      <div className="flex items-center gap-2 text-muted-foreground">
        <Icon className="h-3.5 w-3.5" />
        <span className="text-[10px] uppercase tracking-wider">{label}</span>
      </div>
      <div className="mt-2 font-display text-2xl">{value}</div>
    </div>
  );
}
