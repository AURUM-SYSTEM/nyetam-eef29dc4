// ─────────────────────────────────────────────────────────────────────────
// AURUM SUPERVISOR — Tableau de bord (V1, données de test)
//
// ⚠️ Cette page utilise des DONNÉES DE TEST générées côté client.
// Les rôles (agent / superviseur / admin) et la table `organizations`
// n'existent pas encore côté base (voir docs/ROADMAP.md, Phase 1 & 2).
// Tant qu'ils ne sont pas ajoutés, on ne peut pas interroger les vraies
// données `documents` cross-utilisateurs : les policies RLS actuelles
// limitent chaque agent à ses propres lignes, à raison.
//
// TODO (Phase 1 + 2 du ROADMAP) : une fois `user_roles` et `organizations`
// en place, remplacer `generateMockDocuments()` par une vraie requête
// Supabase filtrée par organisation, gardée par `has_role(auth.uid(), 'supervisor')`.
//
// Cette page ne modifie AUCUN fichier de la partie COLLECT existante.
// ─────────────────────────────────────────────────────────────────────────
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  ChevronLeft,
  MapPin,
  Radio,
  Users,
} from "lucide-react";
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
import type { ModuleType } from "@/lib/offline-store";

export const Route = createFileRoute("/_authenticated/supervisor")({
  component: SupervisorDashboard,
  head: () => ({
    meta: [
      { title: "AURUM SUPERVISOR — Tableau de bord" },
      { name: "description", content: "Supervision des activités terrain — activités, carte, statistiques, alertes." },
    ],
  }),
});

// ── Données de test ─────────────────────────────────────────────────────

type MockDoc = {
  id: string;
  agent_name: string;
  module_type: ModuleType;
  title: string;
  status: "draft" | "ready";
  location_city: string;
  lat: number;
  lng: number;
  created_at: string; // ISO
};

const MODULE_LABELS: Record<ModuleType, string> = {
  agro: "Agriculture",
  health: "Santé",
  ngo: "ONG",
  generic: "Générique",
};

const MODULE_COLORS: Record<ModuleType, string> = {
  agro: "oklch(0.72 0.15 145)",
  health: "oklch(0.65 0.2 25)",
  ngo: "oklch(0.7 0.15 250)",
  generic: "var(--gold)",
};

const AGENTS = ["Awa N.", "Brice T.", "Chantal M.", "David K.", "Estelle F."];

// Villes du Cameroun avec coordonnées approximatives — sert uniquement
// à donner une répartition géographique réaliste aux données de test.
const CITIES: { name: string; lat: number; lng: number }[] = [
  { name: "Douala", lat: 4.0511, lng: 9.7679 },
  { name: "Yaoundé", lat: 3.848, lng: 11.5021 },
  { name: "Bafoussam", lat: 5.4737, lng: 10.4176 },
  { name: "Garoua", lat: 9.3017, lng: 13.3921 },
  { name: "Maroua", lat: 10.591, lng: 14.3159 },
  { name: "Bamenda", lat: 5.9631, lng: 10.1591 },
];

const MODULES: ModuleType[] = ["agro", "health", "ngo", "generic"];

function seededRandom(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

function generateMockDocuments(): MockDoc[] {
  const rand = seededRandom(42);
  const now = Date.now();
  const docs: MockDoc[] = [];
  let idCounter = 1;

  AGENTS.forEach((agent, agentIdx) => {
    // Chaque agent a un nombre d'activités et une ancienneté de dernière
    // saisie légèrement différents pour illustrer les alertes d'inactivité.
    const count = 6 + Math.floor(rand() * 8);
    const inactiveOffsetHours = agentIdx === AGENTS.length - 1 ? 60 : rand() * 20;

    for (let i = 0; i < count; i++) {
      const daysAgo = Math.floor(rand() * 14) + (i === 0 ? inactiveOffsetHours / 24 : 0);
      const city = CITIES[Math.floor(rand() * CITIES.length)];
      const moduleType = MODULES[Math.floor(rand() * MODULES.length)];
      const createdAt = new Date(now - daysAgo * 24 * 3600 * 1000 - Math.floor(rand() * 3600 * 1000));

      docs.push({
        id: `mock-${idCounter++}`,
        agent_name: agent,
        module_type: moduleType,
        title: [
          "Visite de terrain",
          "Point de situation",
          "Compte-rendu de mission",
          "Suivi hebdomadaire",
          "Constat sur site",
        ][Math.floor(rand() * 5)],
        status: rand() > 0.25 ? "ready" : "draft",
        location_city: city.name,
        lat: city.lat + (rand() - 0.5) * 0.15,
        lng: city.lng + (rand() - 0.5) * 0.15,
        created_at: createdAt.toISOString(),
      });
    }
  });

  return docs.sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at));
}

