import { createFileRoute, Link, useNavigate, useParams } from "@tanstack/react-router";
import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Mic, Square, Type, MicOff, ShieldAlert, ExternalLink, CloudOff, MapPin, Loader2, Camera, Video, X, VideoOff, AlertTriangle, CheckCircle2, Sprout } from "lucide-react";
import { toast } from "sonner";
import {
  saveAudio, enqueue, savePhoto, saveVideo, saveMissionFormsCache, getMissionFormsCache,
  saveParcellesCache, getParcellesCache, saveProducersCache, getProducersCache, saveRecordDraft, getRecordDraft, clearRecordDraft,
  enqueueParcelle, isLocalParcelleId, listPendingParcelles, subscribeQueue,
  type QueueMeta, type DocType, type GpsLocation, type ModuleType, type MissionForm, type CachedParcelle, type CachedProducer,
} from "@/lib/offline-store";
import { useOnline } from "@/hooks/use-online";
import { getProfile, generateReference } from "@/lib/profile-store";
import { useI18n } from "@/i18n";
import { captureGps } from "@/lib/geo";
import { computePolygonCenter, computePolygonAreaHectares, maxPairwiseDistanceMeters, haversineMeters, isDuplicatePoint, DUPLICATE_POINT_THRESHOLD_M } from "@/lib/geo-polygon";
import { useAuth } from "@/hooks/use-auth";
import { moduleForOrgType } from "@/lib/organization-context";
import { supabase } from "@/integrations/supabase/client";
import { listParcelles, listCooperatives, listProducers, checkGpsDuplicate, createParcelle, logUsedExistingParcelle } from "@/lib/agro.functions";
// Instrumentation de diagnostic pour la capture GPS/périmètre — no-op en
// production (voir debug-log.ts), gardée pour un futur diagnostic terrain.
import { debugLog, debugWarn, debugError } from "@/lib/debug-log";


function getPlatform(): { os: "ios" | "android" | "other"; browser: "safari" | "chrome" | "other" } {
  if (typeof navigator === "undefined") return { os: "other", browser: "other" };
  const ua = navigator.userAgent.toLowerCase();
  const isIOS = /iphone|ipad|ipod/.test(ua);
  const isAndroid = /android/.test(ua);
  const isSafari = /safari/.test(ua) && !/chrome|chromium|crios/.test(ua);
  const isChrome = /chrome|chromium|crios/.test(ua);
  return {
    os: isIOS ? "ios" : isAndroid ? "android" : "other",
    browser: isSafari ? "safari" : isChrome ? "chrome" : "other",
  };
}

function PermissionDeniedBanner({ onRetry }: { onRetry: () => void }) {
  const { t } = useI18n();
  const { os, browser } = getPlatform();
  let steps: string[] = [];
  let helpLabel = "";
  let helpUrl = "";

  if (os === "ios" || browser === "safari") {
    steps = [
      "Ouvrez l'app Réglages.",
      "Touchez Safari → Micro.",
      "Sélectionnez Autoriser pour ce site.",
      "Rechargez cette page.",
    ];
    helpLabel = "Aide Apple — permissions";
    helpUrl = "https://support.apple.com/fr-fr/guide/iphone/iph145586c2e/ios";
  } else if (os === "android" || browser === "chrome") {
    steps = [
      "Touchez le cadenas dans la barre d'adresse.",
      "Autorisations → Microphone → Autoriser.",
      "Rechargez la page.",
    ];
    helpLabel = "Aide Chrome — permissions";
    helpUrl = "https://support.google.com/chrome/answer/2693767?hl=fr";
  } else {
    steps = ["Ouvrez les réglages du navigateur, autorisez le microphone, rechargez la page."];
    helpLabel = "Aide";
    helpUrl = "https://support.google.com/chrome/answer/2693767?hl=fr";
  }

  return (
    <div className="mt-6 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
      <MicOff className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
      <div className="flex-1">
        <p className="font-medium">{t("record.denied_title")}</p>
        <p className="mt-1 text-muted-foreground">{t("record.denied_sub")}</p>
        <ol className="mt-2 list-decimal pl-5 text-muted-foreground space-y-0.5">
          {steps.map((s, i) => <li key={i}>{s}</li>)}
        </ol>
        <a href={helpUrl} target="_blank" rel="noopener noreferrer"
          className="mt-3 inline-flex items-center gap-1 text-xs text-gold hover:underline">
          <ExternalLink className="h-3.5 w-3.5" />
          {helpLabel}
        </a>
        <div className="mt-3">
          <button onClick={onRetry} className="rounded-lg btn-gold px-4 py-2 text-xs">{t("common.retry")}</button>
        </div>
      </div>
    </div>
  );
}

// Aperçu carte du périmètre en cours de capture — chargé dynamiquement
// (voir LeafletMaps.tsx) pour ne jamais alourdir l'écran de saisie quand
// l'agent n'utilise pas ce mode.
// Limite d'erreur (Error Boundary) autour de la section périmètre/surface.
// Un try/catch classique ne peut PAS attraper une exception levée pendant
// le rendu React d'un composant enfant (ex. Leaflet qui lève "Map container
// is already initialized" si PerimeterMapPreview est démonté/remonté trop
// vite au moment où boundaryClosed change) — seule une Error Boundary le
// peut. Sans ça, une telle exception blanchit silencieusement toute la
// section (texte de surface ET carte), ce qui correspond exactement au
// symptôme "rien ne s'affiche du tout".
class BoundaryRenderErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state: { error: Error | null } = { error: null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    debugError("[GPS DEBUG] RENDER CRASH dans la section Périmètre", {
      message: error.message,
      stack: error.stack,
      componentStack: info.componentStack,
    });
  }
  render() {
    if (this.state.error) {
      return (
        <p className="flex items-center gap-1.5 rounded-lg border border-red-500/30 bg-red-500/10 p-2 text-[11px] text-red-400">
          <AlertTriangle className="h-3 w-3 shrink-0" />
          Erreur d'affichage du périmètre — vos points GPS déjà capturés restent enregistrés. Réessayez, ou rechargez la page si le problème persiste.
        </p>
      );
    }
    return this.props.children;
  }
}

function PerimeterMapPreview({ points }: { points: Array<{ lat: number; lng: number }> }) {
  const [leafletMod, setLeafletMod] = useState<typeof import("@/components/LeafletMaps") | null>(null);

  useEffect(() => {
    let cancelled = false;
    import("@/components/LeafletMaps").then((m) => { if (!cancelled) setLeafletMod(m); });
    return () => { cancelled = true; };
  }, []);

  if (points.length === 0) return null;
  if (!leafletMod) {
    return <div className="h-40 w-full rounded-lg border border-border bg-secondary/40" />;
  }
  return <leafletMod.PerimeterLeafletMap points={points} />;
}

function pickMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "audio/webm;codecs=opus",
    "audio/webm",
    "audio/mp4;codecs=mp4a.40.2",
    "audio/mp4",
    "audio/ogg;codecs=opus",
  ];
  for (const m of candidates) {
    try { if ((MediaRecorder as any).isTypeSupported?.(m)) return m; } catch {}
  }
  return "";
}

function pickVideoMimeType(): string {
  if (typeof MediaRecorder === "undefined") return "";
  const candidates = [
    "video/webm;codecs=vp9,opus",
    "video/webm;codecs=vp8,opus",
    "video/webm",
    "video/mp4",
  ];
  for (const m of candidates) {
    try { if ((MediaRecorder as any).isTypeSupported?.(m)) return m; } catch {}
  }
  return "";
}

export const Route = createFileRoute("/_authenticated/record/$type")({
  component: RecordPage,
  head: () => ({ meta: [{ title: "Enregistrement — AURUM" }] }),
});



const VALID_TYPES = new Set<DocType>(["rapport", "pv", "mission_terrain", "enquete", "auto", "field_entry"]);

const MAX_VIDEO_SECONDS = 60;

// L'hectare (10 000 m²) est une trop grande unité pour un périmètre de test
// tracé sur quelques mètres (taps rapprochés sans déplacement réel) : à 2
// décimales, tout ce qui est en dessous de 0.005 ha arrondit à "0.00" et
// donne l'impression que rien n'a été calculé alors que le calcul tourne
// bien. On affiche davantage de décimales pour les petites surfaces, et le
// m² équivalent pour lever toute ambiguïté au moment du test.
function formatSurfaceHa(areaHa: number): string {
  if (areaHa <= 0) return "0.00";
  if (areaHa < 0.01) return areaHa.toFixed(4);
  return areaHa.toFixed(2);
}

