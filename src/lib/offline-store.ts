// ─────────────────────────────────────────────────────────────────────────────
// OFFLINE STORE — IndexedDB (queue, audio, photos, vidéos)
//
// Source de vérité côté client tant qu'une saisie n'est pas `synced`.
// Le sync engine (use-sync-engine.ts) draine cette file vers Supabase.
//
// Extension modules : ajouter un domaine métier = étendre `ModuleType`
// puis mettre à jour `src/lib/organization-context.ts` et
// `src/lib/module-fields.ts`. Aucun changement de schéma DB n'est requis
// (le champ `module_type` côté `documents` est un text libre, indexable,
// sans CHECK contraignant).
//
// Legacy : `DocType` conserve `rapport | pv | recensement | mission_terrain
// | enquete` pour lire les anciens enregistrements. Les nouvelles saisies
// utilisent `field_entry` (neutre, sans génération IA structurée).
//
// DB_VERSION 5 : ajout de l'object store `videos` (courtes preuves vidéo
// terrain, ≤ 60s) — additif, ne modifie aucun store existant.
// DB_VERSION 6 : ajout de l'object store `missionFormsCache` — dernière
// copie connue de `mission_forms` par module, pour que l'écran de saisie
// reste utilisable hors-ligne (voir useMissionForms).
// DB_VERSION 7 : ajout de l'object store `parcellesCache` — dernière copie
// connue de listParcelles par agent, pour que la sélection obligatoire de
// parcelle (missions visite_parcelle / suivi_parcelle) reste possible
// hors-ligne (voir useParcellesCache dans _authenticated.record.$type.tsx).
// DB_VERSION 8 : ajout de l'object store `recordDraft` — persiste la
// mission active, les champs saisis et les métadonnées de l'écran de
// saisie en cours, restaurés au chargement. Corrige un bug où un simple
// rechargement de page réinitialisait systématiquement la mission vers la
// première par défaut (ex. "Recensement des plantations"), empêchant de
// facto toute saisie sur "Visite de parcelle"/"Suivi de parcelle" après un
// rechargement — la sélection ne survivait jamais assez longtemps pour
// que la logique de liaison parcelle (et son cache hors-ligne) s'applique.
// ─────────────────────────────────────────────────────────────────────────────
import { openDB, type IDBPDatabase } from "idb";

const DB_NAME = "aurum-offline";
const DB_VERSION = 8;

export type DocType =
  | "rapport"
  | "pv"
  | "recensement"
  | "mission_terrain"
  | "enquete"
  | "field_entry"
  | "auto";

export type ModuleType = "agro" | "health" | "ngo" | "generic";


export type QueueStatus =
  | "pending"
  | "uploading"
  | "transcribing"
  | "generating"
  | "synced"
  | "error";

export type AudioRecord = {
  id: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  createdAt: number;
};

export type PhotoRecord = {
  id: string;
  blob: Blob;
  mimeType: string;
  name: string;
  createdAt: number;
};

export type VideoRecord = {
  id: string;
  blob: Blob;
  mimeType: string;
  durationMs: number;
  createdAt: number;
};

export type GpsLocation = {
  lat: number;
  lng: number;
  accuracy?: number;
  capturedAt?: number;
};

// ── Formulaires de mission (mission_forms) — configurés en base, jamais
// codés en dur. Un module peut avoir plusieurs missions ; chaque mission
// définit ses propres champs (voir _authenticated.record.$type.tsx).
export type MissionFieldDef = {
  key: string;
  label: string;
  type: "text" | "number" | "select";
  unit?: string;
  required?: boolean;
  options?: string[];
};
export type MissionForm = {
  mission_key: string;
  mission_label: string;
  fields: MissionFieldDef[];
};
type MissionFormsCacheRecord = {
  moduleType: string;
  forms: MissionForm[];
  cachedAt: number;
};

// ── Parcelles (AGRO) — liste de l'organisation retournée par listParcelles,
// nécessaire à la sélection obligatoire des missions visite_parcelle /
// suivi_parcelle.
export type CachedParcelle = {
  id: string;
  culture: string;
  surfaceHa: number | null;
  cooperativeName: string | null;
};
type ParcellesCacheRecord = {
  userId: string;
  parcelles: CachedParcelle[];
  cachedAt: number;
};