// ── Petit composant "carte" en pur CSS (pas de dépendance ajoutée) ───────

function MiniMap({ docs }: { docs: MockDoc[] }) {
  const lats = docs.map((d) => d.lat);
  const lngs = docs.map((d) => d.lng);
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
      {docs.map((d) => {
        const x = pad + ((d.lng - minLng) / spanLng) * (1 - 2 * pad);
        // inversé : latitude plus grande = plus haut sur la carte
        const y = pad + (1 - (d.lat - minLat) / spanLat) * (1 - 2 * pad);
        return (
          <div
            key={d.id}
            title={`${d.agent_name} · ${MODULE_LABELS[d.module_type]} · ${d.location_city}`}
            className="absolute h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full ring-2 ring-background/80 transition-transform hover:scale-150"
            style={{
              left: `${x * 100}%`,
              top: `${y * 100}%`,
              backgroundColor: MODULE_COLORS[d.module_type],
            }}
          />
        );
      })}
      <div className="absolute bottom-2 right-2 flex items-center gap-1 rounded bg-background/70 px-2 py-1 text-[10px] text-muted-foreground backdrop-blur">
        <MapPin className="h-3 w-3" /> {docs.length} points (données de test)
      </div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

function SupervisorDashboard() {
  const allDocs = useMemo(() => generateMockDocuments(), []);
  const [moduleFilter, setModuleFilter] = useState<ModuleType | "all">("all");
  const [agentFilter, setAgentFilter] = useState<string | "all">("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "ready">("all");
  const [validated, setValidated] = useState<Set<string>>(new Set());

  const filteredDocs = allDocs.filter((d) => {
    if (moduleFilter !== "all" && d.module_type !== moduleFilter) return false;
    if (agentFilter !== "all" && d.agent_name !== agentFilter) return false;
    if (statusFilter !== "all" && d.status !== statusFilter) return false;
    return true;
  });

  // Métriques
  const total = allDocs.length;
  const activeAgents = new Set(allDocs.map((d) => d.agent_name)).size;
  const todayCount = allDocs.filter(
    (d) => new Date(d.created_at).toDateString() === new Date().toDateString(),
  ).length;
  const syncRate = Math.round((allDocs.filter((d) => d.status === "ready").length / total) * 100);

  // Activité par jour (14 derniers jours)
  const byDay = useMemo(() => {
    const days: { day: string; count: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const d = new Date();
      d.setDate(d.getDate() - i);
      const label = d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
      const count = allDocs.filter(
        (doc) => new Date(doc.created_at).toDateString() === d.toDateString(),
      ).length;
      days.push({ day: label, count });
    }
    return days;
  }, [allDocs]);

  // Alertes : agents inactifs depuis plus de 48h (sur leur dernière saisie)
  const alerts = useMemo(() => {
    const lastByAgent = new Map<string, number>();
    allDocs.forEach((d) => {
      const t = +new Date(d.created_at);
      if (!lastByAgent.has(d.agent_name) || t > lastByAgent.get(d.agent_name)!) {
        lastByAgent.set(d.agent_name, t);
      }
    });
    const now = Date.now();
    return Array.from(lastByAgent.entries())
      .map(([agent, last]) => ({ agent, hoursAgo: Math.round((now - last) / 3_600_000) }))
      .filter((a) => a.hoursAgo > 48)
      .sort((a, b) => b.hoursAgo - a.hoursAgo);
  }, [allDocs]);

  function toggleValidate(id: string) {
    setValidated((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
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
        <span className="rounded-full border border-gold/30 bg-gold/10 px-3 py-1 text-[10px] uppercase tracking-widest text-gold-soft">
          Données de test
        </span>
      </div>

      <header className="mb-8">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Supervision</p>
        <h1 className="mt-2 font-display text-3xl leading-tight sm:text-4xl">
          Tableau de bord <span className="gold-text">Superviseur</span>
        </h1>
        <p className="mt-3 text-sm text-muted-foreground">
          Vue d'ensemble des activités terrain, tous agents confondus. Aperçu construit avec des
          données de test — se connectera aux vraies données une fois les rôles ajoutés.
        </p>
      </header>

      {/* Métriques */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <MetricCard icon={Activity} label="Total activités" value={total} />
        <MetricCard icon={Users} label="Agents actifs" value={activeAgents} />
        <MetricCard icon={Radio} label="Aujourd'hui" value={todayCount} />
        <MetricCard icon={CheckCircle2} label="Taux de synchro" value={`${syncRate}%`} />
      </section>

      {/* Carte */}
      <section className="glass-card mb-6 rounded-2xl p-5">
        <h2 className="mb-3 font-display text-lg">Répartition géographique</h2>
        <MiniMap docs={allDocs} />
        <div className="mt-3 flex flex-wrap gap-3">
          {MODULES.map((m) => (
            <div key={m} className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: MODULE_COLORS[m] }}
              />
              {MODULE_LABELS[m]}
            </div>
          ))}
        </div>
      </section>

      {/* Graphique d'activité */}
      <section className="glass-card mb-6 rounded-2xl p-5">
        <h2 className="mb-3 font-display text-lg">Activité — 14 derniers jours</h2>
        <div className="h-56 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={byDay}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
              <XAxis
                dataKey="day"
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={{ stroke: "var(--border)" }}
                tickLine={false}
              />
              <YAxis
                allowDecimals={false}
                tick={{ fill: "var(--muted-foreground)", fontSize: 10 }}
                axisLine={false}
                tickLine={false}
                width={24}
              />
              <RechartsTooltip
                contentStyle={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 8,
                  fontSize: 12,
                }}
              />
              <Bar dataKey="count" fill="var(--gold)" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </section>

      {/* Alertes */}
      {alerts.length > 0 && (
        <section className="mb-6 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-5">
          <h2 className="mb-3 flex items-center gap-2 font-display text-lg text-amber-300">
            <AlertTriangle className="h-4 w-4" /> Alertes — agents inactifs
          </h2>
          <ul className="space-y-1.5 text-sm">
            {alerts.map((a) => (
              <li key={a.agent} className="flex items-center justify-between text-amber-200/90">
                <span>{a.agent}</span>
                <span className="text-xs text-amber-300/70">
                  Dernière saisie il y a {a.hoursAgo}h
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* Liste des activités */}
      <section className="glass-card rounded-2xl p-5">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <h2 className="font-display text-lg">Activités récentes</h2>
          <div className="flex flex-wrap gap-2">
            <select
              value={moduleFilter}
              onChange={(e) => setModuleFilter(e.target.value as ModuleType | "all")}
              className="rounded-lg border border-border bg-input px-2 py-1.5 text-xs"
            >
              <option value="all">Tous les modules</option>
              {MODULES.map((m) => (
                <option key={m} value={m}>
                  {MODULE_LABELS[m]}
                </option>
              ))}
            </select>
            <select
              value={agentFilter}
              onChange={(e) => setAgentFilter(e.target.value)}
              className="rounded-lg border border-border bg-input px-2 py-1.5 text-xs"
            >
              <option value="all">Tous les agents</option>
              {AGENTS.map((a) => (
                <option key={a} value={a}>
                  {a}
                </option>
              ))}
            </select>
            <select
              value={statusFilter}
              onChange={(e) => setStatusFilter(e.target.value as "all" | "draft" | "ready")}
              className="rounded-lg border border-border bg-input px-2 py-1.5 text-xs"
            >
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
              <TableHead className="text-right">Validation</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {filteredDocs.slice(0, 30).map((d) => (
              <TableRow key={d.id}>
                <TableCell className="font-medium">{d.agent_name}</TableCell>
                <TableCell>
                  <span
                    className="rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider"
                    style={{
                      backgroundColor: `color-mix(in oklch, ${MODULE_COLORS[d.module_type]} 18%, transparent)`,
                      color: MODULE_COLORS[d.module_type],
                    }}
                  >
                    {MODULE_LABELS[d.module_type]}
                  </span>
                </TableCell>
                <TableCell className="max-w-[180px] truncate">{d.title}</TableCell>
                <TableCell className="text-muted-foreground">{d.location_city}</TableCell>
                <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                  {new Date(d.created_at).toLocaleString("fr-FR", {
                    day: "2-digit",
                    month: "short",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </TableCell>
                <TableCell>
                  <span
                    className={
                      d.status === "ready"
                        ? "text-xs text-emerald-400"
                        : "text-xs text-muted-foreground"
                    }
                  >
                    {d.status === "ready" ? "Synchronisé" : "Brouillon"}
                  </span>
                </TableCell>
                <TableCell className="text-right">
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
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>

        {filteredDocs.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            Aucune activité ne correspond à ces filtres.
          </p>
        )}

        {filteredDocs.length > 30 && (
          <p className="mt-3 text-center text-xs text-muted-foreground">
            {filteredDocs.length - 30} activités supplémentaires non affichées (pagination à
            ajouter avec les vraies données).
          </p>
        )}
      </section>
    </div>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
}: {
  icon: typeof Activity;
  label: string;
  value: string | number;
}) {
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
