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
  Download,
  CheckCircle2,
  ChevronDown,
  Folder,
  History,
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
  listAuditLog,
  getDocumentDetails,
  getDataAnalystStats,
  getParcelleTimeline,
  getEudrCompliance,
  attestEudrCompliance,
  getParcelleMapInfo,
  getOrganizationCommercialAccess,
} from "@/lib/agro.functions";
import { BackofficeShell } from "@/components/BackofficeShell";
import type { SupervisorMapMarker } from "@/components/LeafletMaps";

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
  parcelle_id: string | null;
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
      .select("id, user_id, module_type, title, status, location, location_data, parcelle_id, created_at")
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

// ── Carte de supervision — Leaflet/OpenStreetMap, chargée dynamiquement ──

function SupervisorMap({ docs }: { docs: DocRow[] }) {
  const fetchParcelleInfo = useServerFn(getParcelleMapInfo);
  const [leafletMod, setLeafletMod] = useState<typeof import("@/components/LeafletMaps") | null>(null);
  const [parcelleInfoById, setParcelleInfoById] = useState<Record<string, { culture: string; producerName: string | null; cooperativeName: string | null }>>({});

  const points = useMemo(
    () => docs
      .map((d) => ({ id: d.id, module_type: d.module_type, parcelle_id: d.parcelle_id, ...d.location_data }))
      .filter((p): p is { id: string; module_type: ModuleType | null; parcelle_id: string | null; lat: number; lng: number; city?: string } =>
        typeof p.lat === "number" && typeof p.lng === "number",
      ),
    [docs],
  );

  useEffect(() => {
    let cancelled = false;
    import("@/components/LeafletMaps").then((m) => { if (!cancelled) setLeafletMod(m); });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const ids = Array.from(new Set(points.map((p) => p.parcelle_id).filter((x): x is string => !!x)));
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchParcelleInfo({ data: { parcelleIds: ids } });
        if (cancelled) return;
        const map: Record<string, { culture: string; producerName: string | null; cooperativeName: string | null }> = {};
        for (const p of res.parcelles) map[p.id] = p;
        setParcelleInfoById(map);
      } catch {
        // silencieux : la carte reste utilisable sans l'enrichissement parcelle
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs]);

  if (points.length === 0) {
    return (
      <div className="flex h-64 w-full items-center justify-center rounded-xl border border-border bg-secondary/40 text-sm text-muted-foreground">
        Aucune coordonnée GPS disponible pour le moment.
      </div>
    );
  }

  if (!leafletMod) {
    return (
      <div className="flex h-64 w-full items-center justify-center rounded-xl border border-border bg-secondary/40">
        <Loader2 className="h-5 w-5 animate-spin text-gold" />
      </div>
    );
  }

  const markers: SupervisorMapMarker[] = points.map((p) => {
    const info = p.parcelle_id ? parcelleInfoById[p.parcelle_id] : undefined;
    return {
      id: p.id,
      lat: p.lat,
      lng: p.lng,
      moduleColor: moduleColor(p.module_type),
      moduleLabel: moduleLabel(p.module_type),
      city: p.city ?? null,
      culture: info?.culture ?? null,
      producerName: info?.producerName ?? null,
      cooperativeName: info?.cooperativeName ?? null,
    };
  });

  return <leafletMod.SupervisorLeafletMap markers={markers} />;
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

type ParcelleTimelineDoc = {
  id: string;
  title: string | null;
  missionType: string | null;
  fieldData: Record<string, string> | null;
  agentName: string;
  createdAt: string;
  photoCount: number;
  videoCount: number;
  status: string | null;
  validatedAt: string | null;
};

// Carte Leaflet d'une parcelle — polygone réel si un périmètre existe,
// sinon simple marqueur au point GPS. Chargée dynamiquement (voir
// LeafletMaps.tsx) ; rien tant que le module n'est pas résolu.
function ParcelleMap({ lat, lng, boundaryPoints }: {
  lat: number | null; lng: number | null; boundaryPoints: Array<{ lat: number; lng: number }> | null;
}) {
  const [leafletMod, setLeafletMod] = useState<typeof import("@/components/LeafletMaps") | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("@/components/LeafletMaps").then((m) => { if (!cancelled) setLeafletMod(m); });
    return () => { cancelled = true; };
  }, []);

  if (!leafletMod) {
    return <div className="h-36 w-36 shrink-0 rounded-lg border border-border bg-secondary/40" />;
  }
  return <leafletMod.ParcelleLeafletMap lat={lat} lng={lng} boundaryPoints={boundaryPoints} />;
}

type ParcelleEudrState = {
  deforestationFree: boolean | null;
  attestedByName: string | null;
  attestedAt: string | null;
  notes: string | null;
};

