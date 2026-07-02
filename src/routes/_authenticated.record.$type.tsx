import { createFileRoute, Link, useNavigate, useParams, useSearch } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { ArrowLeft, Mic, Square, Type, MicOff, ShieldAlert, ExternalLink, CloudOff, MapPin, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { saveAudio, enqueue, type QueueMeta, type DocType, type GpsLocation, type ModuleType } from "@/lib/offline-store";
import { useOnline } from "@/hooks/use-online";
import { getProfile, generateReference } from "@/lib/profile-store";
import { useI18n } from "@/i18n";
import { captureGps } from "@/lib/geo";
import { z } from "zod";


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

const recordSearchSchema = z.object({
  module: z.enum(["agro", "health", "ngo", "generic"]).optional(),
});

export const Route = createFileRoute("/_authenticated/record/$type")({
  component: RecordPage,
  head: () => ({ meta: [{ title: "Enregistrement — AURUM" }] }),
  validateSearch: recordSearchSchema,
});



const VALID_TYPES = new Set<DocType>(["rapport", "pv", "mission_terrain", "enquete", "auto", "field_entry"]);
const TYPE_LABELS: Record<string, string> = {
  auto: "Détection automatique",
  field_entry: "Saisie terrain",
  mission_terrain: "Mission terrain",
  rapport: "Mission terrain",
  pv: "Procès-verbal",
  enquete: "Enquête",
};

function RecordPage() {
  const { type } = useParams({ from: "/_authenticated/record/$type" });
  const { module: moduleFromSearch } = useSearch({ from: "/_authenticated/record/$type" });
  const docType: DocType = (VALID_TYPES.has(type as DocType) ? (type as DocType) : "field_entry");
  const navigate = useNavigate();
  const online = useOnline();
  const { t, lang } = useI18n();


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

  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

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
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function buildMeta(): QueueMeta {
    const p = getProfile();
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
      moduleType: (moduleFromSearch as ModuleType | undefined) ?? undefined,
    };
  }


  async function handleCaptureGps() {
    setGpsLoading(true);
    try {
      const g = await captureGps();
      if (!g) toast.error("Position GPS indisponible");
      else { setGps(g); toast.success("Position GPS capturée"); }
    } finally { setGpsLoading(false); }
  }


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
      await enqueue({ type: docType, audioId, meta: buildMeta() });
      toast.success(online ? "Enregistré — synchronisation en cours" : "Enregistré localement — sync à la reconnexion");
      navigate({ to: "/" });
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur sauvegarde locale");
      setSaving(false);
    }
  }

  async function submitManual() {
    const tx = manualText.trim();
    if (!tx) { toast.error("Texte vide."); return; }
    setSaving(true);
    try {
      await enqueue({ type: docType, transcript: tx, meta: buildMeta() });
      toast.success(online ? "Ajouté — synchronisation en cours" : "Ajouté à la file — sync à la reconnexion");
      navigate({ to: "/" });
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur");
      setSaving(false);
    }
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="px-5 pt-8 pb-32">
      <Link to="/new" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </Link>
      <header className="mt-6">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          {t("record.step")} — {TYPE_LABELS[docType] ?? "Document"}
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
              {gps
                ? `GPS capturé : ${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)}`
                : "Capturer ma position GPS"}
            </button>
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
              disabled={!supported || saving}
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
            disabled={saving || !manualText.trim()}
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
