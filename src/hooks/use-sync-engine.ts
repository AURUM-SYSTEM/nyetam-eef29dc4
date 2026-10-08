// ─────────────────────────────────────────────────────────────────────────────
// SYNC ENGINE — pipeline offline-first de COLLECT
//
// Boucle unique qui draine la file IndexedDB vers Supabase :
//   pending → transcribing (audio → texte) → generating → synced
//
// Deux chemins de traitement cohabitent :
//   • `field_entry` (nouveau, neutre) — sauvegarde brute du transcript,
//     AUCUNE génération structurée. La normalisation est faite par CORE
//     (voir bloc "CORE" plus bas — appel non bloquant, table séparée
//     `core_outputs`, ne touche jamais aux colonnes de `documents`).
//   • types legacy (`rapport`, `pv`, `enquete`, `recensement`) — pipeline IA
//     complet conservé pour compatibilité ascendante. Ne PAS supprimer.
//
// Résilience : retry avec backoff exponentiel (max 8), déclencheurs multiples
// (online, custom event `aurum:sync-now`, interval 30s, subscribe queue).
// ─────────────────────────────────────────────────────────────────────────────
import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  listPending,
  listQueue,
  updateQueueItem,
  getAudio,
  deleteAudio,
  getPhoto,
  deletePhoto,
  getVideo,
  deleteVideo,
  blobToBase64,
  subscribeQueue,
  listPendingParcelles,
  updatePendingParcelle,
  deletePendingParcelle,
  listPendingProducers,
  updatePendingProducer,
  deletePendingProducer,
  isLocalParcelleId,
  isLocalProducerId,
  type QueueItem,
  type PendingParcelle,
  type PendingProducer,
} from "@/lib/offline-store";
import { transcribeAudio, generateDocument, reverseGeocode, suggestImprovements, structureFieldEntry } from "@/lib/aurum.functions";
import { createParcelle, createProducer } from "@/lib/agro.functions";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getCachedProfile } from "@/hooks/use-auth";
import { normalizeDocumentType } from "@/lib/document-types";

const PARCELLE_SYNC_MAX_RETRIES = 8;
// Voir docs/AUDIT_REPORT.md §3.5 — une entrée passe à "syncing" juste avant
// l'appel réseau ; si l'exécution est interrompue à ce moment précis (avant
// que le try/catch ne retombe sur un état final synced/conflict/error),
// elle restait bloquée en "syncing" indéfiniment, puisque seuls "pending" et
// "error" étaient rejoués. Passé ce délai sans conclusion, on considère la
// tentative précédente comme abandonnée et on la rejoue.
const STUCK_SYNCING_THRESHOLD_MS = 2 * 60_000;

// Traçage interne du cycle de vie de la file — jamais affiché à l'écran,
// mais console.log reste visible dans les DevTools de n'importe quel
// utilisateur en production si on ne le limite pas au développement.
function devLog(...args: unknown[]) {
  if (import.meta.env.DEV) console.log(...args);
}

