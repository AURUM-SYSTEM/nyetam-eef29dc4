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
// ─────────────────────────────────────────────────────────────────────────────
import { openDB, type IDBPDatabase } from "idb";
import { debugLog, debugWarn, debugError } from "./debug-log";

const DB_NAME = "aurum-offline";
const DB_VERSION = 7;

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
    // DEBUG TEMPORAIRE — diagnostic du cache parcelles hors-ligne qui
    // apparaît vide malgré une visite en ligne réussie. `blocked` signale un
    // upgrade IndexedDB qui reste bloqué indéfiniment (ex. un autre onglet
    // garde une connexion à une version antérieure ouverte) — dans ce cas la
    // promesse `openDB(...)` ne se résout ni ne rejette jamais, ce qui
    // bloquerait silencieusement tout appel getDB() en aval (aucune erreur
    // visible, juste un cache qui semble ne jamais s'écrire). À retirer une
    // fois la cause confirmée.
    debugLog("[IDB DEBUG] opening DB", DB_NAME, "version", DB_VERSION);
    _db = openDB(DB_NAME, DB_VERSION, {
      blocked(currentVersion, blockedVersion) {
        debugError("[IDB DEBUG] openDB BLOCKED — une autre connexion (onglet ?) garde une version antérieure ouverte", { currentVersion, blockedVersion });
      },
      blocking(currentVersion, blockedVersion) {
        debugWarn("[IDB DEBUG] this connection is BLOCKING a future upgrade", { currentVersion, blockedVersion });
      },
      terminated() {
        debugError("[IDB DEBUG] IndexedDB connection TERMINATED unexpectedly");
      },
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
      },
    });
    // DEBUG TEMPORAIRE — ne change rien au comportement (même promesse
    // retournée), juste de la visibilité sur l'issue réelle de l'ouverture.
    _db
      .then((db) => debugLog("[IDB DEBUG] openDB resolved OK, version", db.version, "stores", Array.from(db.objectStoreNames)))
      .catch((err) => debugError("[IDB DEBUG] openDB REJECTED", err));
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
  // DEBUG TEMPORAIRE — diagnostic du cache parcelles hors-ligne. À retirer
  // une fois la cause confirmée.
  debugLog("[IDB DEBUG] saveParcellesCache called", { userId, count: parcelles.length });
  const db = await getDB();
  const rec: ParcellesCacheRecord = { userId, parcelles, cachedAt: Date.now() };
  await db.put("parcellesCache", rec);
  debugLog("[IDB DEBUG] saveParcellesCache put() completed", { userId, count: parcelles.length });
}

export async function getParcellesCache(userId: string): Promise<CachedParcelle[] | undefined> {
  debugLog("[IDB DEBUG] getParcellesCache called", { userId });
  const db = await getDB();
  const rec = (await db.get("parcellesCache", userId)) as ParcellesCacheRecord | undefined;
  debugLog("[IDB DEBUG] getParcellesCache result", { userId, found: !!rec, record: rec });
  if (!rec) {
    // DEBUG TEMPORAIRE — si le store contient des clés mais pas celle
    // demandée, ça confirme un décalage de clé (écriture sous un autre id)
    // plutôt qu'un cache jamais écrit du tout.
    const allKeys = await db.getAllKeys("parcellesCache");
    debugWarn("[IDB DEBUG] getParcellesCache MISS — all keys currently in store:", allKeys);
  }
  return rec?.parcelles;
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
