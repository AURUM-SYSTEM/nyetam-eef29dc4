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
  BarChart3,
  CheckCircle2,
  Loader2,
  Lock,
  MapPin,
  Pencil,
  Radio,
  ShieldAlert,
  Sparkles,
  Sprout,
  Users,
  XCircle,
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
import { askAgriAssistant, generateOrientations, listAdvisorReports, markAdvisorReportTreated } from "@/lib/insights.functions";
import {
  listParcelles,
  listProducers,
  listCooperatives,
  getProducerDetails,
  updateProducer,
  listDuplicateAlerts,
  reviewDuplicateAlert,
  getAgentQualityScores,
  getDocumentDetails,
  getDataAnalystStats,
} from "@/lib/agro.functions";
import { BackofficeShell } from "@/components/BackofficeShell";

export const Route = createFileRoute("/_authenticated/supervisor")({
  component: SupervisorPage,
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

// ── Détail complet d'un document (données brutes) ────────────────────────

type DocumentDetails = {
  id: string;
  title: string | null;
  transcript: string;
  fieldData: Record<string, string> | null;
  photoUrls: string[];
  videoUrls: string[];
  location: string | null;
  locationData: { lat?: number; lng?: number; city?: string } | null;
  status: string | null;
  validatedAt: string | null;
  createdAt: string;
  agentName: string | null;
  parcelle: { culture: string; surfaceHa: number | null; producerName: string | null } | null;
  coreOutput: { category: string | null; summary: string | null; indicators: Array<{ label: string; value: string }> } | null;
};

function humanizeFieldKey(key: string): string {
  const spaced = key.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function DocumentDetailRow({ documentId, onClose }: { documentId: string; onClose: () => void }) {
  const fetchDetails = useServerFn(getDocumentDetails);
  const [details, setDetails] = useState<DocumentDetails | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchDetails({ data: { documentId } });
        if (!cancelled) setDetails(res as DocumentDetails);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Échec du chargement du document");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [documentId]);

  return (
    <TableRow>
      <TableCell colSpan={7} className="bg-card/30">
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : error ? (
          <p className="py-2 text-sm text-destructive">{error}</p>
        ) : details ? (
          <div className="space-y-3 py-2">
            <div>
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Transcription complète</span>
              <p className="whitespace-pre-line rounded-lg border border-border bg-input/30 p-2 text-xs text-muted-foreground">
                {details.transcript || "—"}
              </p>
            </div>

            {details.fieldData && Object.keys(details.fieldData).length > 0 && (
              <div>
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Données saisies</span>
                <ul className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  {Object.entries(details.fieldData).map(([k, v]) => (
                    <li key={k}><span className="text-foreground">{humanizeFieldKey(k)}</span> : {String(v)}</li>
                  ))}
                </ul>
              </div>
            )}

            {(details.photoUrls.length > 0 || details.videoUrls.length > 0) && (
              <div>
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Médias</span>
                <div className="flex flex-wrap gap-2">
                  {details.photoUrls.map((url, i) => (
                    <a key={`p${i}`} href={url} target="_blank" rel="noreferrer">
                      <img src={url} alt="" className="h-16 w-16 rounded-lg border border-border object-cover" />
                    </a>
                  ))}
                  {details.videoUrls.map((url, i) => (
                    // eslint-disable-next-line jsx-a11y/media-has-caption
                    <video key={`v${i}`} src={url} controls className="h-16 w-24 rounded-lg border border-border object-cover" />
                  ))}
                </div>
              </div>
            )}

            {details.parcelle && (
              <div>
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Parcelle liée</span>
                <p className="text-xs text-muted-foreground">
                  {details.parcelle.culture}
                  {details.parcelle.surfaceHa != null ? ` · ${details.parcelle.surfaceHa} ha` : ""}
                  {" · Producteur : "}{details.parcelle.producerName ?? "—"}
                </p>
              </div>
            )}

            {details.coreOutput && (
              <div>
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Résultat CORE (structuré)</span>
                <p className="text-xs text-muted-foreground">
                  {details.coreOutput.category ? `Catégorie : ${details.coreOutput.category}` : ""}
                  {details.coreOutput.summary ? ` — ${details.coreOutput.summary}` : ""}
                </p>
                {details.coreOutput.indicators.length > 0 && (
                  <ul className="mt-1 text-xs text-muted-foreground">
                    {details.coreOutput.indicators.map((ind, i) => (
                      <li key={i}>{ind.label} : {ind.value}</li>
                    ))}
                  </ul>
                )}
              </div>
            )}

            <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">
              Fermer
            </button>
          </div>
        ) : null}
      </TableCell>
    </TableRow>
  );
}

// ── Page ──────────────────────────────────────────────────────────────

function SupervisorPage() {
  return (
    <BackofficeShell>
      <SupervisorDashboard />
    </BackofficeShell>
  );
}

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

// ── AGRO : parcelles de l'organisation (superviseurs du module agro) ─────

function ParcellesSection() {
  const fetchParcelles = useServerFn(listParcelles);
  const [rows, setRows] = useState<Array<{
    id: string; culture: string; surfaceHa: number | null; cooperativeName: string | null; visitCount: number;
  }>>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchParcelles({ data: undefined as any });
        if (!cancelled) setRows(res.parcelles);
      } catch {
        // silencieux : section purement informative
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="glass-card mb-6 rounded-2xl p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg">
        <Sprout className="h-4 w-4 text-gold" /> Parcelles
      </h2>
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Aucune parcelle enregistrée pour l'instant.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Culture</TableHead>
              <TableHead>Surface</TableHead>
              <TableHead>Coopérative</TableHead>
              <TableHead className="text-right">Visites</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(p => (
              <TableRow key={p.id}>
                <TableCell className="font-medium">{p.culture}</TableCell>
                <TableCell className="text-muted-foreground">{p.surfaceHa != null ? `${p.surfaceHa} ha` : "—"}</TableCell>
                <TableCell className="text-muted-foreground">{p.cooperativeName ?? "—"}</TableCell>
                <TableCell className="text-right">{p.visitCount}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

function ProducerDetailRow({
  producerId,
  cooperatives,
  onClose,
  onSaved,
}: {
  producerId: string;
  cooperatives: Array<{ id: string; name: string }>;
  onClose: () => void;
  onSaved: (fullName: string, cooperativeName: string | null) => void;
}) {
  const fetchDetails = useServerFn(getProducerDetails);
  const saveProducer = useServerFn(updateProducer);

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [parcelles, setParcelles] = useState<Array<{ id: string; culture: string; surfaceHa: number | null; createdAt: string }>>([]);
  const [visitCount, setVisitCount] = useState(0);
  const [fullName, setFullName] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [idDocumentType, setIdDocumentType] = useState("");
  const [idDocumentNumber, setIdDocumentNumber] = useState("");
  const [cooperativeId, setCooperativeId] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchDetails({ data: { producerId } });
        if (cancelled) return;
        setFullName(res.producer.fullName);
        setContactPhone(res.producer.contactPhone ?? "");
        setContactEmail(res.producer.contactEmail ?? "");
        setIdDocumentType(res.producer.idDocumentType ?? "");
        setIdDocumentNumber(res.producer.idDocumentNumber ?? "");
        setCooperativeId(res.producer.cooperativeId ?? "");
        setParcelles(res.parcelles);
        setVisitCount(res.visitCount);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Échec du chargement du producteur");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [producerId]);

  async function handleSave() {
    if (!fullName.trim()) {
      toast.error("Le nom complet est obligatoire.");
      return;
    }
    setSaving(true);
    try {
      await saveProducer({
        data: {
          producerId,
          fullName: fullName.trim(),
          contactPhone: contactPhone.trim() || undefined,
          contactEmail: contactEmail.trim() || undefined,
          idDocumentType: idDocumentType.trim() || undefined,
          idDocumentNumber: idDocumentNumber.trim() || undefined,
          cooperativeId: cooperativeId || null,
        },
      });
      toast.success("Producteur mis à jour");
      const coopName = cooperativeId ? (cooperatives.find(c => c.id === cooperativeId)?.name ?? null) : null;
      onSaved(fullName.trim(), coopName);
      onClose();
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la mise à jour");
    } finally {
      setSaving(false);
    }
  }

  return (
    <TableRow>
      <TableCell colSpan={3} className="bg-card/30">
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : error ? (
          <p className="py-2 text-sm text-destructive">{error}</p>
        ) : (
          <div className="space-y-3 py-2">
            <div className="grid grid-cols-2 gap-2">
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Nom complet *</span>
                <input value={fullName} onChange={e => setFullName(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Coopérative</span>
                <select value={cooperativeId} onChange={e => setCooperativeId(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs">
                  <option value="">— Aucune —</option>
                  {cooperatives.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Téléphone</span>
                <input value={contactPhone} onChange={e => setContactPhone(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Email</span>
                <input type="email" value={contactEmail} onChange={e => setContactEmail(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Type de pièce d'identité</span>
                <input value={idDocumentType} onChange={e => setIdDocumentType(e.target.value)} placeholder="ex : CNI"
                  className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Numéro de pièce</span>
                <input value={idDocumentNumber} onChange={e => setIdDocumentNumber(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs" />
              </label>
            </div>

            <div>
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                Parcelles ({parcelles.length}) · {visitCount} visite{visitCount !== 1 ? "s" : ""}
              </span>
              {parcelles.length === 0 ? (
                <p className="text-xs text-muted-foreground">Aucune parcelle liée.</p>
              ) : (
                <ul className="space-y-1 text-xs text-muted-foreground">
                  {parcelles.map(pc => (
                    <li key={pc.id}>
                      {pc.culture}{pc.surfaceHa ? ` · ${pc.surfaceHa} ha` : ""} · {new Date(pc.createdAt).toLocaleDateString("fr-FR")}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="flex gap-2">
              <button type="button" onClick={() => void handleSave()} disabled={saving}
                className="btn-gold rounded-lg px-3 py-1.5 text-xs disabled:opacity-40">
                {saving ? "Enregistrement…" : "Enregistrer"}
              </button>
              <button type="button" onClick={onClose} className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground">
                Fermer
              </button>
            </div>
          </div>
        )}
      </TableCell>
    </TableRow>
  );
}

function ProducersSection() {
  const fetchProducers = useServerFn(listProducers);
  const fetchCooperatives = useServerFn(listCooperatives);
  const [rows, setRows] = useState<Array<{
    id: string; fullName: string; cooperativeName: string | null; parcelleCount: number;
  }>>([]);
  const [cooperatives, setCooperatives] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [res, coops] = await Promise.all([
          fetchProducers({ data: undefined as any }),
          fetchCooperatives({ data: undefined as any }),
        ]);
        if (cancelled) return;
        setRows(res.producers);
        setCooperatives(coops.cooperatives);
      } catch {
        // silencieux : section purement informative
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="glass-card mb-6 rounded-2xl p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg">
        <Users className="h-4 w-4 text-gold" /> Producteurs
      </h2>
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : rows.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Aucun producteur enregistré pour l'instant.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nom</TableHead>
              <TableHead>Coopérative</TableHead>
              <TableHead className="text-right">Parcelles</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(p => (
              <Fragment key={p.id}>
                <TableRow
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  className="cursor-pointer hover:bg-card/40"
                >
                  <TableCell className="font-medium">{p.fullName}</TableCell>
                  <TableCell className="text-muted-foreground">{p.cooperativeName ?? "—"}</TableCell>
                  <TableCell className="text-right">{p.parcelleCount}</TableCell>
                </TableRow>
                {expandedId === p.id && (
                  <ProducerDetailRow
                    producerId={p.id}
                    cooperatives={cooperatives}
                    onClose={() => setExpandedId(null)}
                    onSaved={(fullName, coopName) => {
                      setRows(prev => prev.map(row => row.id === p.id ? { ...row, fullName, cooperativeName: coopName } : row));
                    }}
                  />
                )}
              </Fragment>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}

// ── AGRO : assistant IA conversationnel ───────────────────────────────────

const AGRI_ASSISTANT_EXAMPLES = [
  "Quels producteurs n'ont pas été visités récemment ?",
  "Quelle coopérative a le plus d'alertes de doublons ?",
  "Combien de parcelles de cacao avons-nous ?",
];

function AgriAssistantSection() {
  const ask = useServerFn(askAgriAssistant);
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);

  async function handleAsk() {
    if (!question.trim()) {
      toast.error("Écrivez une question.");
      return;
    }
    setAsking(true);
    setAnswer(null);
    try {
      const res = await ask({ data: { question: question.trim() } });
      setAnswer(res.answer);
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la demande à l'assistant");
    } finally {
      setAsking(false);
    }
  }

  return (
    <section className="glass-card mb-6 rounded-2xl p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg">
        <Sparkles className="h-4 w-4 text-gold" /> Assistant Agro
      </h2>
      <div className="space-y-2">
        <textarea
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder="ex : Combien de parcelles de cacao avons-nous ?"
          rows={2}
          className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold"
        />
        <div className="flex flex-wrap gap-2">
          {AGRI_ASSISTANT_EXAMPLES.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => setQuestion(example)}
              className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground"
            >
              {example}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => void handleAsk()}
          disabled={asking || !question.trim()}
          className="rounded-lg btn-gold px-4 py-2 text-sm disabled:opacity-40"
        >
          {asking ? "Réflexion…" : "Demander"}
        </button>
        {answer && (
          <p className="whitespace-pre-line rounded-lg border border-border bg-card/30 p-3 text-sm">
            {answer}
          </p>
        )}
      </div>
    </section>
  );
}

// ── AGRO : analyse IA — orientations (synthèse automatique) ──────────────

type AdvisorReport = {
  id: string;
  analysis: string;
  documentsAnalyzed: number;
  generatedByName: string;
  status: "a_traiter" | "traite";
  treatedByName: string | null;
  treatedAt: string | null;
  treatmentNotes: string | null;
  createdAt: string;
};

function OrientationsSection() {
  const generate = useServerFn(generateOrientations);
  const fetchReports = useServerFn(listAdvisorReports);
  const markTreated = useServerFn(markAdvisorReportTreated);

  const [loading, setLoading] = useState(false);

  const [reports, setReports] = useState<AdvisorReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(true);
  const [treatingId, setTreatingId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  async function loadReports() {
    setReportsLoading(true);
    try {
      const res = await fetchReports({ data: undefined as any });
      setReports(res.reports);
    } catch {
      // silencieux : historique purement informatif
    } finally {
      setReportsLoading(false);
    }
  }

  useEffect(() => {
    void loadReports();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function handleGenerate() {
    setLoading(true);
    try {
      await generate({ data: undefined as any });
      await loadReports();
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la génération de l'analyse");
    } finally {
      setLoading(false);
    }
  }

  async function handleMarkTreated(reportId: string) {
    setTreatingId(reportId);
    try {
      await markTreated({ data: { reportId } });
      setReports((prev) => prev.map((r) => (r.id === reportId ? { ...r, status: "traite" as const } : r)));
      toast.success("Analyse marquée comme traitée");
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la mise à jour");
    } finally {
      setTreatingId(null);
    }
  }

  return (
    <section className="glass-card mb-6 rounded-2xl p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg">
        <Sparkles className="h-4 w-4 text-gold" /> Agro Advisor
      </h2>
      <div className="space-y-3">
        <button
          type="button"
          onClick={() => void handleGenerate()}
          disabled={loading}
          className="rounded-lg btn-gold px-4 py-2 text-sm disabled:opacity-40"
        >
          {loading ? "Génération…" : "Générer l'analyse"}
        </button>

        <div>
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Historique des analyses</span>
          {reportsLoading ? (
            <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-gold" /></div>
          ) : reports.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune analyse générée pour l'instant.</p>
          ) : (
            <ul className="space-y-2">
              {reports.map((r) => {
                const expanded = expandedId === r.id;
                return (
                  <li key={r.id} className="rounded-lg border border-border bg-card/30 p-2.5">
                    <div
                      onClick={() => setExpandedId(expanded ? null : r.id)}
                      className="cursor-pointer"
                    >
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(r.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                          {" · "}{r.documentsAnalyzed} document{r.documentsAnalyzed !== 1 ? "s" : ""}
                        </span>
                        <span className={r.status === "traite" ? "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-emerald-500/15 text-emerald-400" : "rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider bg-amber-500/15 text-amber-400"}>
                          {r.status === "traite" ? "Traité" : "À traiter"}
                        </span>
                      </div>
                      <p className={expanded ? "whitespace-pre-line text-xs text-muted-foreground" : "line-clamp-2 text-xs text-muted-foreground"}>
                        {r.analysis}
                      </p>
                    </div>
                    {r.status === "a_traiter" ? (
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); void handleMarkTreated(r.id); }}
                        disabled={treatingId === r.id}
                        className="mt-2 rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                      >
                        {treatingId === r.id ? "…" : "Marquer comme traité"}
                      </button>
                    ) : (
                      r.treatedByName && (
                        <p className="mt-1 text-[10px] text-muted-foreground">
                          Traité par {r.treatedByName}{r.treatedAt ? ` le ${new Date(r.treatedAt).toLocaleDateString("fr-FR")}` : ""}
                        </p>
                      )
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

// ── AGRO : Data Analyst — complétude, validation, volumes ────────────────

type DataAnalystStats = {
  totalDocuments: number;
  photoRate: number;
  videoRate: number;
  gpsRate: number;
  parcelleRate: number;
  validatedRate: number;
  pendingRate: number;
  avgValidationHours: number | null;
  parcelleCount: number;
  producerCount: number;
  cooperativeCount: number;
};

function DataAnalystSection() {
  const fetchStats = useServerFn(getDataAnalystStats);
  const fetchScores = useServerFn(getAgentQualityScores);

  const [stats, setStats] = useState<DataAnalystStats | null>(null);
  const [scores, setScores] = useState<AgentQualityScore[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [s, q] = await Promise.all([
          fetchStats({ data: undefined as any }),
          fetchScores({ data: undefined as any }),
        ]);
        if (cancelled) return;
        setStats(s);
        setScores(q.scores);
      } catch {
        // silencieux : section purement informative
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <section className="glass-card mb-6 rounded-2xl p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg">
        <BarChart3 className="h-4 w-4 text-gold" /> Data Analyst
      </h2>
      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : !stats ? (
        <p className="py-4 text-center text-sm text-muted-foreground">Données indisponibles pour l'instant.</p>
      ) : (
        <div className="space-y-4">
          <div>
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
              Complétude ({stats.totalDocuments} document{stats.totalDocuments !== 1 ? "s" : ""})
            </span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {[
                ["Avec photo", stats.photoRate],
                ["Avec vidéo", stats.videoRate],
                ["Avec GPS", stats.gpsRate],
                ["Liés à une parcelle", stats.parcelleRate],
              ].map(([label, rate]) => (
                <div key={label as string} className="rounded-lg border border-border bg-card/30 p-2 text-center">
                  <p className="font-display text-lg text-gold">{rate}%</p>
                  <p className="text-[10px] text-muted-foreground">{label}</p>
                </div>
              ))}
            </div>
          </div>

          <div>
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Validation</span>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              <div className="rounded-lg border border-border bg-card/30 p-2 text-center">
                <p className="font-display text-lg text-emerald-400">{stats.validatedRate}%</p>
                <p className="text-[10px] text-muted-foreground">Validés</p>
              </div>
              <div className="rounded-lg border border-border bg-card/30 p-2 text-center">
                <p className="font-display text-lg text-amber-400">{stats.pendingRate}%</p>
                <p className="text-[10px] text-muted-foreground">En attente</p>
              </div>
              <div className="rounded-lg border border-border bg-card/30 p-2 text-center">
                <p className="font-display text-lg text-gold">
                  {stats.avgValidationHours != null ? `${stats.avgValidationHours} h` : "—"}
                </p>
                <p className="text-[10px] text-muted-foreground">Délai moyen création → validation</p>
              </div>
            </div>
          </div>

          <div>
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Volumes actifs</span>
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-lg border border-border bg-card/30 p-2 text-center">
                <p className="font-display text-lg">{stats.parcelleCount}</p>
                <p className="text-[10px] text-muted-foreground">Parcelles</p>
              </div>
              <div className="rounded-lg border border-border bg-card/30 p-2 text-center">
                <p className="font-display text-lg">{stats.producerCount}</p>
                <p className="text-[10px] text-muted-foreground">Producteurs</p>
              </div>
              <div className="rounded-lg border border-border bg-card/30 p-2 text-center">
                <p className="font-display text-lg">{stats.cooperativeCount}</p>
                <p className="text-[10px] text-muted-foreground">Coopératives</p>
              </div>
            </div>
          </div>

          <div>
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Scores qualité par agent</span>
            {scores.length === 0 ? (
              <p className="text-xs text-muted-foreground">Aucune donnée de qualité pour l'instant.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Alertes</TableHead>
                    <TableHead className="text-right">Créées quand même</TableHead>
                    <TableHead className="text-right">Taux de validation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scores.map((s) => (
                    <TableRow key={s.agentId}>
                      <TableCell className="font-medium">{s.agentName}</TableCell>
                      <TableCell className="text-right">{s.totalAlerts}</TableCell>
                      <TableCell className="text-right">{s.createdAnywayRate}%</TableCell>
                      <TableCell className="text-right">{s.validationRate}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

// ── AGRO : qualité des données — alertes de doublons GPS ─────────────────

const RISK_LABELS: Record<string, string> = { low: "Faible", medium: "Moyen", high: "Élevé" };
const RISK_CLASSES: Record<string, string> = {
  low: "bg-emerald-500/15 text-emerald-400",
  medium: "bg-amber-500/15 text-amber-400",
  high: "bg-red-500/15 text-red-400",
};
const REVIEW_STATUS_LABELS: Record<string, string> = { pending: "En attente", validated: "Validé", rejected: "Rejeté" };

type DuplicateAlert = {
  id: string;
  agentName: string;
  action: "created_anyway" | "used_existing";
  culture: string | null;
  cooperativeName: string | null;
  distanceMeters: number;
  riskLevel: string;
  reason: string | null;
  reviewStatus: "pending" | "validated" | "rejected";
};

type AgentQualityScore = {
  agentId: string;
  agentName: string;
  totalAlerts: number;
  createdAnywayRate: number;
  usedExistingRate: number;
  validationRate: number;
  confirmedDuplicates: number;
};

function DataQualitySection() {
  const fetchAlerts = useServerFn(listDuplicateAlerts);
  const reviewAlert = useServerFn(reviewDuplicateAlert);
  const fetchScores = useServerFn(getAgentQualityScores);

  const [alerts, setAlerts] = useState<DuplicateAlert[]>([]);
  const [scores, setScores] = useState<AgentQualityScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [decidingId, setDecidingId] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    try {
      const [a, s] = await Promise.all([
        fetchAlerts({ data: undefined as any }),
        fetchScores({ data: undefined as any }),
      ]);
      setAlerts(a.alerts);
      setScores(s.scores);
    } catch {
      // silencieux : section purement informative
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(alertId: string, reviewStatus: "validated" | "rejected") {
    setDecidingId(alertId);
    try {
      await reviewAlert({ data: { alertId, reviewStatus } });
      toast.success(reviewStatus === "validated" ? "Alerte validée" : "Alerte rejetée");
      setAlerts(prev => prev.map(a => a.id === alertId ? { ...a, reviewStatus } : a));
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la décision");
    } finally {
      setDecidingId(null);
    }
  }

  return (
    <section className="glass-card mb-6 rounded-2xl p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg">
        <ShieldAlert className="h-4 w-4 text-gold" /> Qualité des données — Alertes de doublons
      </h2>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : (
        <>
          {scores.length > 0 && (
            <div className="mb-5 overflow-x-auto">
              <p className="mb-2 text-xs uppercase tracking-widest text-gold-soft">Score qualité par agent</p>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Agent</TableHead>
                    <TableHead className="text-right">Alertes</TableHead>
                    <TableHead className="text-right">Créé quand même</TableHead>
                    <TableHead className="text-right">Utilisé existant</TableHead>
                    <TableHead className="text-right">Taux de validation</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scores.map(s => (
                    <TableRow key={s.agentId}>
                      <TableCell className="font-medium">{s.agentName}</TableCell>
                      <TableCell className="text-right">{s.totalAlerts}</TableCell>
                      <TableCell className="text-right">{s.createdAnywayRate}%</TableCell>
                      <TableCell className="text-right">{s.usedExistingRate}%</TableCell>
                      <TableCell className="text-right">{s.validationRate}%</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <p className="mb-2 text-xs uppercase tracking-widest text-gold-soft">Événements</p>
          {alerts.length === 0 ? (
            <p className="py-4 text-center text-sm text-muted-foreground">
              Aucune alerte de doublon pour l'instant.
            </p>
          ) : (
            <div className="space-y-2">
              {alerts.map(a => (
                <div key={a.id} className="rounded-xl border border-border bg-card/40 p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="text-sm font-medium">
                        {a.agentName} — {a.action === "created_anyway" ? "A créé quand même" : "A utilisé la parcelle existante"}
                      </p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {a.culture ?? "—"}{a.cooperativeName ? ` · ${a.cooperativeName}` : ""} · {a.distanceMeters} m
                      </p>
                      {a.reason && (
                        <p className="mt-1 text-xs italic text-muted-foreground">« {a.reason} »</p>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-2">
                      <span className={`rounded px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${RISK_CLASSES[a.riskLevel] ?? ""}`}>
                        Risque {RISK_LABELS[a.riskLevel] ?? a.riskLevel}
                      </span>
                      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                        {REVIEW_STATUS_LABELS[a.reviewStatus] ?? a.reviewStatus}
                      </span>
                    </div>
                  </div>
                  {a.reviewStatus === "pending" && (
                    <div className="mt-2 flex gap-2">
                      <button
                        onClick={() => void decide(a.id, "validated")}
                        disabled={decidingId === a.id}
                        className="flex items-center gap-1 rounded-lg bg-emerald-500/15 px-2.5 py-1.5 text-xs text-emerald-400 disabled:opacity-40"
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" /> Valider
                      </button>
                      <button
                        onClick={() => void decide(a.id, "rejected")}
                        disabled={decidingId === a.id}
                        className="flex items-center gap-1 rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground disabled:opacity-40"
                      >
                        <XCircle className="h-3.5 w-3.5" /> Rejeter
                      </button>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </section>
  );
}

function SupervisorDashboardContent() {
  const { profile } = useAuth();
  const { docs, profilesById, loading, error, reload } = useSupervisorData();

  const [moduleFilter, setModuleFilter] = useState<string>("all");
  const [agentFilter, setAgentFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<"all" | "draft" | "ready">("all");
  const [validated, setValidated] = useState<Set<string>>(new Set());
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [viewingId, setViewingId] = useState<string | null>(null);

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
      <div className="mb-6 flex items-center justify-end gap-2">
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

      {/* AGRO — parcelles et producteurs (uniquement pour les superviseurs du module agro) */}
      {profile?.module_type === "agro" && (
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 [&>section]:mb-0">
          <ParcellesSection />
          <ProducersSection />
        </div>
      )}

      {/* AGRO — qualité des données / alertes de doublons GPS */}
      {profile?.module_type === "agro" && <DataQualitySection />}

      {/* AGRO — Data Analyst (complétude, validation, volumes) */}
      {profile?.module_type === "agro" && <DataAnalystSection />}

      {/* AGRO — Assistant Agro (questions libres) et Agro Advisor (synthèse) — deux blocs distincts */}
      {profile?.module_type === "agro" && (
        <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 [&>section]:mb-0">
          <AgriAssistantSection />
          <OrientationsSection />
        </div>
      )}

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
                <TableRow
                  onClick={() => setViewingId(viewingId === d.id ? null : d.id)}
                  className="cursor-pointer hover:bg-card/40"
                >
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
                        onClick={(e) => { e.stopPropagation(); setRequestingId(requestingId === d.id ? null : d.id); }}
                        title="Demander une modification"
                        className="rounded-lg border border-border px-2 py-1 text-xs text-muted-foreground hover:text-foreground"
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </button>
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleValidate(d.id); }}
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
                {viewingId === d.id && (
                  <DocumentDetailRow documentId={d.id} onClose={() => setViewingId(null)} />
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