// ── Brouillon de l'écran de saisie (_authenticated.record.$type.tsx) —
// mission active, champs saisis et métadonnées, persistés en continu et
// restaurés au chargement afin qu'un rechargement de page (accidentel ou
// après une coupure réseau) ne réinitialise plus la mission choisie.
export type RecordDraft = {
  missionKey: string;
  fieldValues: Record<string, string>;
  agentName: string;
  location: string;
  docDate: string;
  docTime: string;
  gps?: GpsLocation;
  updatedAt: number;
};
type RecordDraftRecord = RecordDraft & { id: "current" };

export type QueueMeta = {
  agentName?: string;
  location?: string;
  reference?: string;
  docDate?: string;
  docTime?: string;
  signatureName?: string;
  lang?: "fr" | "en";
  country?: string;
  profession?: string;
  gps?: GpsLocation;
  autoDetect?: boolean;
  moduleType?: ModuleType;
  // Champs structurés spécifiques au module métier (voir module-fields.ts),
  // saisis directement par l'agent — ex: { surface_ha: "2.5", culture: "maïs" }
  fieldData?: Record<string, string>;
  // AGRO : parcelle choisie ou créée avant la saisie — liée au document
  // à la synchronisation (colonne documents.parcelle_id)
  parcelleId?: string;
  // Recensement-specific
  subjectName?: string;
  subjectStatus?: string;
  observation?: string;
};


export type QueueItem = {
  id: string;
  type: DocType;
  audioId?: string;
  transcript?: string;
  photoIds?: string[];
  videoIds?: string[];
  status: QueueStatus;
  remoteDocId?: string;
  errorMsg?: string;
  title?: string;
  meta?: QueueMeta;
  userId?: string;
  createdAt: number;
  updatedAt: number;
  /** Number of times sync has failed. Used for exponential backoff. */
  retryCount?: number;
  /** Earliest timestamp (ms) at which this item may be retried. */
  nextRetryAt?: number;
};


let _db: Promise<IDBPDatabase> | null = null;

function getDB() {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("IndexedDB indisponible côté serveur"));
  }
  if (!_db) {
    _db = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains("audios")) {
          db.createObjectStore("audios", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("queue")) {
          const s = db.createObjectStore("queue", { keyPath: "id" });
          s.createIndex("status", "status");
          s.createIndex("createdAt", "createdAt");
        }
        if (!db.objectStoreNames.contains("photos")) {
          db.createObjectStore("photos", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("videos")) {
          db.createObjectStore("videos", { keyPath: "id" });
        }
        if (!db.objectStoreNames.contains("missionFormsCache")) {
          db.createObjectStore("missionFormsCache", { keyPath: "moduleType" });
        }
        if (!db.objectStoreNames.contains("parcellesCache")) {
          db.createObjectStore("parcellesCache", { keyPath: "userId" });
        }
        if (!db.objectStoreNames.contains("recordDraft")) {
          db.createObjectStore("recordDraft", { keyPath: "id" });
        }
      },
    });
  }
  return _db;
}

function rid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
}

export async function saveAudio(blob: Blob, mimeType: string, durationMs: number) {
  const db = await getDB();
  const rec: AudioRecord = { id: rid(), blob, mimeType, durationMs, createdAt: Date.now() };
  await db.put("audios", rec);
  return rec.id;
}

export async function getAudio(id: string): Promise<AudioRecord | undefined> {
  const db = await getDB();
  return db.get("audios", id);
}

export async function deleteAudio(id: string) {
  const db = await getDB();
  await db.delete("audios", id);
}

export async function savePhoto(blob: Blob, mimeType: string, name: string) {
  const db = await getDB();
  const rec: PhotoRecord = { id: rid(), blob, mimeType, name, createdAt: Date.now() };
  await db.put("photos", rec);
  return rec.id;
}

export async function getPhoto(id: string): Promise<PhotoRecord | undefined> {
  const db = await getDB();
  return db.get("photos", id);
}

export async function deletePhoto(id: string) {
  const db = await getDB();
  await db.delete("photos", id);
}