function ParcelleTimelineRow({ parcelleId, onClose }: { parcelleId: string; onClose: () => void }) {
  const fetchTimeline = useServerFn(getParcelleTimeline);
  const attest = useServerFn(attestEudrCompliance);
  const [parcelle, setParcelle] = useState<{
    culture: string; surfaceHa: number | null; surfaceHaCalculated: number | null;
    boundaryPoints: Array<{ lat: number; lng: number }> | null;
    lat: number | null; lng: number | null;
    producerName: string | null; cooperativeName: string | null;
    eudr: ParcelleEudrState;
  } | null>(null);
  const [docs, setDocs] = useState<ParcelleTimelineDoc[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [eudrEnabled, setEudrEnabled] = useState(false);
  const [eudrChecked, setEudrChecked] = useState(false);
  const [eudrNotesInput, setEudrNotesInput] = useState("");
  const [attesting, setAttesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchTimeline({ data: { parcelleId } });
        if (cancelled) return;
        setParcelle(res.parcelle);
        setDocs(res.documents);
        setEudrEnabled(res.eudrEnabled);
        setEudrChecked(res.parcelle.eudr.deforestationFree === true);
        setEudrNotesInput(res.parcelle.eudr.notes ?? "");
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Échec du chargement de la parcelle");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [parcelleId]);

  async function handleAttest() {
    setAttesting(true);
    try {
      await attest({ data: { parcelleId, deforestationFree: eudrChecked, notes: eudrNotesInput.trim() || undefined } });
      const res = await fetchTimeline({ data: { parcelleId } });
      setParcelle(res.parcelle);
      toast.success("Attestation enregistrée");
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de l'attestation");
    } finally {
      setAttesting(false);
    }
  }

  async function handleExportPdf() {
    if (!parcelle) return;
    setExportingPdf(true);
    try {
      const { exportParcelleTraceabilityPdf } = await import("@/lib/exports");
      await exportParcelleTraceabilityPdf({
        culture: parcelle.culture,
        surfaceHa: parcelle.surfaceHa,
        cooperativeName: parcelle.cooperativeName,
        producerName: parcelle.producerName,
        lat: parcelle.lat,
        lng: parcelle.lng,
        boundaryPoints: parcelle.boundaryPoints,
        documents: docs.map((d) => ({
          title: d.title,
          missionType: d.missionType,
          agentName: d.agentName,
          createdAt: d.createdAt,
          photoCount: d.photoCount,
          videoCount: d.videoCount,
          validatedAt: d.validatedAt,
        })),
        eudrAttestation: eudrEnabled && parcelle.eudr.attestedAt
          ? {
              deforestationFree: parcelle.eudr.deforestationFree === true,
              attestedByName: parcelle.eudr.attestedByName ?? "—",
              attestedAt: parcelle.eudr.attestedAt,
              notes: parcelle.eudr.notes,
            }
          : null,
      });
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de l'export PDF");
    } finally {
      setExportingPdf(false);
    }
  }

  return (
    <TableRow>
      <TableCell colSpan={4} className="bg-card/30">
        {loading ? (
          <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
        ) : error ? (
          <p className="py-2 text-sm text-destructive">{error}</p>
        ) : (
          <div className="space-y-3 py-2">
            {parcelle && (
              <div className="flex items-start gap-3">
                <ParcelleMap lat={parcelle.lat} lng={parcelle.lng} boundaryPoints={parcelle.boundaryPoints} />
                <p className="text-xs text-muted-foreground">
                  {parcelle.culture}
                  {parcelle.surfaceHa != null ? ` · ${parcelle.surfaceHa} ha` : ""}
                  {parcelle.surfaceHaCalculated != null ? ` (calculée : ${parcelle.surfaceHaCalculated} ha)` : ""}
                  {" · Producteur : "}{parcelle.producerName ?? "—"}
                  {" · Coopérative : "}{parcelle.cooperativeName ?? "—"}
                </p>
              </div>
            )}

            <div>
              <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                Historique des visites ({docs.length})
              </span>
              {docs.length === 0 ? (
                <p className="text-xs text-muted-foreground">Aucun document lié à cette parcelle pour l'instant.</p>
              ) : (
                <ul className="space-y-2">
                  {docs.map((d) => (
                    <li key={d.id} className="rounded-lg border border-border bg-input/30 p-2.5">
                      <div className="mb-1 flex flex-wrap items-center justify-between gap-1.5">
                        <span className="text-xs font-medium">{d.title || "Sans titre"}</span>
                        <span className="text-[11px] text-muted-foreground">
                          {new Date(d.createdAt).toLocaleString("fr-FR", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
                        </span>
                      </div>
                      <p className="text-[11px] text-muted-foreground">
                        Agent : {d.agentName}
                        {d.missionType ? ` · Mission : ${d.missionType}` : ""}
                        {" · "}{d.photoCount} photo{d.photoCount !== 1 ? "s" : ""} · {d.videoCount} vidéo{d.videoCount !== 1 ? "s" : ""}
                        {" · "}{d.validatedAt ? "Validé" : "En attente de validation"}
                      </p>
                      {d.fieldData && Object.keys(d.fieldData).length > 0 && (
                        <ul className="mt-1 grid grid-cols-2 gap-x-4 gap-y-0.5 text-[11px] text-muted-foreground">
                          {Object.entries(d.fieldData).map(([k, v]) => (
                            <li key={k}><span className="text-foreground">{humanizeFieldKey(k)}</span> : {v}</li>
                          ))}
                        </ul>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {eudrEnabled && parcelle && (
              <div className="rounded-xl border border-border bg-card/30 p-3">
                <span className="mb-2 block text-[10px] uppercase tracking-widest text-muted-foreground">
                  Conformité EUDR
                </span>
                <label className="mb-2 flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={eudrChecked}
                    onChange={(e) => setEudrChecked(e.target.checked)}
                    className="accent-[var(--gold)]"
                  />
                  Absence de déforestation attestée
                </label>
                <textarea
                  value={eudrNotesInput}
                  onChange={(e) => setEudrNotesInput(e.target.value)}
                  placeholder="Notes (optionnel)"
                  rows={2}
                  className="mb-2 w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold"
                />
                <button
                  type="button"
                  onClick={() => void handleAttest()}
                  disabled={attesting}
                  className="rounded-lg btn-gold px-3 py-1.5 text-xs disabled:opacity-40"
                >
                  {attesting ? "Enregistrement…" : "Attester"}
                </button>
                {parcelle.eudr.attestedAt && (
                  <p className="mt-2 text-[11px] text-muted-foreground">
                    Dernière attestation : {parcelle.eudr.deforestationFree ? "absence de déforestation confirmée" : "non conforme"}
                    {" · par "}{parcelle.eudr.attestedByName ?? "—"}
                    {" · le "}{new Date(parcelle.eudr.attestedAt).toLocaleDateString("fr-FR")}
                  </p>
                )}
              </div>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void handleExportPdf()}
                disabled={exportingPdf}
                className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
              >
                {exportingPdf ? "Export…" : "Exporter la fiche PDF"}
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

function ParcellesSection() {
  const fetchParcelles = useServerFn(listParcelles);
  const [rows, setRows] = useState<Array<{
    id: string; culture: string; surfaceHa: number | null; cooperativeName: string | null; visitCount: number;
  }>>([]);
  const [loading, setLoading] = useState(true);
  const [expandedId, setExpandedId] = useState<string | null>(null);

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

  // Lien direct depuis la section Conformité EUDR ("lien vers leur fiche") :
  // déplie et centre la ligne correspondante quand l'URL contient
  // #parcelle-row-<id>, au chargement comme au clic (hashchange).
  useEffect(() => {
    function checkHash() {
      const match = window.location.hash.match(/^#parcelle-row-(.+)$/);
      const id = match?.[1];
      if (!id) return;
      setExpandedId(id);
      requestAnimationFrame(() => {
        document.getElementById(`parcelle-row-${id}`)?.scrollIntoView({ block: "center", behavior: "smooth" });
      });
    }
    checkHash();
    window.addEventListener("hashchange", checkHash);
    return () => window.removeEventListener("hashchange", checkHash);
  }, [rows]);

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
              <Fragment key={p.id}>
                <TableRow
                  id={`parcelle-row-${p.id}`}
                  onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  className="cursor-pointer hover:bg-card/40"
                >
                  <TableCell className="font-medium">{p.culture}</TableCell>
                  <TableCell className="text-muted-foreground">{p.surfaceHa != null ? `${p.surfaceHa} ha` : "—"}</TableCell>
                  <TableCell className="text-muted-foreground">{p.cooperativeName ?? "—"}</TableCell>
                  <TableCell className="text-right">{p.visitCount}</TableCell>
                </TableRow>
                {expandedId === p.id && (
                  <ParcelleTimelineRow parcelleId={p.id} onClose={() => setExpandedId(null)} />
                )}
              </Fragment>
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
  const [producerCode, setProducerCode] = useState("");
  const [fullName, setFullName] = useState("");
  const [sex, setSex] = useState("");
  const [village, setVillage] = useState("");
  const [commune, setCommune] = useState("");
  const [department, setDepartment] = useState("");
  const [region, setRegion] = useState("");
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
        setProducerCode(res.producer.producerCode);
        setFullName(res.producer.fullName);
        setSex(res.producer.sex ?? "");
        setVillage(res.producer.village ?? "");
        setCommune(res.producer.commune ?? "");
        setDepartment(res.producer.department ?? "");
        setRegion(res.producer.region ?? "");
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
          sex: (sex || null) as "male" | "female" | "unknown" | null,
          village: village.trim() || null,
          commune: commune.trim() || null,
          department: department.trim() || null,
          region: region.trim() || null,
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
            <div className="rounded-xl border border-border bg-card/40 p-3">
              <div className="flex items-center gap-4">
                <img
                  src={"https://api.qrserver.com/v1/create-qr-code/?size=140x140&data=" + encodeURIComponent("AURUM:PRODUCER:" + producerCode)}
                  alt={"QR code du producteur " + producerCode}
                  className="h-28 w-28 rounded-lg bg-white p-1"
                  loading="lazy"
                />
                <div>
                  <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Code producteur</p>
                  <p className="mt-1 text-xl font-semibold">{producerCode || "—"}</p>
                  <p className="mt-1 text-[11px] text-muted-foreground">QR de référence — aucune donnée personnelle n'est encodée.</p>
                </div>
              </div>
            </div>

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
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Sexe</span>
                <select value={sex} onChange={e => setSex(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs">
                  <option value="">— Non renseigné —</option>
                  <option value="male">Homme</option>
                  <option value="female">Femme</option>
                  <option value="unknown">Non précisé</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Téléphone</span>
                <input value={contactPhone} onChange={e => setContactPhone(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Village</span>
                <input value={village} onChange={e => setVillage(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Commune</span>
                <input value={commune} onChange={e => setCommune(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Département</span>
                <input value={department} onChange={e => setDepartment(e.target.value)}
                  className="w-full rounded-lg border border-border bg-input px-2 py-1.5 text-xs" />
              </label>
              <label className="block">
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Région</span>
                <input value={region} onChange={e => setRegion(e.target.value)}
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
    id: string; producerCode: string; fullName: string; cooperativeName: string | null; parcelleCount: number;
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
              <TableHead>Code</TableHead>
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
                  <TableCell className="font-mono text-xs text-gold">{p.producerCode}</TableCell>
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

// ── AGRO : restitution de la base de données ─────────────────────────────
function DataRestitutionSection() {
  const fetchParcelles = useServerFn(listParcelles);
  const fetchProducers = useServerFn(listProducers);
  const [parcelles, setParcelles] = useState<any[]>([]);
  const [producers, setProducers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    Promise.all([fetchParcelles({ data: undefined as any }), fetchProducers({ data: undefined as any })])
      .then(([p, pr]) => { if (!cancelled) { setParcelles(p.parcelles); setProducers(pr.producers); } })
      .catch(() => { if (!cancelled) toast.error("Impossible de charger les données à restituer."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const download = (name: string, content: string, type: string) => {
    const url = URL.createObjectURL(new Blob(["\\uFEFF", content], { type }));
    const a = document.createElement("a"); a.href = url; a.download = name; a.click(); URL.revokeObjectURL(url);
  };

  const exportWorkbook = async () => {
    const XLSX = await import("xlsx");
    const wb = XLSX.utils.book_new();

    const producersRows = producers.map(p => ({
      "Code producteur": p.producerCode ?? "", "Nom complet": p.fullName ?? "", "Sexe": p.sex ?? "",
      "Téléphone": p.contactPhone ?? "", "Email": p.contactEmail ?? "", "Type pièce d'identité": p.idDocumentType ?? "",
      "Numéro pièce": p.idDocumentNumber ?? "", "Coopérative": p.cooperativeName ?? "", "Village": p.village ?? "",
      "Commune": p.commune ?? "", "Département": p.department ?? "", "Région": p.region ?? "", "Nombre de parcelles": p.parcelleCount ?? 0,
    }));
    const wsProducers = XLSX.utils.json_to_sheet(producersRows);
    wsProducers["!cols"] = [18,28,12,18,28,24,22,24,20,20,20,20,18].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsProducers, "01_Producteurs");

    const parcelRows = parcelles.map(p => ({
      "Code parcelle": p.id ?? "", "Code producteur": p.producerCode ?? "", "Producteur": p.producerName ?? "",
      "Téléphone": p.producerPhone ?? "", "Coopérative": p.cooperativeName ?? "", "Village": p.village ?? "",
      "Commune": p.commune ?? "", "Département": p.department ?? "", "Région": p.region ?? "", "Culture": p.culture ?? "",
      "Espèces": Array.isArray(p.species) ? p.species.join(" | ") : p.species ?? "", "Variétés": Array.isArray(p.varieties) ? p.varieties.join(" | ") : p.varieties ?? "",
      "Surface déclarée (ha)": p.surfaceHa ?? "", "Surface calculée (ha)": p.surfaceHaCalculated ?? "", "Latitude": p.lat ?? "", "Longitude": p.lng ?? "",
      "Année de plantation": p.plantingYear ?? "", "Occupation du terrain": p.landTenure ?? "",
      "Agroforesterie": p.agroforestry == null ? "" : p.agroforestry ? "Oui" : "Non", "Certification": p.certification ?? "",
      "Rendement estimé (t)": p.estimatedYieldTonnes ?? "", "Statut conformité": p.complianceStatus ?? "", "Nombre de visites": p.visitCount ?? 0,
      "Date de collecte": p.createdAt ? new Date(p.createdAt).toLocaleString("fr-FR") : "",
    }));
    const wsParcelles = XLSX.utils.json_to_sheet(parcelRows);
    wsParcelles["!cols"] = [22,18,28,18,24,20,20,20,20,18,26,26,20,20,14,14,20,22,16,22,20,20,18,22].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsParcelles, "02_Parcelles");

    const gpsRows: any[] = [];
    for (const p of parcelles) {
      if (Array.isArray(p.boundaryPoints) && p.boundaryPoints.length >= 3) {
        p.boundaryPoints.forEach((pt: any, index: number) => gpsRows.push({
          "Code parcelle": p.id ?? "", "Code producteur": p.producerCode ?? "", "N° point": index + 1, "Latitude": pt.lat ?? "", "Longitude": pt.lng ?? "",
        }));
      } else if (typeof p.lat === "number" && typeof p.lng === "number") {
        gpsRows.push({ "Code parcelle": p.id ?? "", "Code producteur": p.producerCode ?? "", "N° point": 1, "Latitude": p.lat, "Longitude": p.lng });
      }
    }
    const wsGps = XLSX.utils.json_to_sheet(gpsRows);
    wsGps["!cols"] = [22,18,12,16,16].map(w => ({ wch: w }));
    XLSX.utils.book_append_sheet(wb, wsGps, "03_GPS_Polygones");

    const surface = parcelles.reduce((sum, p) => sum + (Number(p.surfaceHaCalculated ?? p.surfaceHa) || 0), 0);
    const gpsCount = parcelles.filter(p => typeof p.lat === "number" && typeof p.lng === "number").length;
    const polygonCount = parcelles.filter(p => Array.isArray(p.boundaryPoints) && p.boundaryPoints.length >= 3).length;
    const cultureCounts = new Map<string, number>();
    const coopCounts = new Map<string, number>();
    for (const p of parcelles) {
      const culture = p.culture || "Non renseignée"; cultureCounts.set(culture, (cultureCounts.get(culture) ?? 0) + 1);
      const coop = p.cooperativeName || "Non renseignée"; coopCounts.set(coop, (coopCounts.get(coop) ?? 0) + 1);
    }
    const summaryRows = [
      { "Indicateur": "Total producteurs", "Valeur": producers.length },
      { "Indicateur": "Total parcelles", "Valeur": parcelles.length },
      { "Indicateur": "Surface totale (ha)", "Valeur": Number(surface.toFixed(2)) },
      { "Indicateur": "Parcelles avec GPS", "Valeur": gpsCount },
      { "Indicateur": "Parcelles avec polygone", "Valeur": polygonCount },
      { "Indicateur": "Parcelles sans GPS", "Valeur": parcelles.length - gpsCount },
      { "Indicateur": "Producteurs sans parcelle", "Valeur": producers.filter(p => !(Number(p.parcelleCount) > 0)).length },
      { "Indicateur": "Nombre total de visites", "Valeur": parcelles.reduce((sum, p) => sum + (Number(p.visitCount) || 0), 0) },
      ...Array.from(cultureCounts.entries()).map(([name, count]) => ({ "Indicateur": `Culture — ${name}`, "Valeur": count })),
      ...Array.from(coopCounts.entries()).map(([name, count]) => ({ "Indicateur": `Coopérative — ${name}`, "Valeur": count })),
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryRows);
    wsSummary["!cols"] = [{ wch: 34 }, { wch: 18 }];
    XLSX.utils.book_append_sheet(wb, wsSummary, "04_Synthèse");
    XLSX.writeFile(wb, `AURUM_restitution_donnees-${new Date().toISOString().slice(0, 10)}.xlsx`);
  };

  const exportGeoJson = () => download("AURUM_parcelles.geojson", JSON.stringify({
    type: "FeatureCollection",
    features: parcelles.map(p => {
      const b = Array.isArray(p.boundaryPoints) && p.boundaryPoints.length >= 3 ? [...p.boundaryPoints, p.boundaryPoints[0]] : null;
      return {
        type: "Feature",
        geometry: b ? { type: "Polygon", coordinates: [b.map((pt: any) => [pt.lng, pt.lat])] } : { type: "Point", coordinates: [p.lng, p.lat] },
        properties: {
          code_parcelle: p.id, code_producteur: p.producerCode, producteur: p.producerName, cooperative: p.cooperativeName, culture: p.culture,
          surface_ha: p.surfaceHa, surface_ha_calculee: p.surfaceHaCalculated, village: p.village, commune: p.commune, departement: p.department,
          region: p.region, especes: p.species, varietes: p.varieties, annee_plantation: p.plantingYear, occupation_terrain: p.landTenure,
          agroforesterie: p.agroforestry, certification: p.certification, rendement_estime_t: p.estimatedYieldTonnes,
          statut_conformite: p.complianceStatus, date_collecte: p.createdAt,
        },
      };
    }),
  }, null, 2), "application/geo+json;charset=utf-8");


  const drawPdfMap = (pdf: any, items: any[], title: string, y: number, height: number) => {
    const pts: Array<{ lat: number; lng: number }> = [];
    items.forEach((p) => {
      if (Array.isArray(p.boundaryPoints) && p.boundaryPoints.length >= 3) {
        p.boundaryPoints.forEach((q: any) => {
          const lat = Number(q?.lat);
          const lng = Number(q?.lng);
          if (Number.isFinite(lat) && Number.isFinite(lng)) pts.push({ lat, lng });
        });
      } else {
        const lat = Number(p?.lat);
        const lng = Number(p?.lng);
        if (Number.isFinite(lat) && Number.isFinite(lng)) pts.push({ lat, lng });
      }
    });

    pdf.setFont("helvetica", "bold");
    pdf.setFontSize(9);
    pdf.setTextColor(55);
    pdf.text(title, 18, y - 4);

    pdf.setDrawColor(160);
    pdf.setFillColor(250);
    pdf.setLineWidth(0.3);
    pdf.rect(18, y, 174, height, "FD");

    if (!pts.length) {
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(9);
      pdf.setTextColor(100);
      pdf.text("Aucune donnée GPS disponible pour cette carte.", 24, y + height / 2);
      return;
    }

    const minLat = Math.min(...pts.map((q) => q.lat));
    const maxLat = Math.max(...pts.map((q) => q.lat));
    const minLng = Math.min(...pts.map((q) => q.lng));
    const maxLng = Math.max(...pts.map((q) => q.lng));

    // Padding + minimum span évitent les cartes écrasées lorsqu'un producteur
    // n'a qu'un seul point GPS ou des coordonnées très proches.
    const latSpan = Math.max(maxLat - minLat, 0.00005);
    const lngSpan = Math.max(maxLng - minLng, 0.00005);
    const padLat = latSpan * 0.08;
    const padLng = lngSpan * 0.08;
    const mapMinLat = minLat - padLat;
    const mapMaxLat = maxLat + padLat;
    const mapMinLng = minLng - padLng;
    const mapMaxLng = maxLng + padLng;
    const mapLatSpan = Math.max(mapMaxLat - mapMinLat, 0.0001);
    const mapLngSpan = Math.max(mapMaxLng - mapMinLng, 0.0001);

    const project = (lat: number, lng: number) => ({
      x: 24 + ((lng - mapMinLng) / mapLngSpan) * 162,
      y: y + height - 7 - ((lat - mapMinLat) / mapLatSpan) * (height - 14),
    });

    items.forEach((p, idx) => {
      const boundary = Array.isArray(p.boundaryPoints) && p.boundaryPoints.length >= 3
        ? p.boundaryPoints
            .map((q: any) => ({ lat: Number(q?.lat), lng: Number(q?.lng) }))
            .filter((q: any) => Number.isFinite(q.lat) && Number.isFinite(q.lng))
        : [];

      if (boundary.length >= 3) {
        const projected = boundary.map((q: any) => project(q.lat, q.lng));

        // Remplissage puis contour explicite : plus fiable que pdf.lines(..., "FD")
        // selon les versions de jsPDF.
        pdf.setFillColor(225, 238, 220);
        pdf.setDrawColor(45, 90, 55);
        pdf.setLineWidth(0.7);

        for (let i = 0; i < projected.length; i++) {
          const a = projected[i];
          const b = projected[(i + 1) % projected.length];
          pdf.line(a.x, a.y, b.x, b.y);
        }

        const cx = projected.reduce((sum: number, q: any) => sum + q.x, 0) / projected.length;
        const cy = projected.reduce((sum: number, q: any) => sum + q.y, 0) / projected.length;
        pdf.setFillColor(225, 238, 220);
        const path = projected.map((q: any, i: number) => ({ op: i === 0 ? "m" : "l", x: q.x, y: q.y }));
        path.push({ op: "l", x: projected[0].x, y: projected[0].y });
        try {
          pdf.path(path, "F");
        } catch {
          // Le contour reste visible même si la version de jsPDF ne supporte pas path().
        }

        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(6.5);
        pdf.setTextColor(35, 70, 40);
        pdf.text(String(p.id || ("PAR-" + (idx + 1))).slice(0, 18), cx, cy, { align: "center" });
      } else {
        const lat = Number(p?.lat);
        const lng = Number(p?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        const q = project(lat, lng);

        pdf.setDrawColor(35, 75, 150);
        pdf.setFillColor(220, 230, 250);
        pdf.circle(q.x, q.y, 2.8, "FD");
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(6.5);
        pdf.setTextColor(35, 60, 110);
        pdf.text(String(p.id || ("PAR-" + (idx + 1))).slice(0, 18), q.x + 4, q.y + 1.5);
      }
    });

    pdf.setFont("helvetica", "normal");
    pdf.setFontSize(6);
    pdf.setTextColor(110);
    pdf.text("Représentation spatiale basée sur les coordonnées GPS enregistrées dans AURUM.", 24, y + height - 2);
  };

  const exportGlobalPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({orientation:"portrait",unit:"mm",format:"a4"});
    const surface=parcelles.reduce((s,p)=>s+(Number(p.surfaceHaCalculated??p.surfaceHa)||0),0);
    pdf.setFont("helvetica","bold"); pdf.setFontSize(17); pdf.text("AURUM — Carte générale des parcelles",18,20);
    pdf.setFont("helvetica","normal"); pdf.setFontSize(9);
    pdf.text("Généré le "+new Date().toLocaleDateString("fr-FR"),18,27);
    pdf.text("Producteurs : "+producers.length+" | Parcelles : "+parcelles.length+" | Surface : "+surface.toFixed(2)+" ha",18,34);
    drawPdfMap(pdf,parcelles,"Carte spatiale générale",47,145);
    pdf.setFontSize(8); pdf.setTextColor(90); pdf.text("Polygones GPS disponibles et points GPS lorsque le polygone n'est pas disponible.",18,199);
    pdf.text("Document généré depuis AURUM SUPERVISOR. Les données originales restent dans AURUM.",18,288);
    pdf.save("AURUM_carte_generale-"+new Date().toISOString().slice(0,10)+".pdf");
  };

  const exportProducerReportsPdf = async () => {
    const { jsPDF } = await import("jspdf");
    const pdf = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const list = producers.filter((p) =>
      parcelles.some((q) => q.producerCode === p.producerCode || q.producerId === p.id),
    );

    if (!list.length) {
      toast.error("Aucun producteur avec des parcelles à rapporter.");
      return;
    }

    for (let pi = 0; pi < list.length; pi++) {
      const producer = list[pi];
      const ps = parcelles.filter(
        (q) => q.producerCode === producer.producerCode || q.producerId === producer.id,
      );
      const surface = ps.reduce(
        (s, p) => s + (Number(p.surfaceHaCalculated ?? p.surfaceHa) || 0),
        0,
      );

      // Chaque producteur commence par sa propre fiche + SA carte.
      if (pi > 0) pdf.addPage();
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(15);
      pdf.text("AURUM — Fiche de traçabilité producteur", 18, 18);
      pdf.setFontSize(12);
      pdf.text(String(producer.fullName || "Producteur"), 18, 31);
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(8);
      pdf.text(
        "Code : " + String(producer.producerCode || "—") +
        " | Coopérative : " + String(producer.cooperativeName || "—"),
        18, 38,
      );
      pdf.text(
        "Village : " + String(producer.village || "—") +
        " | Commune : " + String(producer.commune || "—") +
        " | Région : " + String(producer.region || "—"),
        18, 44,
      );
      pdf.text(
        "Parcelles : " + ps.length + " | Surface totale : " + surface.toFixed(2) + " ha",
        18, 50,
      );

      // QR de référence du producteur : seul le code producteur est encodé.
      // Il ne contient aucune donnée personnelle.
      try {
        const qrUrl = "https://api.qrserver.com/v1/create-qr-code/?size=220x220&data=" +
          encodeURIComponent("AURUM:PRODUCER:" + String(producer.producerCode || producer.id));
        const qrResponse = await fetch(qrUrl);
        if (qrResponse.ok) {
          const qrBlob = await qrResponse.blob();
          const qrDataUrl = await new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => typeof reader.result === "string" ? resolve(reader.result) : reject(new Error("QR invalide"));
            reader.onerror = () => reject(reader.error ?? new Error("Lecture QR impossible"));
            reader.readAsDataURL(qrBlob);
          });
          pdf.setFillColor(255, 255, 255);
          pdf.rect(174, 12, 24, 24, "F");
          pdf.addImage(qrDataUrl, "PNG", 176, 14, 20, 20);
          pdf.setFont("helvetica", "normal");
          pdf.setFontSize(6);
          pdf.setTextColor(90);
          pdf.text("QR producteur", 174, 39);
        }
      } catch {
        // Le PDF reste générable même si le service QR est indisponible.
      }

      // Carte individuelle du producteur : elle ne contient QUE ses parcelles.
      drawPdfMap(pdf, ps, "Carte individuelle du producteur", 59, 105);

      let y = 174;
      pdf.setFont("helvetica", "bold");
      pdf.setFontSize(9);
      pdf.text("Parcelles enregistrées", 18, y);
      y += 7;
      pdf.setFont("helvetica", "normal");
      pdf.setFontSize(7);

      ps.forEach((p, i) => {
        if (y > 270) {
          pdf.addPage();
          y = 20;
        }
        pdf.text(String(p.id || ("PAR-" + (i + 1))).slice(0, 20), 18, y);
        pdf.text(String(p.culture || "—").slice(0, 18), 60, y);
        pdf.text((Number(p.surfaceHaCalculated ?? p.surfaceHa) || 0).toFixed(2) + " ha", 100, y);
        pdf.text(Number.isFinite(Number(p.lat)) ? "GPS" : "Sans GPS", 132, y);
        pdf.text(String(p.complianceStatus || "—").slice(0, 16), 158, y);
        y += 5;
      });

      // Une page cartographique dédiée pour chaque parcelle du producteur.
      ps.forEach((p, idx) => {
        pdf.addPage();
        pdf.setFont("helvetica", "bold");
        pdf.setFontSize(13);
        pdf.text("Parcelle " + String(p.id || ("PAR-" + (idx + 1))), 18, 20);
        pdf.setFont("helvetica", "normal");
        pdf.setFontSize(8);

        const rows = [
          "Producteur : " + String(producer.fullName || "—"),
          "Code producteur : " + String(producer.producerCode || "—"),
          "Culture : " + String(p.culture || "—"),
          "Espèces : " + String(Array.isArray(p.species) ? p.species.join(", ") : (p.species || "—")),
          "Variétés : " + String(Array.isArray(p.varieties) ? p.varieties.join(", ") : (p.varieties || "—")),
          "Surface déclarée : " + String(p.surfaceHa || "—") + " ha | Surface calculée : " + String(p.surfaceHaCalculated || "—") + " ha",
          "GPS : " + (Number.isFinite(Number(p.lat)) ? String(p.lat) + ", " + String(p.lng) : "Non disponible"),
          "Année plantation : " + String(p.plantingYear || "—") + " | Agroforesterie : " + (p.agroforestry == null ? "—" : p.agroforestry ? "Oui" : "Non"),
          "Occupation : " + String(p.landTenure || "—") + " | Certification : " + String(p.certification || "—"),
          "Rendement estimé : " + String(p.estimatedYieldTonnes || "—") + " t | Conformité : " + String(p.complianceStatus || "—"),
          "Visites : " + String(p.visitCount || 0) + " | Collecte : " + (p.createdAt ? new Date(p.createdAt).toLocaleDateString("fr-FR") : "—"),
        ];
        rows.forEach((row, i) => pdf.text(row.slice(0, 115), 18, 30 + i * 5));
        drawPdfMap(pdf, [p], "Carte individuelle de la parcelle", 92, 145);
      });
    }

    pdf.save("AURUM_rapports_producteurs-" + new Date().toISOString().slice(0, 10) + ".pdf");
  };

  const polygons = parcelles.filter(p => Array.isArray(p.boundaryPoints) && p.boundaryPoints.length >= 3).length;
  const gps = parcelles.filter(p => typeof p.lat === "number" && typeof p.lng === "number").length;
  const surface = parcelles.reduce((sum, p) => sum + (Number(p.surfaceHaCalculated ?? p.surfaceHa) || 0), 0);

  return (
    <section className="glass-card mb-6 rounded-2xl p-5">
      <div className="mb-4"><h2 className="flex items-center gap-2 font-display text-lg"><Download className="h-4 w-4 text-gold"/> Restitution des données</h2><p className="mt-1 text-xs text-muted-foreground">Un classeur Excel structuré en 4 feuilles, plus le GeoJSON pour la cartographie. Les téléchargements sont des copies : la base AURUM reste inchangée.</p></div>
      {loading ? <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gold"/></div> : <>
        <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-4">{[["Producteurs",producers.length],["Parcelles",parcelles.length],["Polygones",polygons+"/"+parcelles.length],["Surface",surface.toFixed(2)+" ha"]].map(([l,v])=><div key={String(l)} className="rounded-xl border border-border bg-card/40 p-3"><p className="text-[10px] uppercase tracking-widest text-muted-foreground">{l}</p><p className="mt-1 text-xl font-semibold">{v}</p></div>)}</div>
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void exportWorkbook()} disabled={!producers.length && !parcelles.length} className="rounded-lg btn-gold px-3 py-2 text-xs disabled:opacity-40">Classeur Excel (4 feuilles)</button>
          <button type="button" onClick={() => void exportGlobalPdf()} disabled={!parcelles.length} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">Carte générale PDF</button>
          <button type="button" onClick={() => void exportProducerReportsPdf()} disabled={!producers.length || !parcelles.length} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">Rapports producteurs PDF</button>
          <button type="button" onClick={exportGeoJson} disabled={!parcelles.length} className="rounded-lg border border-border px-3 py-2 text-xs disabled:opacity-40">Parcelles GeoJSON</button>
        </div>
        <p className="mt-3 text-[11px] text-muted-foreground">GPS disponible : {gps}/{parcelles.length}. Le PDF général cartographie toutes les parcelles. Les rapports producteurs incluent la carte du producteur et une fiche cartographique pour chaque parcelle.</p>
      </>}
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
  const [exportingPdfId, setExportingPdfId] = useState<string | null>(null);
  const [exportingDocxId, setExportingDocxId] = useState<string | null>(null);

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

  async function handleExportReportPdf(r: AdvisorReport) {
    setExportingPdfId(r.id);
    try {
      const { exportAdvisorReportPdf } = await import("@/lib/exports");
      await exportAdvisorReportPdf({ createdAt: r.createdAt, documentsAnalyzed: r.documentsAnalyzed, analysis: r.analysis });
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de l'export PDF");
    } finally {
      setExportingPdfId(null);
    }
  }

  async function handleExportReportDocx(r: AdvisorReport) {
    setExportingDocxId(r.id);
    try {
      const { exportAdvisorReportDocx } = await import("@/lib/exports");
      await exportAdvisorReportDocx({ createdAt: r.createdAt, documentsAnalyzed: r.documentsAnalyzed, analysis: r.analysis });
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de l'export Word");
    } finally {
      setExportingDocxId(null);
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
                    {expanded && (
                      <div className="mt-2 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void handleExportReportPdf(r); }}
                          disabled={exportingPdfId === r.id}
                          className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                        >
                          {exportingPdfId === r.id ? "…" : "Exporter PDF"}
                        </button>
                        <button
                          type="button"
                          onClick={(e) => { e.stopPropagation(); void handleExportReportDocx(r); }}
                          disabled={exportingDocxId === r.id}
                          className="rounded-lg border border-border px-2.5 py-1 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                        >
                          {exportingDocxId === r.id ? "…" : "Exporter Word"}
                        </button>
                      </div>
                    )}
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

// ── AGRO : conformité EUDR — extension optionnelle du module agro ────────
// N'affiche strictement rien si 'eudr' n'est pas dans
// enabled_compliance_modules de l'organisation (vérifié côté serveur par
// getEudrCompliance, qui renvoie eudrEnabled: false sans rien calculer).

type EudrNonCompliantParcelle = {
  id: string;
  culture: string;
  missingPolygon: boolean;
  missingAttestation: boolean;
};

function EudrComplianceSection() {
  const fetchCompliance = useServerFn(getEudrCompliance);
  const [loading, setLoading] = useState(true);
  const [enabled, setEnabled] = useState(false);
  const [readinessRate, setReadinessRate] = useState(0);
  const [totalParcelles, setTotalParcelles] = useState(0);
  const [compliantCount, setCompliantCount] = useState(0);
  const [nonCompliant, setNonCompliant] = useState<EudrNonCompliantParcelle[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchCompliance({ data: undefined as any });
        if (cancelled) return;
        setEnabled(res.eudrEnabled);
        if (res.eudrEnabled) {
          setReadinessRate(res.readinessRate);
          setTotalParcelles(res.totalParcelles);
          setCompliantCount(res.compliantCount);
          setNonCompliant(res.nonCompliantParcelles);
        }
      } catch {
        // silencieux : section purement informative, et n'existe que si
        // l'extension EUDR est activée pour l'organisation
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Rien pendant le chargement (pas de flash d'un état "désactivé") et
  // rien du tout si l'extension n'est pas activée pour l'organisation.
  if (loading || !enabled) return null;

  return (
    <section className="glass-card mb-6 rounded-2xl p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg">
        <ShieldAlert className="h-4 w-4 text-gold" /> Conformité EUDR
      </h2>
      <div className="space-y-4">
        <div className="flex items-center gap-4">
          <div className="rounded-lg border border-border bg-card/30 px-4 py-3 text-center">
            <p className="font-display text-2xl text-gold">{readinessRate}%</p>
            <p className="text-[10px] uppercase tracking-widest text-muted-foreground">Score de préparation</p>
          </div>
          <p className="text-xs text-muted-foreground">
            {compliantCount} / {totalParcelles} parcelle{totalParcelles !== 1 ? "s" : ""} avec polygone GPS et attestation d'absence de déforestation.
          </p>
        </div>

        <div>
          <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
            Parcelles non conformes ({nonCompliant.length})
          </span>
          {nonCompliant.length === 0 ? (
            <p className="text-xs text-muted-foreground">Toutes les parcelles sont conformes.</p>
          ) : (
            <ul className="space-y-1.5">
              {nonCompliant.map((p) => (
                <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-card/30 px-3 py-2 text-xs">
                  <a href={`#parcelle-row-${p.id}`} className="font-medium text-foreground hover:text-gold hover:underline">
                    {p.culture}
                  </a>
                  <span className="text-muted-foreground">
                    {[
                      p.missingPolygon ? "Sans polygone GPS" : null,
                      p.missingAttestation ? "Sans attestation" : null,
                    ].filter(Boolean).join(" · ")}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
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

// ── Journal d'activité (audit_log) — lecture seule, superviseur/admin ────
// Couvre à la fois les entrées écrites manuellement par le code applicatif
// (créations/modifications/validations) et celles des triggers automatiques
// (voir migration 20260714150000_...sql) : les deux partagent la même
// table, cette vue ne fait pas de distinction. Fenêtre des 200 événements
// les plus récents de l'organisation ; filtres appliqués côté client, même
// convention que le reste de ce tableau de bord (ex. DataQualitySection).

const AUDIT_ACTION_LABELS: Record<string, string> = {
  creation: "Création",
  modification: "Modification",
  deletion: "Suppression",
};

const AUDIT_ENTITY_LABELS: Record<string, string> = {
  parcelle: "Parcelle",
  producer: "Producteur",
  cooperative: "Coopérative",
  document: "Document",
};

type AuditLogEntry = {
  id: string;
  action: string;
  entityType: string;
  entityId: string | null;
  actorId: string | null;
  actorName: string;
  createdAt: string;
};

function AuditLogSection() {
  const fetchAuditLog = useServerFn(listAuditLog);
  const [entries, setEntries] = useState<AuditLogEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [entityFilter, setEntityFilter] = useState<string>("all");
  const [actorFilter, setActorFilter] = useState<string>("all");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetchAuditLog({ data: undefined as any })
      .then((r) => { if (!cancelled) setEntries(r.entries); })
      .catch(() => { /* section purement informative */ })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const entityOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.entityType))),
    [entries],
  );
  const actorOptions = useMemo(
    () => Array.from(new Set(entries.map((e) => e.actorName))),
    [entries],
  );

  const filtered = entries.filter((e) => {
    if (entityFilter !== "all" && e.entityType !== entityFilter) return false;
    if (actorFilter !== "all" && e.actorName !== actorFilter) return false;
    return true;
  });

  return (
    <section className="glass-card mb-6 rounded-2xl p-5">
      <h2 className="mb-3 flex items-center gap-2 font-display text-lg">
        <History className="h-4 w-4 text-gold" /> Journal d'activité
      </h2>

      <div className="mb-4 flex flex-wrap gap-2">
        <select
          value={entityFilter}
          onChange={(e) => setEntityFilter(e.target.value)}
          className="rounded-lg border border-border bg-card/60 px-2.5 py-1.5 text-xs"
        >
          <option value="all">Tous les éléments</option>
          {entityOptions.map((t) => (
            <option key={t} value={t}>{AUDIT_ENTITY_LABELS[t] ?? t}</option>
          ))}
        </select>
        <select
          value={actorFilter}
          onChange={(e) => setActorFilter(e.target.value)}
          className="rounded-lg border border-border bg-card/60 px-2.5 py-1.5 text-xs"
        >
          <option value="all">Tous les utilisateurs</option>
          {actorOptions.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="h-5 w-5 animate-spin text-gold" /></div>
      ) : filtered.length === 0 ? (
        <p className="py-4 text-center text-sm text-muted-foreground">
          Aucune activité pour l'instant.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead>Utilisateur</TableHead>
                <TableHead>Action</TableHead>
                <TableHead>Élément</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filtered.map((e) => (
                <TableRow key={e.id}>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {new Date(e.createdAt).toLocaleString("fr-FR")}
                  </TableCell>
                  <TableCell className="text-sm">{e.actorName}</TableCell>
                  <TableCell className="text-sm">{AUDIT_ACTION_LABELS[e.action] ?? e.action}</TableCell>
                  <TableCell className="text-sm">{AUDIT_ENTITY_LABELS[e.entityType] ?? e.entityType}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}

function CommercialDataModuleSection() {
  const fetchAccess = useServerFn(getOrganizationCommercialAccess);
  const [access, setAccess] = useState<{ enabled: boolean; allowedScopes: string[] } | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchAccess({ data: undefined as any })
      .then((result) => {
        if (!cancelled) setAccess(result);
      })
      .catch(() => {
        if (!cancelled) setAccess({ enabled: false, allowedScopes: [] });
      });
    return () => { cancelled = true; };
  }, [fetchAccess]);

  if (!access?.enabled) return null;

  return (
    <section className="glass-card mb-6 rounded-2xl border border-gold/20 p-5">
      <div className="mb-2">
        <h2 className="font-display text-lg">Partenariat données</h2>
        <p className="mt-1 text-xs text-muted-foreground">
          Cette organisation bénéficie d’un dispositif de valorisation des données activé par AURUM.
        </p>
      </div>
      {access.allowedScopes.length > 0 && (
        <p className="text-xs text-muted-foreground">
          Périmètres autorisés : {access.allowedScopes.join(", ")}.
        </p>
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
  const [exportingActivities, setExportingActivities] = useState(false);
  const [openFolder, setOpenFolder] = useState<"overview" | "terrain" | "data" | "traceability" | "assistant" | "activities">("overview");

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

  async function handleExportActivitiesXlsx() {
    setExportingActivities(true);
    try {
      const { exportActivitiesXlsx } = await import("@/lib/exports");
      await exportActivitiesXlsx(filteredDocs.map((d) => ({
        agent: profilesById[d.user_id] || "Agent",
        title: d.title || "—",
        location: d.location_data?.city || d.location || "—",
        date: new Date(d.created_at).toLocaleString("fr-FR", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }),
        status: d.status === "ready" ? "Synchronisé" : "Brouillon",
      })));
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de l'export Excel");
    } finally {
      setExportingActivities(false);
    }
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

      <SupervisorFolder title="Vue d’ensemble" description="Indicateurs, carte et activité récente" open={openFolder === "overview"} onToggle={() => setOpenFolder("overview")}>
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
                <SupervisorMap docs={docs} />
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
        
              </SupervisorFolder>

      <SupervisorFolder title="Terrain & journal" description="Journal d’activité, parcelles et producteurs" icon={Folder} open={openFolder === "terrain"} onToggle={() => setOpenFolder("terrain")}>
              {/* Journal d'activité — pas réservé au module agro : documents couvre
                  tous les modules, et audit_log filtre déjà par organisation. */}
              <AuditLogSection />
        
              {/* AGRO — parcelles et producteurs (uniquement pour les superviseurs du module agro) */}
              {profile?.module_type === "agro" && (
                <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 [&>section]:mb-0">
                  <ParcellesSection />
                  <ProducersSection />
                </div>
              )}
        
              </SupervisorFolder>

      <SupervisorFolder title="Données" description="Restitution, qualité et analyse des données" icon={Folder} open={openFolder === "data"} onToggle={() => setOpenFolder("data")}>
              {/* AGRO — restitution prête pour le pilote UNAPROCAM */}
              {profile?.module_type === "agro" && <DataRestitutionSection />}
        
              {/* AGRO — qualité des données / alertes de doublons GPS */}
              {profile?.module_type === "agro" && <DataQualitySection />}
        
              {/* AGRO — Data Analyst (complétude, validation, volumes) */}
              {profile?.module_type === "agro" && <DataAnalystSection />}
        
              </SupervisorFolder>

      <SupervisorFolder title="Traçabilité & conformité" description="EUDR et fonctions de partenariat activés" icon={Folder} open={openFolder === "traceability"} onToggle={() => setOpenFolder("traceability")}>
              {/* AGRO — module de valorisation, visible uniquement si AURUM l'a activé */}
              {profile?.module_type === "agro" && <CommercialDataModuleSection />}
        
              {/* AGRO — Conformité EUDR (extension optionnelle, n'affiche rien si désactivée) */}
              {profile?.module_type === "agro" && <EudrComplianceSection />}
        
              </SupervisorFolder>

      <SupervisorFolder title="Assistant agricole" description="Assistant et recommandations pour l’agriculture" icon={Sprout} open={openFolder === "assistant"} onToggle={() => setOpenFolder("assistant")}>
              {/* AGRO — Assistant Agro (questions libres) et Agro Advisor (synthèse) — deux blocs distincts */}
              {profile?.module_type === "agro" && (
                <div className="mb-6 grid grid-cols-1 gap-4 md:grid-cols-2 [&>section]:mb-0">
                  <AgriAssistantSection />
                  <OrientationsSection />
                </div>
              )}
        
              </SupervisorFolder>

      <SupervisorFolder title="Activités" description="Alertes et opérations récentes" icon={Activity} open={openFolder === "activities"} onToggle={() => setOpenFolder("activities")}>
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
                    <button
                      type="button"
                      onClick={() => void handleExportActivitiesXlsx()}
                      disabled={exportingActivities || filteredDocs.length === 0}
                      className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40"
                    >
                      {exportingActivities ? "Export…" : "Exporter en Excel"}
                    </button>
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
      </SupervisorFolder>
    </div>
  );
}

function SupervisorFolder({ title, description, icon: Icon = Folder, open, onToggle, children }: { title: string; description: string; icon?: typeof Folder; open: boolean; onToggle: () => void; children: React.ReactNode }) {
  return (
    <section className="mb-4 overflow-hidden rounded-2xl border border-border bg-card/30 shadow-sm">
      <button type="button" onClick={onToggle} aria-expanded={open} className="flex w-full items-center gap-3 px-4 py-4 text-left transition-colors hover:bg-secondary/40 sm:px-5">
        <span className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border ${open ? "border-gold/30 bg-gold/10 text-gold" : "border-border bg-secondary/40 text-muted-foreground"}`}>
          <Icon className="h-5 w-5" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-base sm:text-lg">{title}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
        </span>
        <ChevronDown className={`h-5 w-5 shrink-0 text-muted-foreground transition-transform ${open ? "rotate-180 text-gold" : ""}`} />
      </button>
      {open && <div className="border-t border-border p-3 sm:p-5">{children}</div>}
    </section>
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