export function useSyncEngine() {
  const transcribe = useServerFn(transcribeAudio);
  const generate = useServerFn(generateDocument);
  const structure = useServerFn(structureFieldEntry);
  const createParc = useServerFn(createParcelle);
  const createProd = useServerFn(createProducer);
  const queryClient = useQueryClient();
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    // ── AGRO : producteurs créés hors-ligne ───────────────────────────────
    // Les producteurs passent AVANT les parcelles : une parcelle peut
    // référencer l'id local du producteur tant que le réseau est coupé.
    async function processProducer(p: PendingProducer) {
      try {
        await updatePendingProducer(p.id, { status: "syncing" });
        const res = await createProd({
          data: {
            offlineClientId: p.id,
            fullName: p.fullName,
            contactPhone: p.contactPhone,
            contactEmail: p.contactEmail,
            idDocumentType: p.idDocumentType,
            idDocumentNumber: p.idDocumentNumber,
            sex: p.sex,
            village: p.village,
            commune: p.commune,
            department: p.department,
            region: p.region,
          },
        });

        if (!res.success) throw new Error("Création du producteur impossible.");

        // Remplace l'id local dans les parcelles et documents en attente.
        const allPendingParcelles = await listPendingParcelles();
        for (const pc of allPendingParcelles) {
          if (pc.producerId === p.id) {
            await updatePendingParcelle(pc.id, { producerId: res.producerId });
          }
        }
        const allQueued = await listQueue();
        for (const doc of allQueued) {
          if (doc.meta?.parcelleId) {
            // Le lien producteur est porté par pendingParcelles ; le document
            // n'a donc rien à remapper ici.
            continue;
          }
        }

        await updatePendingProducer(p.id, {
          status: "syncing",
          remoteProducerId: res.producerId,
          producerCode: res.producerCode,
        });
        await deletePendingProducer(p.id);
      } catch (e: any) {
        const retryCount = (p.retryCount ?? 0) + 1;
        const delayMs = Math.min(5_000 * 2 ** (retryCount - 1), 5 * 60_000);
        await updatePendingProducer(p.id, {
          status: "error",
          errorMsg: e?.message ?? "Erreur inconnue",
          retryCount,
          nextRetryAt: retryCount >= PARCELLE_SYNC_MAX_RETRIES ? Number.MAX_SAFE_INTEGER : Date.now() + delayMs,
        });
      }
    }

    async function processProducerQueue() {
      const producers = await listPendingProducers();
      const now = Date.now();
      const toSync = producers.filter(
        (p) =>
          p.status === "pending" ||
          (p.status === "error" && (p.nextRetryAt ?? 0) <= now),
      );
      for (const p of toSync) {
        if (cancelled || !navigator.onLine) break;
        await processProducer(p);
      }
    }

    // ── AGRO : parcelles créées hors-ligne (recensement_plantations) ────────
    // Rejoue exactement le même appel serveur que le flux en ligne
    // (createParcelle) — donc la même détection de doublon et la même
    // journalisation audit_log, juste différée. Traité AVANT la file de
    // documents ci-dessous : un document de recensement référence sa
    // parcelle via un id temporaire (meta.parcelleId = pendingParcelle.id,
    // voir handleCreateParcelle dans record.$type.tsx) tant qu'elle n'est
    // pas synchronisée — cette passe doit donc résoudre l'id réel et le
    // reporter sur les documents en file AVANT que ceux-ci ne soient traités
    // dans la même passe, sous peine d'insérer un id invalide dans
    // documents.parcelle_id (colonne uuid).
    async function processParcelle(p: PendingParcelle) {
      try {
        await updatePendingParcelle(p.id, { status: "syncing" });
        const res = await createParc({
          data: {
            culture: p.culture,
            surfaceHa: p.surfaceHa,
            cooperativeName: p.cooperativeName,
            producerId: p.producerId,
            producerName: p.producerName,
            lat: p.lat,
            lng: p.lng,
            forceCreate: p.forceCreate,
            reason: p.reason,
            boundaryPoints: p.boundaryPoints,
            species: p.species,
            varieties: p.varieties,
            plantingYear: p.plantingYear,
            landTenure: p.landTenure,
            agroforestry: p.agroforestry,
            certification: p.certification,
            estimatedYieldTonnes: p.estimatedYieldTonnes,
            complianceStatus: p.complianceStatus,
          },
        });

        if (!res.success && res.duplicateFound) {
          // Pas une erreur transitoire : un humain doit décider (voir
          // /parcelles, section "en attente"). Pas de retry automatique.
          await updatePendingParcelle(p.id, {
            status: "conflict",
            existingParcelle: res.existingParcelle,
            errorMsg: undefined,
          });
          return;
        }

        if (res.success) {
          // Remappe l'id temporaire → id réel sur tout document en file qui
          // référence encore cette parcelle (référence croisée parcelle ↔
          // saisie créées offline dans la même session) — AVANT de retirer
          // l'entrée locale, pour ne jamais laisser un document orphelin
          // référencer un id qui n'existe plus nulle part.
          const allQueued = await listQueue();
          for (const doc of allQueued) {
            if (doc.meta?.parcelleId === p.id) {
              await updateQueueItem(doc.id, {
                meta: { ...doc.meta, parcelleId: res.parcelleId },
              });
            }
          }
          // Comme pour les documents synchronisés (listPending() les exclut
          // une fois status="synced"), une fois la vraie ligne créée côté
          // serveur, l'entrée locale n'a plus de raison d'exister — la
          // parcelle réelle apparaît désormais via listParcelles() (voir
          // /parcelles), pas via ce store temporaire.
          await deletePendingParcelle(p.id);
        }
      } catch (e: any) {
        const retryCount = (p.retryCount ?? 0) + 1;
        if (retryCount >= PARCELLE_SYNC_MAX_RETRIES) {
          await updatePendingParcelle(p.id, {
            status: "error",
            errorMsg: `${e?.message ?? "Erreur inconnue"} — abandonné après ${PARCELLE_SYNC_MAX_RETRIES} tentatives.`,
            retryCount,
            nextRetryAt: Number.MAX_SAFE_INTEGER,
          });
          return;
        }
        const delayMs = Math.min(5_000 * 2 ** (retryCount - 1), 5 * 60_000);
        await updatePendingParcelle(p.id, {
          status: "error",
          errorMsg: e?.message ?? "Erreur inconnue",
          retryCount,
          nextRetryAt: Date.now() + delayMs,
        });
      }
    }

    async function processParcelleQueue() {
      const pendingParcelles = await listPendingParcelles();
      const now = Date.now();
      const toSync = pendingParcelles.filter(
        (p) =>
          p.status === "pending" ||
          (p.status === "error" && (p.nextRetryAt ?? 0) <= now) ||
          (p.status === "syncing" && now - p.updatedAt > STUCK_SYNCING_THRESHOLD_MS),
      );
      for (const p of toSync) {
        if (cancelled || !navigator.onLine) break;
        try {
          await processParcelle(p);
        } catch (err) {
          console.error("❌ PARCELLE SYNC CONTINUING AFTER ERROR", err);
        }
      }
    }

    async function processOne(item: QueueItem) {
      const toastId = `sync-${item.id}`;
      try {
        // Un document de recensement peut référencer une parcelle créée
        // hors-ligne pas encore synchronisée (ou en conflit, en attente
        // d'une décision de l'agent) — inséré tel quel, cet id temporaire
        // violerait la contrainte de clé étrangère de documents.parcelle_id.
        // On reporte ce document, sans le faire échouer ni consommer de
        // tentative : processParcelleQueue() ci-dessus l'aura déjà remappé
        // vers le vrai id dès que sa parcelle sera synchronisée.
        if (isLocalParcelleId(item.meta?.parcelleId)) {
          return;
        }

        const {
          data: { session },
        } = await supabase.auth.getSession();

        if (!session?.user) {
          throw new Error("Non authentifié");
        }

        const userId = item.userId ?? session.user.id;
        const profile = getCachedProfile();
        const lang = item.meta?.lang ?? profile?.preferred_lang ?? "fr";
        const country = item.meta?.country ?? profile?.country ?? "";
        const profession = item.meta?.profession ?? profile?.profession ?? "";
        const sector = (profile as any)?.secteur_activite ?? "ong_humanitaire";
        const role = (profile as any)?.role_metier ?? "agent_terrain";


        let transcript = item.transcript ?? "";

        // ÉTAPE 1 — 🎤 Audio reçu
        if (item.audioId && !transcript) {
          toast.loading("🎤 Audio reçu — préparation…", { id: toastId });
        } else {
          toast.loading("📝 Texte reçu — préparation…", { id: toastId });
        }

        // ÉTAPE 2 — 📝 Transcription (transcribes audio if present;
        // when structured transcript already exists (recensement), audio
        // transcription is appended).
        if (item.audioId) {
          await updateQueueItem(item.id, { status: "transcribing" });
          toast.loading("📝 Transcription en cours…", { id: toastId });

          const audio = await getAudio(item.audioId);
          if (!audio) throw new Error("Audio introuvable");

          const audioBase64 = await blobToBase64(audio.blob);
          const t = await transcribe({
            data: { audioBase64, mimeType: audio.mimeType, lang },
          });

          if (!t || !t.text) throw new Error("Transcription invalide ou vide");
          transcript = transcript
            ? `${transcript}\n\n--- ${lang === "en" ? "Field audio transcription" : "Transcription audio terrain"} ---\n${t.text}`
            : t.text;
          await updateQueueItem(item.id, { transcript });
        }

        if (!transcript.trim()) throw new Error("Aucun texte à traiter");

        // ÉTAPE 2.5 — 📍 Résolution de localisation (GPS → reverse geocode)
        const gps = item.meta?.gps;
        let resolvedLocation: {
          lat?: number; lng?: number; city?: string; country?: string;
          source: "gps" | "text" | "none";
        } = { source: "none" };
        let locationLabel = item.meta?.location ?? "";

        if (gps && typeof gps.lat === "number" && typeof gps.lng === "number") {
          try {
            const rg = await reverseGeocode({ data: { lat: gps.lat, lng: gps.lng } });
            resolvedLocation = {
              lat: gps.lat, lng: gps.lng,
              city: rg.city || undefined,
              country: rg.country || undefined,
              source: "gps",
            };
            const parts = [rg.city, rg.country].filter(Boolean).join(", ");
            locationLabel = parts ? `${parts} (GPS)` : `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)} (GPS)`;
          } catch {
            resolvedLocation = { lat: gps.lat, lng: gps.lng, source: "gps" };
            locationLabel = `${gps.lat.toFixed(4)}, ${gps.lng.toFixed(4)} (GPS)`;
          }
        } else if (item.meta?.location?.trim()) {
          resolvedLocation = { city: item.meta.location.trim(), source: "text" };
        }

        // ÉTAPE 3 — 🤖 Génération (auto-détection si demandée)
        // NEW: `field_entry` is a neutral field capture — skip AI report
        // generation entirely. CORE will normalize it downstream. Legacy
        // types keep the existing report pipeline for backward compat.
        await updateQueueItem(item.id, { status: "generating" });

        let result: {
          missionType: string;
          title: string;
          sections?: Record<string, string>;
          introduction: string;
          faits: string;
          declarations: string;
          observations: string;
          conclusion: string;
          cleanedTranscript: string;
        };
        let suggestions: string[] = [];

        if (item.type === "field_entry") {
          toast.loading("💾 Sauvegarde de la saisie…", { id: toastId });
          const firstLine = transcript.split(/\r?\n/).find((l) => l.trim())?.trim() ?? "";
          const title = item.title?.trim()
            || (firstLine ? firstLine.slice(0, 80) : `Saisie du ${new Date().toLocaleDateString(lang === "en" ? "en-GB" : "fr-FR")}`);
          result = {
            missionType: "field_entry",
            title,
            introduction: "",
            faits: "",
            declarations: "",
            observations: "",
            conclusion: "",
            cleanedTranscript: transcript,
          };
        } else {
          toast.loading("🤖 Génération du document…", { id: toastId });
          const requestedType = item.type === "auto" ? undefined : item.type;
          const autoDetect = item.meta?.autoDetect === true || item.type === "auto";
          const gen = await generate({
            data: {
              transcript,
              type: requestedType,
              autoDetect,
              lang,
              country,
              profession,
              sector,
              role,
              location: resolvedLocation.source === "none" ? undefined : resolvedLocation,
            },
          });
          if (!gen || !gen.title) throw new Error("Génération invalide");
          result = gen;

          // ÉTAPE 3.5 — 💡 Suggestions métier (non bloquant)
          try {
            const sugg = await suggestImprovements({
              data: { missionType: gen.missionType, sections: gen.sections, lang, sector, role },
            });
            suggestions = sugg.suggestions ?? [];
          } catch (e) {
            console.warn("suggestImprovements failed", e);
          }
        }


        // Insertion Supabase
        // Normalize the DB `type` column — the check constraint only
        // accepts rapport | pv | recensement | enquete. `missionType`
        // may be `mission_terrain` (legacy) which must collapse to `rapport`.
        // For `field_entry` (neutral capture) use the new type as-is;
        // legacy AI-generated docs collapse mission_terrain → rapport.
        const dbType = item.type === "field_entry"
          ? "field_entry"
          : normalizeDocumentType(result.missionType);

        // IDEMPOTENCE (voir docs/AUDIT_REPORT.md §3.4) : si l'exécution a été
        // interrompue APRÈS un insert précédent réussi mais AVANT le
        // updateQueueItem(...,{status:"synced"}) final, cet item est rejoué
        // depuis le début — sans cette vérification, l'insert ci-dessous
        // créerait un second document identique. `item.id` (l'id local du
        // QueueItem, stable et généré une seule fois) sert de clé
        // d'idempotence, stockée dans documents.client_queue_id (index
        // unique partiel — voir la migration 20260718100000_...sql). On
        // réutilise la ligne existante au lieu d'en créer une seconde.
        const { data: existingDoc } = await supabase
          .from("documents")
          .select("id")
          .eq("client_queue_id", item.id)
          .maybeSingle();

        let data: { id: string };
        if (existingDoc) {
          data = existingDoc;
        } else {
          const { data: inserted, error } = await supabase
            .from("documents")
            .insert({
              user_id: userId,
              client_queue_id: item.id,
              type: dbType,
              mission_type: result.missionType,
              module_type: item.meta?.moduleType ?? null,
              title: result.title ?? "Sans titre",

              transcript: result.cleanedTranscript ?? transcript,
              introduction: result.introduction ?? "",
              faits: result.faits ?? "",
              declarations: result.declarations ?? "",
              observations: result.observations ?? "",
              conclusion: result.conclusion ?? "",
              status: "ready",
              agent_name: item.meta?.agentName ?? "",
              location: locationLabel,
              location_data: resolvedLocation as any,
              field_data: item.meta?.fieldData ?? null,
              parcelle_id: item.meta?.parcelleId ?? null,
              suggestions,
              reference: item.meta?.reference ?? "",
              signature_name:
                item.meta?.signatureName ?? item.meta?.agentName ?? "",
              doc_date: item.meta?.docDate ?? null,
              doc_time: item.meta?.docTime ?? null,
              lang,
            } as any)
            .select("id")
            .single();

          if (error) throw error;
          data = inserted;
        }

        // ÉTAPE 3.6 — 🧩 CORE : structuration IA générique (non bloquant)
        // Ne concerne que les saisies `field_entry` (les types legacy sont
        // déjà structurés par `generateDocument` ci-dessus). Écrit UNIQUEMENT
        // dans `core_outputs`, jamais dans `documents`. Un échec ici ne doit
        // jamais faire échouer la synchronisation de la saisie elle-même —
        // l'agent a déjà son document sauvegardé. Idempotence : sur une
        // reprise après interruption (ligne documents réutilisée ci-dessus),
        // ne pas réécrire un second core_outputs pour le même document.
        if (item.type === "field_entry") {
          try {
            const { data: existingCore } = await supabase
              .from("core_outputs")
              .select("id")
              .eq("document_id", data.id)
              .maybeSingle();
            if (!existingCore) {
              const structured = await structure({
                data: {
                  transcript: result.cleanedTranscript ?? transcript,
                  moduleType: item.meta?.moduleType ?? "generic",
                  lang,
                },
              });
              await supabase.from("core_outputs").insert({
                document_id: data.id,
                module_type: item.meta?.moduleType ?? "generic",
                payload: structured as any,
              } as any);
            }
          } catch (e) {
            console.warn("CORE structureFieldEntry failed (non bloquant)", e);
          }
        }

        // Upload photos (if any) to storage and patch the document.
        // Idempotence : sur une reprise, certaines photos peuvent avoir été
        // uploadées ET supprimées localement (deletePhoto ci-dessous) lors
        // d'une tentative précédente interrompue APRÈS l'upload mais avant
        // la fin du traitement — getPhoto(pid) renvoie alors undefined et
        // ce pid est simplement ignoré (déjà en place côté storage). Sans
        // fusion avec les URLs déjà enregistrées, le .update() suivant
        // écraserait photo_urls avec seulement les photos de CETTE passe,
        // perdant la référence aux photos déjà envoyées lors de la
        // précédente.
        const photoIds = item.photoIds ?? [];
        if (photoIds.length > 0) {
          toast.loading("🖼️ Envoi des photos…", { id: toastId });
          const paths: string[] = [];
          for (const pid of photoIds) {
            const photo = await getPhoto(pid);
            if (!photo) continue;
            const ext = (photo.mimeType.split("/")[1] || "jpg").replace("jpeg", "jpg");
            const path = `${userId}/${data.id}/${pid}.${ext}`;
            const { error: upErr } = await supabase.storage
              .from("recensement-photos")
              .upload(path, photo.blob, {
                contentType: photo.mimeType,
                upsert: true,
              });
            if (upErr) {
              console.error("Photo upload failed", upErr);
              continue;
            }
            paths.push(path);
          }
          if (paths.length > 0) {
            const { data: currentDoc } = await supabase
              .from("documents")
              .select("photo_urls")
              .eq("id", data.id)
              .single();
            const existingPaths = (currentDoc as any)?.photo_urls ?? [];
            const mergedPaths = Array.from(new Set([...existingPaths, ...paths]));
            await supabase
              .from("documents")
              .update({ photo_urls: mergedPaths })
              .eq("id", data.id);
          }
          for (const pid of photoIds) {
            try { await deletePhoto(pid); } catch {}
          }
        }

        // Upload vidéos (si présentes) — même logique que les photos
        const videoIds = item.videoIds ?? [];
        if (videoIds.length > 0) {
          toast.loading("🎬 Envoi de la vidéo…", { id: toastId });
          const vpaths: string[] = [];
          for (const vid of videoIds) {
            const video = await getVideo(vid);
            if (!video) continue;
            const ext = (video.mimeType.split("/")[1] || "webm").split(";")[0];
            const path = `${userId}/${data.id}/${vid}.${ext}`;
            const { error: upErr } = await supabase.storage
              .from("recensement-videos")
              .upload(path, video.blob, {
                contentType: video.mimeType,
                upsert: true,
              });
            if (upErr) {
              console.error("Video upload failed", upErr);
              continue;
            }
            vpaths.push(path);
          }
          if (vpaths.length > 0) {
            const { data: currentDoc } = await supabase
              .from("documents")
              .select("video_urls")
              .eq("id", data.id)
              .single();
            const existingPaths = (currentDoc as any)?.video_urls ?? [];
            const mergedPaths = Array.from(new Set([...existingPaths, ...vpaths]));
            await supabase
              .from("documents")
              .update({ video_urls: mergedPaths })
              .eq("id", data.id);
          }
          for (const vid of videoIds) {
            try { await deleteVideo(vid); } catch {}
          }
        }

        await updateQueueItem(item.id, {
          status: "synced",
          remoteDocId: data.id,
          title: result.title,
          errorMsg: undefined,
        });

        if (item.audioId) {
          try {
            await deleteAudio(item.audioId);
          } catch {}
        }

        // ÉTAPE 4 — 📄 Document prêt
        queryClient.invalidateQueries({ queryKey: ["documents"] });
        toast.success(`📄 Document prêt — ${result.title}`, { id: toastId });
      } catch (e: any) {
        console.error("❌ ITEM FAILED =", e);
        const retryCount = (item.retryCount ?? 0) + 1;
        const MAX_RETRIES = 8;
        if (retryCount >= MAX_RETRIES) {
          await updateQueueItem(item.id, {
            status: "error",
            errorMsg: `${e?.message ?? "Erreur inconnue"} — abandonné après ${MAX_RETRIES} tentatives. Utilisez "Réessayer" pour reprendre.`,
            retryCount,
            nextRetryAt: Number.MAX_SAFE_INTEGER,
          });
          toast.error(`Échec définitif — ${e?.message ?? "Erreur inconnue"}`, { id: toastId });
          return;
        }
        // Exponential backoff: 5s, 10s, 20s, 40s, ... capped at 5 min
        const delayMs = Math.min(5_000 * 2 ** (retryCount - 1), 5 * 60_000);
        await updateQueueItem(item.id, {
          status: "error",
          errorMsg: e?.message ?? "Erreur inconnue",
          retryCount,
          nextRetryAt: Date.now() + delayMs,
        });
        toast.error(`Échec : ${e?.message ?? "Erreur inconnue"} — nouvelle tentative dans ${Math.round(delayMs / 1000)}s`, { id: toastId });
      }
    }





    async function runPass() {
      if (running.current) {
        devLog("⏳ ENGINE ALREADY RUNNING");
        return;
      }

      if (!navigator.onLine) {
        devLog("📴 OFFLINE MODE");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        devLog("🔒 NO SESSION");
        return;
      }

      running.current = true;

      try {
        devLog("🚀 SYNC ENGINE ACTIVE");

        // Producteurs d'abord : les parcelles peuvent dépendre d'un id local.
        await processProducerQueue();

        // AVANT les documents : voir le commentaire au-dessus de
        // processParcelleQueue — un document en attente peut référencer une
        // parcelle qui vient tout juste d'être synchronisée dans cette même
        // passe, et a besoin de son id réel avant d'être lui-même traité.
        await processParcelleQueue();

        const pending = await listPending();

        devLog("📦 QUEUE LENGTH =", pending.length);

        const now = Date.now();
        const toProcess = pending.filter(
          (i) =>
            i.status === "pending" ||
            i.status === "uploading" ||
            i.status === "transcribing" ||
            i.status === "generating" ||
            (i.status === "error" && (i.nextRetryAt ?? 0) <= now)
        );


        devLog(
          "📋 TO PROCESS =",
          toProcess.map((i) => ({
            id: i.id,
            status: i.status,
            type: i.type,
          }))
        );

        for (const item of toProcess) {
          if (cancelled || !navigator.onLine) {
            devLog("⛔ STOP SYNC LOOP");
            break;
          }

          try {
            await processOne(item);
          } catch (err) {
            console.error(
              "❌ CONTINUING AFTER ERROR",
              err
            );
          }
        }
      } catch (err) {
        console.error("❌ RUNPASS FAILED =", err);
      } finally {
        running.current = false;
      }
    }

    const onOnline = () => {
      devLog("🌐 BACK ONLINE");
      void runPass();
    };

    window.addEventListener("online", onOnline);

    // Manual trigger — dispatch `new CustomEvent("aurum:sync-now")` from anywhere
    const onManualSync = () => {
      devLog("🖐️ MANUAL SYNC TRIGGERED");
      void runPass();
    };
    window.addEventListener("aurum:sync-now", onManualSync);

    const interval = setInterval(() => {
      void runPass();
    }, 30000);

    const unsub = subscribeQueue(() => {
      devLog("📨 QUEUE UPDATED");
      void runPass();
    });

    void runPass();

    return () => {
      cancelled = true;
      window.removeEventListener("online", onOnline);
      window.removeEventListener("aurum:sync-now", onManualSync);
      clearInterval(interval);
      unsub();
    };

  }, [transcribe, generate, structure, createParc, createProd, queryClient]);
}
