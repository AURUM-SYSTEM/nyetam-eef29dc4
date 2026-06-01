import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Mic,
  Square,
  Camera,
  ImagePlus,
  X,
  CloudOff,
  Loader2,
  Users,
  RotateCcw,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";
import {
  saveAudio,
  savePhoto,
  enqueue,
  blobToBase64,
  type QueueMeta,
} from "@/lib/offline-store";
import { useOnline } from "@/hooks/use-online";
import { getProfile, generateReference } from "@/lib/profile-store";
import { useI18n } from "@/i18n";
import { useServerFn } from "@tanstack/react-start";
import { transcribeAudio } from "@/lib/aurum.functions";

export const Route = createFileRoute("/_authenticated/recensement")({
  component: RecensementPage,
  head: () => ({ meta: [{ title: "Recensement ONG — AURUM" }] }),
});

type LocalPhoto = { id: string; url: string; file: File };

const STATUSES = [
  "Bénéficiaire",
  "Vulnérable",
  "Urgence",
  "Suivi régulier",
  "Nouveau cas",
  "Clos",
];

function RecensementPage() {
  const navigate = useNavigate();
  const online = useOnline();
  const { lang } = useI18n();
  const transcribe = useServerFn(transcribeAudio);

  // Form fields
  const now = new Date();
  const [subject, setSubject] = useState("");
  const [location, setLocation] = useState("");
  const [observation, setObservation] = useState("");
  const [status, setStatus] = useState(STATUSES[0]);
  const [agentName, setAgentName] = useState("");
  const [docDate, setDocDate] = useState(now.toISOString().slice(0, 10));
  const [docTime, setDocTime] = useState(now.toTimeString().slice(0, 5));

  // Photos
  const [photos, setPhotos] = useState<LocalPhoto[]>([]);
  const cameraInputRef = useRef<HTMLInputElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);

  // Audio
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [audioBlob, setAudioBlob] = useState<Blob | null>(null);
  const [transcribing, setTranscribing] = useState(false);
  const recRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startedAtRef = useRef<number>(0);

  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const p = getProfile();
    if (p.name) setAgentName(p.name);
    if (p.defaultLocation) setLocation(p.defaultLocation);
    return () => {
      try { recRef.current?.stop(); } catch {}
      streamRef.current?.getTracks().forEach(t => t.stop());
      if (timerRef.current) clearInterval(timerRef.current);
      photos.forEach(p => URL.revokeObjectURL(p.url));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function addPhotos(files: FileList | null) {
    if (!files || files.length === 0) return;
    const next: LocalPhoto[] = [];
    for (const f of Array.from(files).slice(0, 10)) {
      if (!f.type.startsWith("image/")) continue;
      if (f.size > 8 * 1024 * 1024) {
        toast.error(`Photo trop volumineuse : ${f.name} (>8 Mo)`);
        continue;
      }
      next.push({
        id: Math.random().toString(36).slice(2),
        url: URL.createObjectURL(f),
        file: f,
      });
    }
    setPhotos(prev => [...prev, ...next].slice(0, 10));
  }

  function removePhoto(id: string) {
    setPhotos(prev => {
      const p = prev.find(x => x.id === id);
      if (p) URL.revokeObjectURL(p.url);
      return prev.filter(x => x.id !== id);
    });
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const rec = new MediaRecorder(stream);
      chunksRef.current = [];
      rec.ondataavailable = e => { if (e.data?.size) chunksRef.current.push(e.data); };
      rec.start(1000);
      recRef.current = rec;
      streamRef.current = stream;
      startedAtRef.current = Date.now();
      setElapsed(0);
      setRecording(true);
      timerRef.current = setInterval(() => setElapsed(s => s + 1), 1000);
    } catch (e: any) {
      toast.error("Micro indisponible : " + (e?.message ?? ""));
    }
  }

  async function stopRecording() {
    const rec = recRef.current;
    if (!rec) return;
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    const blob: Blob = await new Promise(resolve => {
      rec.onstop = () => resolve(new Blob(chunksRef.current, { type: rec.mimeType || "audio/webm" }));
      try { rec.stop(); } catch { resolve(new Blob(chunksRef.current, { type: "audio/webm" })); }
    });
    streamRef.current?.getTracks().forEach(t => t.stop());
    recRef.current = null;
    streamRef.current = null;
    setRecording(false);
    setAudioBlob(blob);

    // Voice-first: auto-transcrire & injecter dans Observation
    if (!blob || blob.size === 0) return;
    if (!online) {
      toast.info("Hors ligne — l'audio sera transcrit à la reconnexion");
      return;
    }
    setTranscribing(true);
    const toastId = `tx-${Date.now()}`;
    toast.loading("📝 Transcription en cours…", { id: toastId });
    try {
      const audioBase64 = await blobToBase64(blob);
      const t = await transcribe({
        data: { audioBase64, mimeType: blob.type || "audio/webm", lang },
      });
      const text = (t?.text ?? "").trim();
      if (!text) {
        toast.error("Audio inaudible ou vide", { id: toastId });
        return;
      }
      setObservation(prev => (prev.trim() ? `${prev.trim()}\n\n${text}` : text));
      // Audio injecté dans observation → on n'a plus besoin de le renvoyer
      setAudioBlob(null);
      toast.success("✅ Texte transcrit ajouté à l'observation", { id: toastId });
    } catch (e: any) {
      toast.error(`Échec transcription : ${e?.message ?? "erreur"}`, { id: toastId });
    } finally {
      setTranscribing(false);
    }
  }

  async function reRecord() {
    setAudioBlob(null);
    setElapsed(0);
    await startRecording();
  }

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
      subjectName: subject.trim(),
      subjectStatus: status,
      observation: observation.trim(),
    };
  }

  function buildStructuredTranscript(): string {
    const lines: string[] = [];
    lines.push(`FICHE DE RECENSEMENT — ${subject.trim() || "Sujet non identifié"}`);
    lines.push("");
    lines.push(`Agent : ${agentName.trim() || "n/c"}`);
    lines.push(`Date : ${docDate} ${docTime}`);
    lines.push(`Localisation : ${location.trim() || "n/c"}`);
    lines.push(`Statut : ${status}`);
    lines.push(`Nom / Identifiant du sujet : ${subject.trim() || "n/c"}`);
    lines.push("");
    lines.push("Observation terrain :");
    lines.push(observation.trim() || "(non renseignée)");
    return lines.join("\n");
  }

  async function submit() {
    if (!subject.trim()) { toast.error("Nom / Identifiant requis"); return; }
    if (!observation.trim() && !audioBlob && photos.length === 0) {
      toast.error("Ajoutez au moins une observation, un audio ou une photo");
      return;
    }
    setSaving(true);
    try {
      // Persist audio locally
      let audioId: string | undefined;
      if (audioBlob && audioBlob.size > 0) {
        audioId = await saveAudio(
          audioBlob,
          audioBlob.type || "audio/webm",
          Date.now() - startedAtRef.current,
        );
      }
      // Persist photos locally
      const photoIds: string[] = [];
      for (const p of photos) {
        const id = await savePhoto(p.file, p.file.type || "image/jpeg", p.file.name);
        photoIds.push(id);
      }
      await enqueue({
        type: "recensement",
        audioId,
        photoIds: photoIds.length ? photoIds : undefined,
        transcript: buildStructuredTranscript(),
        meta: buildMeta(),
      });
      toast.success(
        online
          ? "Recensement enregistré — synchronisation en cours"
          : "Recensement enregistré localement — sync à la reconnexion",
      );
      navigate({ to: "/" });
    } catch (e: any) {
      toast.error(e?.message ?? "Erreur sauvegarde");
      setSaving(false);
    }
  }

  const mm = String(Math.floor(elapsed / 60)).padStart(2, "0");
  const ss = String(elapsed % 60).padStart(2, "0");

  return (
    <div className="px-5 pt-8 pb-32">
      <Link to="/new" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Retour
      </Link>

      <header className="mt-6">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Recensement terrain</p>
        <h1 className="mt-2 font-display text-3xl flex items-center gap-2">
          <Users className="h-7 w-7 text-gold" /> Nouvelle fiche
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Saisissez les informations du bénéficiaire. Photos et audio sont optionnels.
        </p>
      </header>

      {!online && (
        <div className="mt-6 flex items-start gap-3 rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm">
          <CloudOff className="mt-0.5 h-5 w-5 shrink-0 text-amber-400" />
          <div>
            <p className="font-medium text-amber-300">Mode hors ligne</p>
            <p className="mt-1 text-muted-foreground">La fiche sera synchronisée dès le retour du réseau.</p>
          </div>
        </div>
      )}

      {/* Identification */}
      <section className="mt-6 glass-card rounded-2xl p-4">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-gold-soft">Identification</h2>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Nom / Identifiant *" full>
            <input value={subject} onChange={e => setSubject(e.target.value)} placeholder="Ex : Famille Mballa / B-0023"
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
          </Field>
          <Field label="Localisation" full>
            <input value={location} onChange={e => setLocation(e.target.value)} placeholder="Village, quartier, GPS…"
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
          </Field>
          <Field label="Statut" full>
            <select value={status} onChange={e => setStatus(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold">
              {STATUSES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </Field>
          <Field label="Agent">
            <input value={agentName} onChange={e => setAgentName(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
          </Field>
          <Field label="Date">
            <input type="date" value={docDate} onChange={e => setDocDate(e.target.value)}
              className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold" />
          </Field>
        </div>
      </section>

      {/* Observation */}
      <section className="mt-4 glass-card rounded-2xl p-4">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-gold-soft">Observation terrain</h2>
        <textarea
          value={observation}
          onChange={e => setObservation(e.target.value)}
          placeholder="Conditions de vie, composition du foyer, besoins observés, vulnérabilités…"
          className="min-h-40 w-full rounded-lg border border-border bg-input/50 p-3 text-sm leading-relaxed outline-none focus:border-gold"
        />
      </section>

      {/* Photos */}
      <section className="mt-4 glass-card rounded-2xl p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs uppercase tracking-widest text-gold-soft">Photos ({photos.length}/10)</h2>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-card px-3 py-1.5 text-xs hover:border-gold/40"
          >
            <Camera className="h-3.5 w-3.5" /> Ajouter
          </button>
          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            capture="environment"
            onChange={e => { addPhotos(e.target.files); e.target.value = ""; }}
            className="hidden"
          />
        </div>
        {photos.length === 0 ? (
          <p className="text-xs text-muted-foreground">Aucune photo. Appuyez sur Ajouter pour utiliser l'appareil photo.</p>
        ) : (
          <div className="grid grid-cols-3 gap-2">
            {photos.map(p => (
              <div key={p.id} className="relative aspect-square overflow-hidden rounded-lg border border-border">
                <img src={p.url} alt="" className="h-full w-full object-cover" />
                <button
                  onClick={() => removePhoto(p.id)}
                  className="absolute top-1 right-1 rounded-full bg-background/80 p-1 text-destructive hover:bg-background"
                  aria-label="Retirer"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Audio */}
      <section className="mt-4 glass-card rounded-2xl p-4">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-gold-soft">Audio terrain (optionnel)</h2>
        <div className="flex items-center gap-4">
          <button
            onClick={recording ? stopRecording : startRecording}
            disabled={saving}
            className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition ${
              recording ? "bg-destructive pulse-rec" : "btn-gold"
            } disabled:opacity-40`}
          >
            {recording ? <Square className="h-5 w-5 fill-current" /> : <Mic className="h-6 w-6" />}
          </button>
          <div className="min-w-0 flex-1">
            <div className="font-display text-2xl tabular-nums">{mm}:{ss}</div>
            <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
              {recording ? "Enregistrement…" : audioBlob ? "Audio enregistré ✓" : "Appuyez pour enregistrer"}
            </div>
          </div>
          {audioBlob && !recording && (
            <button
              onClick={() => setAudioBlob(null)}
              className="rounded-lg border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-destructive"
            >
              Effacer
            </button>
          )}
        </div>
      </section>

      <button
        onClick={submit}
        disabled={saving}
        className="mt-6 flex w-full items-center justify-center gap-2 rounded-xl btn-gold px-6 py-4 text-base disabled:opacity-40"
      >
        {saving ? <Loader2 className="h-5 w-5 animate-spin" /> : <Users className="h-5 w-5" />}
        Générer la fiche de recensement
      </button>
    </div>
  );
}

function Field({ label, full = false, children }: { label: string; full?: boolean; children: React.ReactNode }) {
  return (
    <label className={`block ${full ? "col-span-2" : ""}`}>
      <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