// Au-delà de quelques centaines de mètres, ce n'est plus une question de
// réception GPS (arbres, bâtiments) mais le signe que l'appareil ne fournit
// pas du tout une position satellite — le navigateur retombe silencieusement
// sur une localisation réseau (Wi-Fi/antennes), qui ne bougera quasiment pas
// même après un vrai déplacement. Message distinct pour orienter vers le
// vrai réglage à vérifier plutôt que de suggérer de changer d'endroit.
const GPS_ACCURACY_WARN_THRESHOLD_M = 20;
const GPS_ACCURACY_NO_GPS_THRESHOLD_M = 500;

function gpsAccuracyWarning(accuracyM: number): string | null {
  if (accuracyM > GPS_ACCURACY_NO_GPS_THRESHOLD_M) {
    return `Précision très faible (±${Math.round(accuracyM)}m) — le téléphone ne semble pas utiliser le GPS, seulement une position réseau approximative. Vérifiez que la « position précise » est activée pour ce navigateur dans les réglages de localisation du téléphone.`;
  }
  if (accuracyM > GPS_ACCURACY_WARN_THRESHOLD_M) {
    return `Précision faible (±${Math.round(accuracyM)}m) — essayez un endroit plus dégagé, loin des bâtiments et arbres.`;
  }
  return null;
}

type LocalPhoto = { id: string; previewUrl: string };
type LocalVideo = { id: string; previewUrl: string; durationMs: number };