export async function saveVideo(blob: Blob, mimeType: string, durationMs: number) {
  const db = await getDB();
  const rec: VideoRecord = { id: rid(), blob, mimeType, durationMs, createdAt: Date.now() };
  await db.put("videos", rec);
  return rec.id;
}

export async function getVideo(id: string): Promise<VideoRecord | undefined> {
  const db = await getDB();
  return db.get("videos", id);
}

export async function deleteVideo(id: string) {
  const db = await getDB();
  await db.delete("videos", id);
}

export async function saveMissionFormsCache(moduleType: string, forms: MissionForm[]) {
  const db = await getDB();
  const rec: MissionFormsCacheRecord = { moduleType, forms, cachedAt: Date.now() };
  await db.put("missionFormsCache", rec);
}

export async function getMissionFormsCache(moduleType: string): Promise<MissionForm[] | undefined> {
  const db = await getDB();
  const rec = (await db.get("missionFormsCache", moduleType)) as MissionFormsCacheRecord | undefined;
  return rec?.forms;
}

export async function saveParcellesCache(userId: string, parcelles: CachedParcelle[]) {
  const db = await getDB();
  const rec: ParcellesCacheRecord = { userId, parcelles, cachedAt: Date.now() };
  await db.put("parcellesCache", rec);
}

export async function getParcellesCache(userId: string): Promise<CachedParcelle[] | undefined> {
  const db = await getDB();
  const rec = (await db.get("parcellesCache", userId)) as ParcellesCacheRecord | undefined;
  return rec?.parcelles;
}

export async function saveRecordDraft(draft: Omit<RecordDraft, "updatedAt">) {
  const db = await getDB();
  const rec: RecordDraftRecord = { ...draft, id: "current", updatedAt: Date.now() };
  await db.put("recordDraft", rec);
}

export async function getRecordDraft(): Promise<RecordDraft | undefined> {
  const db = await getDB();
  const rec = (await db.get("recordDraft", "current")) as RecordDraftRecord | undefined;
  if (!rec) return undefined;
  const { id: _id, ...draft } = rec;
  return draft;
}

export async function clearRecordDraft() {
  const db = await getDB();
  await db.delete("recordDraft", "current");
}

export async function enqueue(
  item: Omit<QueueItem, "id" | "status" | "createdAt" | "updatedAt"> & { status?: QueueStatus },
): Promise<QueueItem> {
  const db = await getDB();
  const now = Date.now();
  const full: QueueItem = {
    id: rid(),
    status: item.status ?? "pending",
    createdAt: now,
    updatedAt: now,
    ...item,
  };
  await db.put("queue", full);
  notify();
  return full;
}

export async function updateQueueItem(id: string, patch: Partial<QueueItem>) {
  const db = await getDB();
  const cur = await db.get("queue", id);
  if (!cur) return;
  const next = { ...cur, ...patch, updatedAt: Date.now() };
  await db.put("queue", next);
  notify();
  return next as QueueItem;
}

export async function deleteQueueItem(id: string) {
  const db = await getDB();
  const item = (await db.get("queue", id)) as QueueItem | undefined;
  await db.delete("queue", id);
  if (item?.audioId) {
    try { await db.delete("audios", item.audioId); } catch {}
  }
  if (item?.photoIds?.length) {
    for (const pid of item.photoIds) {
      try { await db.delete("photos", pid); } catch {}
    }
  }
  if (item?.videoIds?.length) {
    for (const vid of item.videoIds) {
      try { await db.delete("videos", vid); } catch {}
    }
  }
  notify();
}

export async function listQueue(): Promise<QueueItem[]> {
  const db = await getDB();
  const all = (await db.getAll("queue")) as QueueItem[];
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function listPending(): Promise<QueueItem[]> {
  const all = await listQueue();
  return all.filter(i => i.status !== "synced");
}

type Listener = () => void;
const listeners = new Set<Listener>();
function notify() {
  listeners.forEach(l => { try { l(); } catch {} });
}
export function subscribeQueue(l: Listener) {
  listeners.add(l);
  return () => { listeners.delete(l); };
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const buf = await blob.arrayBuffer();
  let binary = "";
  const bytes = new Uint8Array(buf);
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + chunk)) as any);
  }
  return btoa(binary);
}