// ── Formulaire dynamique par mission ─────────────────────────────────────
// Configuré en base (table `mission_forms`), jamais codé en dur ici.
// Un module peut avoir plusieurs missions ; chaque mission définit ses
// propres champs. Voir docs/ARCHITECTURE — principe "Collecte guidée par
// le contexte".
//
// Réseau d'abord, repli sur le cache IndexedDB (offline-store.ts) :
// - En ligne, la requête réussit → on affiche le résultat et on rafraîchit
//   silencieusement le cache local pour la prochaine fois hors-ligne.
// - Hors-ligne (ou erreur réseau) avec un cache existant → on sert ce cache
//   sans bloquer l'agent.
// - Hors-ligne sans aucun cache (tout premier lancement, jamais été en
//   ligne) → aucun formulaire à proposer, on l'indique clairement plutôt
//   que de laisser l'écran silencieusement vide.
function useMissionForms(moduleType: ModuleType | undefined) {
  const [forms, setForms] = useState<MissionForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [offlineNoCache, setOfflineNoCache] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const mt = moduleType ?? "generic";
    (async () => {
      setLoading(true);
      setOfflineNoCache(false);
      try {
        const { data, error } = await supabase
          .from("mission_forms")
          .select("mission_key, mission_label, fields")
          .eq("module_type", mt)
          .order("sort_order", { ascending: true });
        if (error) throw error;
        const fetched = (data ?? []) as unknown as MissionForm[];
        if (cancelled) return;
        setForms(fetched);
        setOfflineNoCache(false);
        setLoading(false);
        void saveMissionFormsCache(mt, fetched);
      } catch {
        const cached = await getMissionFormsCache(mt);
        if (cancelled) return;
        if (cached) {
          setForms(cached);
          setOfflineNoCache(false);
        } else {
          setForms([]);
          setOfflineNoCache(true);
        }
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [moduleType]);

  return { forms, loading, offlineNoCache };
}

function RecordPage() {
  const { type } = useParams({ from: "/_authenticated/record/$type" });
  const { profile } = useAuth();
  const moduleFromProfile = (profile?.module_type as ModuleType | undefined)
    ?? moduleForOrgType(profile?.organization_type);
  const docType: DocType = (VALID_TYPES.has(type as DocType) ? (type as DocType) : "field_entry");
  const navigate = useNavigate();
  const online = useOnline();
  const { t, lang } = useI18n();

  const { forms: missionForms, loading: missionFormsLoading, offlineNoCache: missionFormsOfflineNoCache } = useMissionForms(moduleFromProfile);
  const [missionKey, setMissionKey] = useState<string>("");

  // Brouillon persistant (mission active, champs saisis, métadonnées) — tenté
  // une seule fois au montage, avant toute sélection par défaut. Corrige un
  // bug où un simple rechargement de page réinitialisait systématiquement la
  // mission vers la première par défaut (ex. "Recensement des plantations"),
  // empêchant en pratique toute saisie sur "Visite de parcelle"/"Suivi de
  // parcelle" après un rechargement.
  const [draftCheckDone, setDraftCheckDone] = useState(false);
  useEffect(() => {
    (async () => {
      try {
        const draft = await getRecordDraft();
        if (draft) {
          if (draft.missionKey) setMissionKey(draft.missionKey);
          if (draft.fieldValues) setFieldValues(draft.fieldValues);
          if (draft.agentName) setAgentName(draft.agentName);
          if (draft.location) setLocation(draft.location);
          if (draft.docDate) setDocDate(draft.docDate);
          if (draft.docTime) setDocTime(draft.docTime);
          if (draft.gps) setGps(draft.gps);
          if (draft.createdParcelleId) setCreatedParcelleId(draft.createdParcelleId);
        }
      } catch {
        // Pas de brouillon récupérable — on repart d'un état neutre.
      } finally {
        setDraftCheckDone(true);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // BUG CORRIGÉ ICI (2e passe) : la première correction ne vidait le
  // brouillon que sur un clic explicite du lien "retour" en haut de l'écran.
  // Ça ne couvre pas tous les cas réels de sortie — en particulier le bouton
  // "retour" matériel / le geste de retour du téléphone (Android notamment),
  // qui ne déclenche PAS le onClick du lien : il fait sortir l'écran par
  // l'historique de navigation, sans jamais passer par ce gestionnaire. Le
  // brouillon (dont "GPS capturé") restait donc résident dans ce cas précis,
  // exactement comme rapporté sur le terrain malgré la première correction.
  //
  // Fix robuste : nettoyage au DÉMONTAGE du composant, quel qu'en soit le
  // déclencheur (lien, bouton retour matériel, navigation programmatique
  // ailleurs dans l'app) — un vrai rechargement de page, lui, ne déclenche
  // jamais ce nettoyage (le contexte JS est détruit sans qu'aucun cleanup
  // React ne s'exécute), donc la reprise après un rechargement accidentel
  // reste intacte. Idempotent (suppression d'une clé déjà absente = no-op),
  // donc sans risque même si stopAndSave/submitManual ont déjà vidé le
  // brouillon juste avant.
  useEffect(() => {
    return () => {
      void clearRecordDraft();
    };
  }, []);

  useEffect(() => {
    // Attend la tentative de restauration du brouillon avant de retomber sur
    // la première mission par défaut, sinon le défaut gagnerait toujours la
    // course contre la lecture (asynchrone) du brouillon.
    if (!draftCheckDone) return;
    if (missionForms.length > 0 && !missionKey) {
      setMissionKey(missionForms[0].mission_key);
    }
  }, [missionForms, missionKey, draftCheckDone]);

  const activeMission = missionForms.find(m => m.mission_key === missionKey);
  const missionFields = activeMission?.fields ?? [];

  const [supported, setSupported] = useState(true);
  const [secureOk, setSecureOk] = useState(true);
  const [permission, setPermission] = useState<"unknown" | "prompt" | "granted" | "denied">("unknown");
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [manual, setManual] = useState(false);
  const [manualText, setManualText] = useState("");
  const [saving, setSaving] = useState(false);

  // Metadata
  const now = new Date();
  const [agentName, setAgentName] = useState("");
  const [location, setLocation] = useState("");
  const [docDate, setDocDate] = useState(now.toISOString().slice(0, 10));
  const [docTime, setDocTime] = useState(now.toTimeString().slice(0, 5));
  const [gps, setGps] = useState<GpsLocation | null>(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  // Déclaré ici (avant l'effet de sauvegarde du brouillon juste en dessous,
  // qui le persiste) plutôt qu'avec le reste de l'état "liaison parcelle"
  // plus bas dans ce composant.
  const [createdParcelleId, setCreatedParcelleId] = useState<string | null>(null);

  // Note : la réinitialisation des champs saisis quand l'agent change de
  // mission se fait directement dans le onChange du sélecteur de mission
  // (pas ici via un effet générique sur `missionKey`) — sinon cet effet se
  // déclencherait aussi lors de la restauration d'un brouillon persistant et
  // effacerait les champs qu'on vient tout juste de restaurer.

  // Persiste le brouillon en continu (mission, champs, métadonnées) —
  // silencieusement, sans bloquer l'agent. Attend la tentative de
  // restauration initiale pour ne pas écraser un brouillon existant avec
  // l'état neutre du tout premier rendu.
  useEffect(() => {
    if (!draftCheckDone) return;
    void saveRecordDraft({
      missionKey, fieldValues, agentName, location, docDate, docTime,
      gps: gps ?? undefined,
      // Persisté aussi : sans ça, un rechargement pendant une création de
      // parcelle hors-ligne perdrait le lien vers `pendingParcelles` côté
      // React (l'entrée locale, elle, survivrait — mais plus rien ne
      // saurait qu'elle est liée à cette saisie en cours).
      createdParcelleId: createdParcelleId ?? undefined,
    });
  }, [draftCheckDone, missionKey, fieldValues, agentName, location, docDate, docTime, gps, createdParcelleId]);

  // ── AGRO : liaison parcelle (recensement_plantations / visite_parcelle / suivi_parcelle) ──
  // Comportement fixe et exclusif par mission — jamais de bascule manuelle :
  //   - recensement_plantations : toujours le formulaire de création.
  //   - visite_parcelle / suivi_parcelle : toujours la liste des parcelles existantes.
  const fetchParcelles = useServerFn(listParcelles);
  const fetchCooperatives = useServerFn(listCooperatives);
  const fetchProducers = useServerFn(listProducers);
  const checkDup = useServerFn(checkGpsDuplicate);
  const createParc = useServerFn(createParcelle);
  const logUsedExisting = useServerFn(logUsedExistingParcelle);

  const isParcelleCreationMission = moduleFromProfile === "agro" && missionKey === "recensement_plantations";
  const isParcelleSelectionMission =
    moduleFromProfile === "agro" && (missionKey === "visite_parcelle" || missionKey === "suivi_parcelle");
  const isParcelleMission = isParcelleCreationMission || isParcelleSelectionMission;

  const [parcelleMode, setParcelleMode] = useState<"existing" | "new">("existing");
  const [parcelleList, setParcelleList] = useState<CachedParcelle[]>([]);
  const [parcellesLoading, setParcellesLoading] = useState(false);
  // Missions "existing_only" (visite_parcelle / suivi_parcelle) uniquement :
  // hors-ligne sans aucun cache local, la sélection de parcelle — pourtant
  // obligatoire pour ces missions — est tout simplement impossible. On le
  // signale explicitement plutôt que de laisser passer une saisie orpheline.
  const [parcellesOfflineNoCache, setParcellesOfflineNoCache] = useState(false);
  const [selectedParcelleId, setSelectedParcelleId] = useState("");
  const [coopNames, setCoopNames] = useState<string[]>([]);
  const [producerNames, setProducerNames] = useState<string[]>([]);
  const [newCulture, setNewCulture] = useState("");
  const [newSurface, setNewSurface] = useState("");
  const [newCoop, setNewCoop] = useState("");
  const [newProducer, setNewProducer] = useState("");
  const [dupParcelle, setDupParcelle] = useState<null | { id: string; culture: string; distanceMeters: number }>(null);
  const [creatingParcelle, setCreatingParcelle] = useState(false);
  const [forceReason, setForceReason] = useState("");

  // Capture de périmètre (polygone) — complément du point unique existant.
  const [boundaryPoints, setBoundaryPoints] = useState<Array<{ lat: number; lng: number; accuracy?: number }>>([]);
  const [boundaryClosed, setBoundaryClosed] = useState(false);
  const [capturingBoundaryPoint, setCapturingBoundaryPoint] = useState(false);

  // Changement de mission → repartir d'un état parcelle neutre, avec le
  // mode fixé par la mission (jamais un choix libre de l'agent).
  useEffect(() => {
    setParcelleMode(isParcelleCreationMission ? "new" : "existing");
    setSelectedParcelleId("");
    setDupParcelle(null);
    setCreatedParcelleId(null);
    setForceReason("");
    setBoundaryPoints([]);
    setBoundaryClosed(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [missionKey]);

  // Chargement des parcelles et coopératives de l'organisation.
  // recensement_plantations (create_only) : comportement inchangé — chargé
  // en ligne uniquement, silencieux et non bloquant hors-ligne (la mission
  // ne nécessite pas de liste, juste des suggestions coop/producteur).
  // visite_parcelle / suivi_parcelle (existing_only) : réseau d'abord, repli
  // sur le cache IndexedDB (offline-store.ts) — la liste est indispensable
  // à la sélection obligatoire, donc mise en cache à chaque succès réseau
  // et relue hors-ligne, avec un message explicite si aucun cache n'existe.
  const parcellesCacheKey = profile?.id ?? "default";

  useEffect(() => {
    if (!isParcelleMission) return;
    let cancelled = false;
    const keyAtRunStart = parcellesCacheKey;
    (async () => {
      setParcellesLoading(true);
      if (isParcelleSelectionMission) setParcellesOfflineNoCache(false);
      try {
        if (!online) throw new Error("offline");
        const [p, c, pr] = await Promise.all([
          fetchParcelles({ data: undefined as any }),
          fetchCooperatives({ data: undefined as any }),
          fetchProducers({ data: undefined as any }),
        ]);
        if (cancelled) return;
        setParcelleList(p.parcelles);
        setCoopNames(c.cooperatives.map(x => x.name));
        setProducerNames(pr.producers.map(x => x.fullName));
        if (isParcelleSelectionMission) {
          setParcellesOfflineNoCache(false);
          void saveParcellesCache(keyAtRunStart, p.parcelles);
        }
      } catch (err) {
        if (!isParcelleSelectionMission) {
          // recensement_plantations hors-ligne : pas de liste requise, juste
          // pas de suggestions coop/producteur — comportement inchangé.
          if (!cancelled) setParcelleList([]);
        } else {
          const cached = await getParcellesCache(keyAtRunStart);
          if (cancelled) return;
          if (cached) {
            setParcelleList(cached);
            setParcellesOfflineNoCache(false);
          } else {
            setParcelleList([]);
            setParcellesOfflineNoCache(true);
          }
        }
      } finally {
        if (!cancelled) setParcellesLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParcelleMission, isParcelleSelectionMission, online, parcellesCacheKey]);

  // Parcelles créées hors-ligne dans CETTE session (pas encore synchronisées,
  // voir pendingParcelles dans offline-store.ts) — doivent être sélectionnables
  // pour visite_parcelle/suivi_parcelle comme n'importe quelle autre parcelle,
  // sinon une parcelle recensée hors-ligne reste inutilisable pour une visite
  // tant que la synchronisation n'a pas eu lieu (impossible offline). Jamais
  // écrites dans parcellesCache : ce cache reflète le serveur, pas l'état
  // local éphémère de la file en attente.
  const [pendingParcellesForSelection, setPendingParcellesForSelection] = useState<
    Array<{ id: string; culture: string; surfaceHa: number | null; cooperativeName: string | null }>
  >([]);
  useEffect(() => {
    if (!isParcelleSelectionMission) return;
    let cancelled = false;
    async function refresh() {
      const all = await listPendingParcelles();
      if (cancelled) return;
      setPendingParcellesForSelection(all.map(p => ({
        id: p.id,
        culture: p.culture,
        surfaceHa: p.surfaceHa ?? null,
        cooperativeName: p.cooperativeName ?? null,
      })));
    }
    void refresh();
    const unsub = subscribeQueue(() => { void refresh(); });
    return () => { cancelled = true; unsub(); };
  }, [isParcelleSelectionMission]);

  // Fusion pour l'affichage/la sélection uniquement — parcelleList (serveur
  // ou cache) reste la source de vérité inchangée pour saveParcellesCache.
  const selectableParcelles: Array<CachedParcelle & { pending?: boolean }> = isParcelleSelectionMission
    ? [...parcelleList, ...pendingParcellesForSelection.map(p => ({ ...p, pending: true }))]
    : parcelleList;

  // Bloque le démarrage/l'envoi de la saisie : la mission exige une parcelle
  // liée, mais la liste serveur n'a jamais été mise en cache ET aucune
  // parcelle en attente de synchro (créée offline dans cette session) n'est
  // disponible non plus — sinon une parcelle recensée hors-ligne juste avant
  // suffirait à débloquer la mission.
  const parcelleSelectionUnavailable =
    isParcelleSelectionMission && parcellesOfflineNoCache && pendingParcellesForSelection.length === 0;

  // Vérification automatique des doublons GPS dès qu'une position est capturée
  // en mode "Nouvelle parcelle"
  useEffect(() => {
    if (!isParcelleMission || parcelleMode !== "new" || !gps || !online || createdParcelleId) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await checkDup({ data: { lat: gps.lat, lng: gps.lng } });
        if (!cancelled) setDupParcelle(res.duplicate ? res.existingParcelle : null);
      } catch {
        // silencieux
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isParcelleMission, parcelleMode, gps, online, createdParcelleId]);

  function useExistingDuplicate() {
    if (!dupParcelle || !gps) return;
    // Si la parcelle détectée n'est pas encore dans la liste locale, on l'ajoute
    setParcelleList(prev => prev.some(p => p.id === dupParcelle.id)
      ? prev
      : [{ id: dupParcelle.id, culture: dupParcelle.culture, surfaceHa: null, cooperativeName: null }, ...prev]);
    setSelectedParcelleId(dupParcelle.id);
    setParcelleMode("existing");
    setForceReason("");
    // Journalisation qualité des données — en arrière-plan, ne bloque jamais
    // le flux de l'agent (le serveur avale déjà ses propres erreurs, mais on
    // se protège aussi côté client par sécurité).
    void logUsedExisting({
      data: {
        existingParcelleId: dupParcelle.id,
        lat: gps.lat,
        lng: gps.lng,
        distanceMeters: dupParcelle.distanceMeters,
      },
    }).catch(() => {});
    setDupParcelle(null);
  }

  // Capture de périmètre — l'agent tape "Ajouter un point" à chaque coin de
  // la parcelle en se déplaçant, puis "Terminer le périmètre" pour fermer
  // le polygone. Le centre calculé remplace alors le point GPS unique.
  async function handleAddBoundaryPoint() {
    debugLog("[GPS DEBUG] handleAddBoundaryPoint called", { currentPointCount: boundaryPoints.length });
    setCapturingBoundaryPoint(true);
    try {
      // maximumAgeMs=0 : force une lecture GPS fraîche à chaque point — le
      // cache par défaut de captureGps() (5 min) renverrait sinon la même
      // position pour plusieurs points tapés à la suite sans déplacement
      // réel, produisant un périmètre dégénéré (surface calculée à 0).
      const p = await captureGps(undefined, 0);
      debugLog("[GPS DEBUG] handleAddBoundaryPoint got result from captureGps", p);
      if (!p) {
        debugError("[GPS DEBUG] captureGps returned null — aucun point ajouté");
        toast.error("Position GPS indisponible");
        return;
      }
      // BUG CORRIGÉ ICI : ce contrôle calculait bien minDist mais ne faisait
      // qu'avertir (toast) — setBoundaryPoints s'exécutait ensuite sans
      // condition, donc le doublon était ajouté quand même. Confirmé en
      // terrain : minDist=0 détecté correctement, point ajouté malgré tout
      // → périmètre à 4 points dont 2 identiques → aire dégénérée = 0.
      // Le seuil suivait aussi l'accuracy GPS (ex. 700m), ce qui aurait
      // rejeté presque tous les points dès que la précision est mauvaise —
      // remplacé par un seuil fixe (DUPLICATE_POINT_THRESHOLD_M, 5m),
      // indépendant de l'accuracy : il ne sert qu'à repérer un vrai doublon
      // (même position renvoyée deux fois), pas à juger de la précision
      // générale (déjà couvert séparément par gpsAccuracyWarning et
      // l'avertissement de fiabilité dans handleFinishBoundary).
      if (isDuplicatePoint(boundaryPoints, { lat: p.lat, lng: p.lng })) {
        const minDist = boundaryPoints.length > 0
          ? Math.min(...boundaryPoints.map(existing => haversineMeters(existing, { lat: p.lat, lng: p.lng })))
          : 0;
        debugWarn("[GPS DEBUG] handleAddBoundaryPoint REJECTED — doublon détecté", { minDist, threshold: DUPLICATE_POINT_THRESHOLD_M });
        toast.error(`Point trop proche du précédent (${Math.round(minDist)}m) — déplacez-vous et réessayez.`);
        return;
      }
      setBoundaryPoints(prev => {
        const next = [...prev, { lat: p.lat, lng: p.lng, accuracy: p.accuracy }];
        debugLog("[GPS DEBUG] boundaryPoints updated", { previousCount: prev.length, newCount: next.length, newPoint: { lat: p.lat, lng: p.lng, accuracy: p.accuracy } });
        return next;
      });
      if (p.accuracy != null) {
        const warning = gpsAccuracyWarning(p.accuracy);
        if (warning) toast.warning(warning);
      }
    } finally {
      setCapturingBoundaryPoint(false);
    }
  }

  function handleFinishBoundary() {
    debugLog("[GPS DEBUG] handleFinishBoundary called", {
      pointCount: boundaryPoints.length,
      points: boundaryPoints,
    });
    if (boundaryPoints.length < 3) {
      debugError("[GPS DEBUG] handleFinishBoundary aborted — moins de 3 points", { pointCount: boundaryPoints.length });
      return;
    }
    const center = computePolygonCenter(boundaryPoints);
    debugLog("[GPS DEBUG] handleFinishBoundary computed center", center);
    // Comportement voulu (voir commentaire au-dessus de handleAddBoundaryPoint) :
    // le "GPS capturé" affiché en haut du formulaire est UN SEUL point, utilisé
    // quand aucun périmètre n'est tracé. Terminer un périmètre écrase toujours
    // ce point par le centre du polygone — les deux ne sont jamais montrés
    // comme deux valeurs indépendantes.
    setGps({ lat: center.lat, lng: center.lng });
    setBoundaryClosed(true);
    // Reporte la surface calculée depuis le périmètre dans le champ Surface
    // — jusqu'ici la valeur n'était affichée qu'en texte informatif
    // ("surface estimée : X ha") sans jamais alimenter le champ réellement
    // envoyé à la création de la parcelle (newSurface), qui restait vide
    // tant que l'agent ne la retapait pas à la main. Reste modifiable
    // ensuite si l'agent veut corriger.
    const area = computePolygonAreaHectares(boundaryPoints);
    debugLog("[GPS DEBUG] handleFinishBoundary computed area", { areaHa: area, formatted: formatSurfaceHa(area) });
    if (area > 0) {
      setNewSurface(formatSurfaceHa(area));
      debugLog("[GPS DEBUG] handleFinishBoundary called setNewSurface", formatSurfaceHa(area));
    } else {
      debugWarn("[GPS DEBUG] handleFinishBoundary — area <= 0, newSurface NOT updated", { area, points: boundaryPoints });
    }

    // Distingue "vrai périmètre minuscule" de "points trop rapprochés par
    // rapport au bruit de mesure GPS" — sans ça, une surface proche de 0
    // s'affiche sans qu'on sache si c'est un vrai résultat ou un artefact
    // de précision. On compare l'écart maximal entre deux points du
    // périmètre à la précision GPS moyenne obtenue : des points plus
    // proches l'un de l'autre que leur propre marge d'incertitude ne sont
    // pas fiablement distincts, quelle que soit la surface qui en ressort.
    const accuracies = boundaryPoints.map(p => p.accuracy).filter((a): a is number => a != null);
    const avgAccuracy = accuracies.length > 0 ? accuracies.reduce((s, a) => s + a, 0) / accuracies.length : null;
    const spread = maxPairwiseDistanceMeters(boundaryPoints);
    debugLog("[GPS DEBUG] handleFinishBoundary reliability check", { spreadMeters: spread, avgAccuracy });
    if (avgAccuracy != null && spread < avgAccuracy * 2) {
      toast.warning(
        `Surface peu fiable : les points sont espacés d'à peine ${Math.round(spread)}m, à comparer à une précision GPS moyenne de ±${Math.round(avgAccuracy)}m. Éloignez-vous davantage entre chaque point, ou améliorez la précision GPS (ciel dégagé) avant de retracer le périmètre.`,
      );
    }
  }

  function handleResetBoundary() {
    setBoundaryPoints([]);
    setBoundaryClosed(false);
  }

  async function handleCreateParcelle(force: boolean) {
    if (!gps) { toast.error("Capturez d'abord la position GPS (section ci-dessus)."); return; }
    if (!newCulture.trim()) { toast.error("Indiquez la culture de la parcelle."); return; }
    const surface = newSurface.trim() ? Number(newSurface) : undefined;
    if (surface !== undefined && (!Number.isFinite(surface) || surface <= 0)) {
      toast.error("Surface invalide.");
      return;
    }
    if (force && forceReason.trim().length < 10) {
      toast.error("Indiquez une justification d'au moins 10 caractères.");
      return;
    }
    const useBoundary = boundaryClosed && boundaryPoints.length >= 3;
    setCreatingParcelle(true);
    try {
      // BUG CORRIGÉ ICI : createParc() est un appel serveur direct — sans
      // réseau, il échouait systématiquement (voir catch plus bas), alors
      // que la saisie elle-même (le document) survit hors-ligne via la file
      // `queue`/enqueue(). La création de parcelle n'avait pas d'équivalent.
      // Hors-ligne, on stocke donc la demande localement (pendingParcelles,
      // id temporaire préfixé) — rejouée par le sync engine via ce MÊME
      // createParcelle() dès le retour du réseau (donc avec la même
      // détection de doublon et la même journalisation audit_log, pas une
      // version dégradée). La détection de doublon ne peut pas s'exécuter
      // hors-ligne (elle interroge la base) : elle est donc différée elle
      // aussi, et gérée au retour du réseau (voir useSyncEngine +
      // /parcelles, qui affiche les conflits à résoudre).
      if (!online) {
        const pending = await enqueueParcelle({
          culture: newCulture.trim(),
          surfaceHa: surface,
          cooperativeName: newCoop.trim() || undefined,
          producerName: newProducer.trim() || undefined,
          lat: gps.lat,
          lng: gps.lng,
          boundaryPoints: useBoundary ? boundaryPoints : undefined,
        });
        setCreatedParcelleId(pending.id);
        setDupParcelle(null);
        setForceReason("");
        toast.success("Parcelle enregistrée hors-ligne — sera synchronisée au retour du réseau");
        return;
      }
      const res = await createParc({
        data: {
          culture: newCulture.trim(),
          surfaceHa: surface,
          cooperativeName: newCoop.trim() || undefined,
          producerName: newProducer.trim() || undefined,
          lat: gps.lat,
          lng: gps.lng,
          forceCreate: force,
          reason: force ? forceReason.trim() : undefined,
          boundaryPoints: useBoundary ? boundaryPoints : undefined,
        },
      });
      if (!res.success && res.duplicateFound) {
        setDupParcelle(res.existingParcelle);
        return;
      }
      if (res.success) {
        setCreatedParcelleId(res.parcelleId);
        setDupParcelle(null);
        setForceReason("");
        toast.success("Parcelle créée — elle sera liée à cette saisie");
      }
    } catch (e: any) {
      toast.error(e?.message ?? "Échec de la création de la parcelle");
    } finally {
      setCreatingParcelle(false);
    }
  }

  // Photos & vidéos jointes
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const [videos, setVideos] = useState<LocalVideo[]>([]);
  const [videoRecording, setVideoRecording] = useState(false);
  const [videoElapsed, setVideoElapsed] = useState(0);

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  const photoInputRef = useRef<HTMLInputElement | null>(null);
  const videoRecRef = useRef<MediaRecorder | null>(null);
  const videoChunksRef = useRef<Blob[]>([]);
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const videoStartedAtRef = useRef<number>(0);
  const videoPreviewRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    const p = getProfile();
    if (p.name) setAgentName(p.name);
    if (p.defaultLocation) setLocation(p.defaultLocation);

    if (typeof window === "undefined") return;
    const secure = window.isSecureContext || window.location.hostname === "localhost";
    setSecureOk(secure);
    const hasMedia = !!(navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
    const hasRec = typeof MediaRecorder !== "undefined";
    if (!hasMedia || !hasRec) setSupported(false);
    const perms = (navigator as any).permissions;
    if (perms?.query) {
      perms.query({ name: "microphone" as PermissionName })
        .then((status: any) => {
          setPermission(status.state);
          status.onchange = () => setPermission(status.state);
        })
        .catch(() => {});
    }
    return () => {
      try { recRef.current?.stop(); } catch {}
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      try { videoRecRef.current?.stop(); } catch {}
      videoStreamRef.current?.getTracks().forEach(t => t.stop());
      if (videoTimerRef.current) clearInterval(videoTimerRef.current);
      photos.forEach(p => URL.revokeObjectURL(p.previewUrl));
      videos.forEach(v => URL.revokeObjectURL(v.previewUrl));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildMeta(): QueueMeta {
    const p = getProfile();
    const hasFieldValues = Object.keys(fieldValues).length > 0;
    return {
      agentName: agentName.trim() || p.name,
      location: location.trim(),
      docDate,
      docTime,
      reference: generateReference(),
      signatureName: p.signature || agentName.trim() || p.name,
      lang,
      gps: gps ?? undefined,
      autoDetect: docType === "auto",
      moduleType: moduleFromProfile,
      fieldData: (hasFieldValues || missionKey)
        ? { ...(missionKey ? { _mission_key: missionKey } : {}), ...fieldValues }
        : undefined,
      parcelleId: isParcelleMission
        ? ((parcelleMode === "existing" ? selectedParcelleId : createdParcelleId) || undefined)
        : undefined,
    };
  }


  async function handleCaptureGps() {
    setGpsLoading(true);
    try {
      // maximumAgeMs=0 : un tap sur ce bouton est toujours une demande
      // explicite de position À JOUR (y compris pour re-capturer après
      // s'être déplacé) — le cache par défaut de captureGps() renverrait
      // sinon la même position déjà connue, donnant l'impression que le
      // bouton ne fait rien.
      const g = await captureGps(undefined, 0);
      if (!g) toast.error("Position GPS indisponible");
      else { setGps(g); toast.success("Position GPS capturée"); }
    } finally { setGpsLoading(false); }
  }

  // ── Photos ──────────────────────────────────────────────────────────

  async function handlePhotoSelected(e: React.ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = "";
    for (const file of files) {
      try {
        const id = await savePhoto(file, file.type || "image/jpeg", file.name || "photo.jpg");
        setPhotos(prev => [...prev, { id, previewUrl: URL.createObjectURL(file) }]);
      } catch {
        toast.error("Impossible d'ajouter cette photo");
      }
    }
  }

  function removePhoto(id: string) {
    setPhotos(prev => {
      const found = prev.find(p => p.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter(p => p.id !== id);
    });
  }

  // ── Vidéo (courte preuve terrain, ≤ 60s) ────────────────────────────

  async function startVideo() {
    if (!secureOk) { toast.error("HTTPS requis"); return; }
    if (!navigator.mediaDevices?.getUserMedia) { toast.error("Caméra indisponible."); return; }
    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "environment" },
        audio: true,
      });
    } catch (err: any) {
      toast.error("Accès caméra refusé : " + (err?.message || err?.name || "inconnu"));
      return;
    }
    if (videoPreviewRef.current) {
      videoPreviewRef.current.srcObject = stream;
      void videoPreviewRef.current.play().catch(() => {});
    }
    const mime = pickVideoMimeType();
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e: any) {
      stream.getTracks().forEach(t => t.stop());
      toast.error("Impossible de démarrer la vidéo : " + e.message);
      return;
    }
    videoChunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) videoChunksRef.current.push(e.data); };
    rec.start(1000);
    videoRecRef.current = rec;
    videoStreamRef.current = stream;
    videoStartedAtRef.current = Date.now();
    setVideoElapsed(0);
    setVideoRecording(true);
    videoTimerRef.current = setInterval(() => {
      setVideoElapsed(s => {
        const next = s + 1;
        if (next >= MAX_VIDEO_SECONDS) {
          void stopVideo();
        }
        return next;
      });
    }, 1000);
  }

  async function stopVideo() {
    const rec = videoRecRef.current;
    const stream = videoStreamRef.current;
    if (!rec) return;
    if (videoTimerRef.current) { clearInterval(videoTimerRef.current); videoTimerRef.current = null; }
    const durationMs = Date.now() - videoStartedAtRef.current;
    const finalBlob: Blob = await new Promise((resolve) => {
      rec.onstop = () => {
        const t = rec.mimeType || "video/webm";
        resolve(new Blob(videoChunksRef.current, { type: t }));
      };
      try { rec.stop(); } catch { resolve(new Blob(videoChunksRef.current, { type: rec.mimeType || "video/webm" })); }
    });
    stream?.getTracks().forEach(t => t.stop());
    videoRecRef.current = null;
    videoStreamRef.current = null;
    if (videoPreviewRef.current) videoPreviewRef.current.srcObject = null;
    setVideoRecording(false);

    if (finalBlob.size === 0) {
      toast.error("Vidéo vide, non enregistrée");
      return;
    }
    try {
      const mimeType = finalBlob.type || "video/webm";
      const id = await saveVideo(finalBlob, mimeType, durationMs);
      setVideos(prev => [...prev, { id, previewUrl: URL.createObjectURL(finalBlob), durationMs }]);
      toast.success("Vidéo ajoutée");
    } catch {
      toast.error("Impossible d'enregistrer la vidéo");
    }
  }

  function removeVideo(id: string) {
    setVideos(prev => {
      const found = prev.find(v => v.id === id);
      if (found) URL.revokeObjectURL(found.previewUrl);
      return prev.filter(v => v.id !== id);
    });
  }

  // ── Audio ────────────────────────────────────────────────────────────

  async function ensureMicAccess(): Promise<MediaStream | null> {
    if (!secureOk) { toast.error("HTTPS requis"); return null; }
    if (!navigator.mediaDevices?.getUserMedia) { toast.error("Micro indisponible."); return null; }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setPermission("granted");
      return stream;
    } catch (err: any) {
      const name = err?.name || "";
      if (name === "NotAllowedError" || name === "SecurityError") {
        setPermission("denied");
        toast.error("Accès micro refusé.");
      } else if (name === "NotFoundError" || name === "OverconstrainedError") {
        toast.error("Aucun micro détecté.");
      } else {
        toast.error("Micro indisponible : " + (err?.message || name));
      }
      return null;
    }
  }

  async function start() {
    if (!supported) return;
    if (parcelleSelectionUnavailable) {
      toast.error("Connecte-toi au moins une fois en ligne pour télécharger la liste de tes parcelles avant de saisir cette mission.");
      return;
    }
    const stream = await ensureMicAccess();
    if (!stream) return;
    const mime = pickMimeType();
    let rec: MediaRecorder;
    try {
      rec = mime ? new MediaRecorder(stream, { mimeType: mime }) : new MediaRecorder(stream);
    } catch (e: any) {
      stream.getTracks().forEach(t => t.stop());
      toast.error("Impossible de démarrer : " + e.message);
      return;
    }
    chunksRef.current = [];
    rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunksRef.current.push(e.data); };
    rec.onerror = (e: any) => { toast.error("Erreur : " + (e?.error?.message || "inconnue")); };
    rec.start(1000);
    recRef.current = rec;
    streamRef.current = stream;
    startedAtRef.current = Date.now();
    setElapsed(0);
    setRecording(true);
    timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
  }

  async function stopAndSave() {
    const rec = recRef.current;
    const stream = streamRef.current;
    if (!rec) return;
    setSaving(true);
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const finalBlob: Blob = await new Promise((resolve) => {
      rec.onstop = () => {
        const type = rec.mimeType || "audio/webm";
        resolve(new Blob(chunksRef.current, { type }));
      };
      try { rec.stop(); } catch { resolve(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" })); }
    });
    stream?.getTracks().forEach(t => t.stop());
    recRef.current = null;
    streamRef.current = null;
    setRecording(false);

    try {
      const durationMs = Date.now() - startedAtRef.current;
      const mimeType = finalBlob.type || "audio/webm";
      if (finalBlob.size === 0) throw new Error("Enregistrement vide");
      const audioId = await saveAudio(finalBlob, mimeType, durationMs);
      await enqueue({
        type: docType, audioId,
        photoIds: photos.map(p => p.id),
        videoIds: videos.map(v => v.id),
        meta: buildMeta(),
      });
      toast.success(online ? "Enregistré — synchronisation en cours" : "Enregistré localement — sync à la reconnexion");
      // Attendu (pas fire-and-forget) : le prochain montage de cet écran
      // (nouvelle saisie) lit le brouillon dès son premier effet — sans
      // attendre ici, une nouvelle saisie démarrée assez vite pourrait
      // relire l'ancien brouillon (gps compris) avant que sa suppression ne
      // soit effective.
      await clearRecordDraft();
      navigate({ to: "/" });
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur sauvegarde locale");
      setSaving(false);
    }
  }

  async function submitManual() {
    const tx = manualText.trim();
    if (!tx) { toast.error("Texte vide."); return; }
    if (parcelleSelectionUnavailable) {
      toast.error("Connecte-toi au moins une fois en ligne pour télécharger la liste de tes parcelles avant de saisir cette mission.");
      return;
    }
    setSaving(true);
    try {
      await enqueue({
        type: docType, transcript: tx,
        photoIds: photos.map(p => p.id),
        videoIds: videos.map(v => v.id),
        meta: buildMeta(),
      });
      toast.success(online ? "Ajouté — synchronisation en cours" : "Ajouté à la file — sync à la reconnexion");
      await clearRecordDraft();
      navigate({ to: "/" });
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
      setSaving(false);
    }
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");
  const vmm = String(Math.floor(videoElapsed / 60)).padStart(2, "0");
  const vss = String(videoElapsed % 60).padStart(2, "0");

  return (
    <div className="px-5 pt-8 pb-32">
      {/* Le nettoyage du brouillon en cas d'abandon (sans enregistrer) se
          fait au démontage du composant (voir l'effet de nettoyage plus
          haut) — pas ici sur ce clic précis, pour couvrir aussi le bouton/
          geste de retour matériel du téléphone, qui ne déclenche pas ce
          onClick. */}
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </Link>
      <header className="mt-6">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          {t("record.step")}
        </p>
        <h1 className="mt-2 font-display text-3xl">{t("record.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {manual ? t("record.sub_manual") : t("record.sub_audio")}
        </p>
      </header>

      {!online && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium text-amber-300">{t("home.offline_title")}</p>
            <p className="mt-1 text-muted-foreground">{t("home.offline_sub")}</p>
          </div>
        </div>
      )}

      {/* Mission active (générée dynamiquement, jamais codée en dur) — un menu
          déroulant n'apparaît que si le module a réellement plusieurs
          missions ; sinon l'unique mission disponible est sélectionnée
          automatiquement et affichée en lecture seule. */}
      {missionFormsOfflineNoCache ? (
        <section className="mt-6 flex items-start gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-4">
          <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <p className="text-sm text-amber-300">
            Connecte-toi au moins une fois en ligne pour télécharger les formulaires de mission.
          </p>
        </section>
      ) : missionForms.length > 1 ? (
        <section className="mt-6 glass-card rounded-2xl p-4">
          <h2 className="mb-3 text-xs uppercase tracking-widest text-gold-soft">Type de mission</h2>
          <select
            value={missionKey}
            onChange={e => { setMissionKey(e.target.value); setFieldValues({}); }}
            className="w-full rounded-lg border border-border bg-input/50 px-3 py-2.5 text-sm outline-none focus:border-gold"
          >
            {missionForms.map(m => (
              <option key={m.mission_key} value={m.mission_key}>{m.mission_label}</option>
            ))}
          </select>
        </section>
      ) : missionForms.length === 1 ? (
        <section className="mt-6 glass-card rounded-2xl p-4">
          <h2 className="mb-1 text-xs uppercase tracking-widest text-gold-soft">Mission</h2>
          <p className="font-display text-lg">{missionForms[0].mission_label}</p>
        </section>
      ) : null}

      {/* Metadata */}
      <section className="mt-6 glass-card rounded-2xl p-4">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-gold-soft">{t("record.context_meta")}</h2>
        <div className="grid grid-cols-2 gap-3">
          <label className="col-span-2 block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">{t("record.meta_agent")}</span>
            <input value={agentName} onChange={e => setAgentName(e.target.value)} placeholder={t("record.meta_agent_ph")}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>
          <label className="col-span-2 block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">{t("record.meta_location")}</span>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder={t("record.meta_location_ph")}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>
          <div className="col-span-2">
            <button
              type="button"
              onClick={handleCaptureGps}
              disabled={gpsLoading}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
            >
              {gpsLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4 text-gold" />}
              {gpsLoading
                ? "Recherche du signal GPS… (jusqu'à 20s)"
                : gps
                  ? `GPS capturé : ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}${gps.accuracy != null ? ` (précision ±${Math.round(gps.accuracy)}m)` : ""}`
                  : "Capturer ma position GPS"}
            </button>
            {gps && gps.accuracy != null && gpsAccuracyWarning(gps.accuracy) && (
              <p className="mt-1.5 flex items-center gap-1.5 text-[11px] text-amber-400">
                <AlertTriangle className="h-3 w-3 shrink-0" />
                {gpsAccuracyWarning(gps.accuracy)}
              </p>
            )}
          </div>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">{t("record.meta_date")}</span>
            <input type="date" value={docDate} onChange={e => setDocDate(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">{t("record.meta_time")}</span>
            <input type="time" value={docTime} onChange={e => setDocTime(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
          </label>
        </div>
      </section>

      {/* AGRO — liaison à une parcelle (avant la saisie audio/texte) — comportement
          fixe et exclusif selon la mission, aucune bascule manuelle */}
      {isParcelleMission && (
        <section className="mt-4 glass-card rounded-2xl p-4">
          <h2 className="mb-3 flex items-center gap-2 text-xs uppercase tracking-widest text-gold-soft">
            <Sprout className="h-3.5 w-3.5" /> Parcelle{isParcelleSelectionMission ? " *" : ""}
          </h2>

          {parcelleSelectionUnavailable ? (
            <div className="flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
              <CloudOff className="mt-0.5 h-4 w-4 shrink-0 text-amber-400" />
              <p className="text-sm text-amber-300">
                Connecte-toi au moins une fois en ligne pour télécharger la liste de tes parcelles. La saisie pour cette mission est bloquée tant qu'aucune parcelle n'est disponible.
              </p>
            </div>
          ) : (
            <>
              {parcelleMode === "existing" ? (
                parcellesLoading ? (
                  <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-gold" /></div>
                ) : selectableParcelles.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    {isParcelleSelectionMission
                      ? "Aucune parcelle enregistrée pour l'instant — utilisez d'abord la mission « Recensement des plantations » pour en créer une."
                      : "Aucune parcelle enregistrée pour l'instant."}
                  </p>
                ) : (
                  <>
                    <select
                      value={selectedParcelleId}
                      onChange={e => setSelectedParcelleId(e.target.value)}
                      className="w-full rounded-lg border border-border bg-input/50 px-3 py-2.5 text-sm outline-none focus:border-gold"
                    >
                      <option value="">— Choisir une parcelle —</option>
                      {selectableParcelles.map(p => (
                        <option key={p.id} value={p.id}>
                          {p.culture}
                          {p.surfaceHa ? ` · ${p.surfaceHa} ha` : ""}
                          {p.cooperativeName ? ` · ${p.cooperativeName}` : ""}
                          {p.pending ? " · ⏳ en attente de sync" : ""}
                        </option>
                      ))}
                    </select>
                    {selectedParcelleId && isLocalParcelleId(selectedParcelleId) && (
                      <p className="mt-2 flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 text-xs text-amber-400">
                        <CloudOff className="h-3.5 w-3.5 shrink-0" />
                        Cette parcelle a été recensée hors-ligne et n'est pas encore synchronisée — cette saisie sera
                        liée automatiquement dès que la parcelle sera créée côté serveur.
                      </p>
                    )}
                  </>
                )
              ) : createdParcelleId ? (
                isLocalParcelleId(createdParcelleId) ? (
                  <p className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2.5 text-sm text-amber-400">
                    <CloudOff className="h-4 w-4 shrink-0" /> Parcelle enregistrée hors-ligne — en attente de synchronisation. Elle sera liée à cette saisie dès le retour du réseau.
                  </p>
                ) : (
                  <p className="flex items-center gap-2 rounded-lg bg-emerald-500/10 px-3 py-2.5 text-sm text-emerald-400">
                    <CheckCircle2 className="h-4 w-4 shrink-0" /> Parcelle créée — elle sera liée à cette saisie.
                  </p>
                )
              ) : (
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-3">
                    <label className="block">
                      <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Culture *</span>
                      <input value={newCulture} onChange={e => setNewCulture(e.target.value)} placeholder="ex : cacao"
                        className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Surface (ha)</span>
                      <input type="number" inputMode="decimal" min="0" step="0.01" value={newSurface} onChange={e => setNewSurface(e.target.value)}
                        className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
                      {newSurface.trim() && Number.isFinite(Number(newSurface)) && (
                        <span className="mt-1 block text-[11px] text-muted-foreground">
                          ≈ {Math.round(Number(newSurface) * 10000)} m²
                        </span>
                      )}
                    </label>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Coopérative</span>
                    <input list="agro-coop-list" value={newCoop} onChange={e => setNewCoop(e.target.value)} placeholder="ex : COOP-CA Mbam"
                      className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
                    <datalist id="agro-coop-list">
                      {coopNames.map(n => <option key={n} value={n} />)}
                    </datalist>
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">Producteur</span>
                    <input list="agro-producer-list" value={newProducer} onChange={e => setNewProducer(e.target.value)} placeholder="ex : Jean Mballa"
                      className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
                    <datalist id="agro-producer-list">
                      {producerNames.map(n => <option key={n} value={n} />)}
                    </datalist>
                  </label>

                  <div className="rounded-xl border border-border bg-card/30 p-3">
                    <span className="mb-2 block text-[10px] uppercase tracking-widest text-muted-foreground">
                      Périmètre (optionnel) — complète ou remplace le point GPS unique
                    </span>
                    <BoundaryRenderErrorBoundary>
                    {boundaryClosed ? (
                      <div className="space-y-2">
                        <p className="flex items-center gap-2 text-sm text-emerald-400">
                          <CheckCircle2 className="h-4 w-4 shrink-0" />
                          Périmètre fermé — {boundaryPoints.length} points, surface estimée :{" "}
                          {formatSurfaceHa(computePolygonAreaHectares(boundaryPoints))} ha
                          {" "}(≈ {Math.round(computePolygonAreaHectares(boundaryPoints) * 10000)} m²)
                        </p>
                        <PerimeterMapPreview points={boundaryPoints} />
                        <button type="button" onClick={handleResetBoundary}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
                          Reprendre le périmètre
                        </button>
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <button
                            type="button"
                            onClick={() => void handleAddBoundaryPoint()}
                            disabled={capturingBoundaryPoint}
                            className="flex items-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                          >
                            {capturingBoundaryPoint ? <Loader2 className="h-4 w-4 animate-spin" /> : <MapPin className="h-4 w-4 text-gold" />}
                            {capturingBoundaryPoint ? "Recherche du signal… (jusqu'à 20s)" : "Ajouter un point"}
                          </button>
                          <button
                            type="button"
                            onClick={handleFinishBoundary}
                            disabled={boundaryPoints.length < 3}
                            className="rounded-lg btn-gold px-3 py-2 text-sm disabled:opacity-40"
                          >
                            Terminer le périmètre
                          </button>
                          <span className="text-xs text-muted-foreground">
                            {boundaryPoints.length} point{boundaryPoints.length !== 1 ? "s" : ""} capturé{boundaryPoints.length !== 1 ? "s" : ""}
                            {(() => {
                              const last = boundaryPoints[boundaryPoints.length - 1];
                              return last?.accuracy != null ? ` (précision ±${Math.round(last.accuracy)}m)` : "";
                            })()}
                          </span>
                        </div>
                        {(() => {
                          const last = boundaryPoints[boundaryPoints.length - 1];
                          return last?.accuracy != null && last.accuracy > 20 ? (
                            <p className="flex items-center gap-1.5 text-[11px] text-amber-400">
                              <AlertTriangle className="h-3 w-3 shrink-0" />
                              Précision faible — essayez un endroit plus dégagé, loin des bâtiments et arbres.
                            </p>
                          ) : null;
                        })()}
                        <PerimeterMapPreview points={boundaryPoints} />
                      </div>
                    )}
                    </BoundaryRenderErrorBoundary>
                  </div>

                  {!gps && (
                    <p className="text-xs text-muted-foreground">
                      Capturez la position GPS (section « métadonnées » ci-dessus) pour pouvoir enregistrer la parcelle.
                    </p>
                  )}

                  {dupParcelle && (
                    <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
                      <p className="flex items-start gap-2 text-sm text-amber-300">
                        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
                        Une parcelle avec {dupParcelle.culture} existe déjà à {dupParcelle.distanceMeters} m de cette
                        position — l'utiliser à la place, ou continuer quand même ?
                      </p>

                      <label className="mt-2 block">
                        <span className="mb-1 block text-[10px] uppercase tracking-widest text-amber-300/80">
                          Justification (obligatoire pour créer quand même) *
                        </span>
                        <textarea
                          value={forceReason}
                          onChange={e => setForceReason(e.target.value)}
                          placeholder="Pourquoi cette parcelle est-elle distincte malgré la proximité GPS ?"
                          rows={2}
                          className="w-full rounded-lg border border-amber-500/30 bg-input/50 px-3 py-2 text-sm outline-none focus:border-amber-400"
                        />
                        {forceReason.trim().length > 0 && forceReason.trim().length < 10 && (
                          <p className="mt-1 text-[10px] text-amber-300/80">
                            Encore {10 - forceReason.trim().length} caractère(s) minimum.
                          </p>
                        )}
                      </label>

                      <div className="mt-2 flex flex-wrap gap-2">
                        <button type="button" onClick={useExistingDuplicate}
                          className="rounded-lg btn-gold px-3 py-1.5 text-xs">
                          Utiliser la parcelle existante
                        </button>
                        <button type="button" disabled={creatingParcelle || forceReason.trim().length < 10}
                          onClick={() => void handleCreateParcelle(true)}
                          className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground disabled:opacity-40">
                          {creatingParcelle ? "Création…" : "Créer quand même"}
                        </button>
                      </div>
                    </div>
                  )}

                  {!dupParcelle && (
                    <button
                      type="button"
                      disabled={creatingParcelle || !gps || !newCulture.trim()}
                      onClick={() => void handleCreateParcelle(false)}
                      className="flex w-full items-center justify-center gap-2 rounded-lg btn-gold px-4 py-2.5 text-sm disabled:opacity-40"
                    >
                      {creatingParcelle ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sprout className="h-4 w-4" />}
                      Enregistrer la parcelle
                    </button>
                  )}
                </div>
              )}
            </>
          )}
        </section>
      )}

      {/* Champs de la mission active — générés dynamiquement depuis `mission_forms` */}
      {!missionFormsLoading && missionFields.length > 0 && (
        <section className="mt-4 glass-card rounded-2xl p-4">
          <h2 className="mb-3 text-xs uppercase tracking-widest text-gold-soft">
            Informations spécifiques
          </h2>
          <div className="grid grid-cols-2 gap-3">
            {missionFields.map(f => (
              <label key={f.key} className={f.type === "text" && f.key.length > 12 ? "col-span-2 block" : "block"}>
                <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">
                  {f.label}{f.unit ? ` (${f.unit})` : ""}{f.required ? " *" : ""}
                </span>
                {f.type === "select" ? (
                  <select
                    value={fieldValues[f.key] ?? ""}
                    onChange={e => setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold"
                  >
                    <option value="">— Choisir —</option>
                    {(f.options ?? []).map(opt => (
                      <option key={opt} value={opt}>{opt}</option>
                    ))}
                  </select>
                ) : (
                  <input
                    type={f.type === "number" ? "number" : "text"}
                    inputMode={f.type === "number" ? "decimal" : undefined}
                    value={fieldValues[f.key] ?? ""}
                    onChange={e => setFieldValues(prev => ({ ...prev, [f.key]: e.target.value }))}
                    className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold"
                  />
                )}
              </label>
            ))}
          </div>
        </section>
      )}

      {/* Photos & vidéos */}
      <section className="mt-4 glass-card rounded-2xl p-4">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-gold-soft">Photos & vidéo</h2>

        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => photoInputRef.current?.click()}
            className="flex flex-1 items-center justify-center gap-2 rounded-lg border border-border bg-card/50 px-3 py-2.5 text-sm text-muted-foreground hover:text-foreground"
          >
            <Camera className="h-4 w-4 text-gold" /> Ajouter une photo
          </button>
          <button
            type="button"
            onClick={videoRecording ? stopVideo : startVideo}
            disabled={videos.length > 0 && !videoRecording}
            className={`flex flex-1 items-center justify-center gap-2 rounded-lg border px-3 py-2.5 text-sm disabled:opacity-40 ${
              videoRecording
                ? "border-destructive/50 bg-destructive/10 text-destructive"
                : "border-border bg-card/50 text-muted-foreground hover:text-foreground"
            }`}
          >
            {videoRecording ? <VideoOff className="h-4 w-4" /> : <Video className="h-4 w-4 text-gold" />}
            {videoRecording ? `Arrêter (${vmm}:${vss})` : "Vidéo courte (≤60s)"}
          </button>
        </div>
        <input
          ref={photoInputRef}
          type="file"
          accept="image/*"
          capture="environment"
          multiple
          className="hidden"
          onChange={handlePhotoSelected}
        />

        {videoRecording && (
          <video ref={videoPreviewRef} muted playsInline className="mt-3 w-full rounded-lg border border-destructive/40" />
        )}

        {photos.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {photos.map(p => (
              <div key={p.id} className="relative h-16 w-16 overflow-hidden rounded-lg border border-border">
                <img src={p.previewUrl} alt="" className="h-full w-full object-cover" />
                <button
                  type="button"
                  onClick={() => removePhoto(p.id)}
                  className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {videos.length > 0 && !videoRecording && (
          <div className="mt-3 flex flex-wrap gap-2">
            {videos.map(v => (
              <div key={v.id} className="relative overflow-hidden rounded-lg border border-border">
                <video src={v.previewUrl} muted className="h-16 w-24 object-cover" />
                <button
                  type="button"
                  onClick={() => removeVideo(v.id)}
                  className="absolute right-0.5 top-0.5 rounded-full bg-background/80 p-0.5"
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            ))}
          </div>
        )}

        {photos.length === 0 && videos.length === 0 && !videoRecording && (
          <p className="mt-2 text-xs text-muted-foreground">Optionnel — utile comme preuve terrain.</p>
        )}
      </section>


      {!supported && !manual && (
        <div className="mt-6 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          Votre navigateur ne supporte pas l'enregistrement audio. Utilisez la saisie manuelle.
        </div>
      )}

      {!secureOk && !manual && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-sm">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-destructive" />
          <div>
            <p className="font-medium">HTTPS requis</p>
          </div>
        </div>
      )}

      {permission === "denied" && !manual && (
        <PermissionDeniedBanner onRetry={() => { setPermission("unknown"); void start(); }} />
      )}

      {!manual ? (
        <>
          <div className="mt-8 flex flex-col items-center">
            <button
              onClick={recording ? stopAndSave : start}
              disabled={!supported || saving || (!recording && parcelleSelectionUnavailable)}
              className={`flex h-32 w-32 items-center justify-center rounded-full transition ${
                recording ? "bg-destructive pulse-rec" : "btn-gold"
              } disabled:opacity-40`}
            >
              {recording ? <Square className="h-12 w-12 fill-current" /> : <Mic className="h-14 w-14" />}
            </button>
            <div className="mt-6 font-display text-4xl tabular-nums">{mm}:{ss}</div>
            <p className="mt-1 text-xs uppercase tracking-widest text-muted-foreground">
              {recording ? t("record.recording") : saving ? t("record.saving") : elapsed > 0 ? t("record.done") : t("record.start")}
            </p>
          </div>
        </>
      ) : (
        <>
          <textarea
            value={manualText}
            onChange={e => setManualText(e.target.value)}
            placeholder={t("record.manual_placeholder")}
            className="mt-8 min-h-64 w-full rounded-xl border border-border bg-input/50 p-4 text-sm leading-relaxed outline-none focus:border-gold"
          />
          <button
            onClick={submitManual}
            disabled={saving || !manualText.trim() || parcelleSelectionUnavailable}
            className="mt-4 w-full rounded-xl btn-gold px-6 py-4 text-base disabled:opacity-40"
          >
            {t("record.manual_submit")}
          </button>
        </>
      )}

      <div className="mt-6">
        <button
          onClick={() => { setManual(m => !m); if (recording) void stopAndSave(); }}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card/50 px-6 py-3 text-sm text-muted-foreground hover:text-foreground"
        >
          <Type className="h-4 w-4" /> {manual ? t("record.audio_toggle") : t("record.manual_toggle")}
        </button>
      </div>
    </div>
  );
}