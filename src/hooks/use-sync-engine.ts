import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  listPending,
  updateQueueItem,
  getAudio,
  deleteAudio,
  getPhoto,
  deletePhoto,
  blobToBase64,
  subscribeQueue,
  type QueueItem,
} from "@/lib/offline-store";
import { transcribeAudio, generateDocument, reverseGeocode, suggestImprovements } from "@/lib/aurum.functions";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getCachedProfile } from "@/hooks/use-auth";
import { normalizeDocumentType } from "@/lib/document-types";

export function useSyncEngine() {
  const transcribe = useServerFn(transcribeAudio);
  const generate = useServerFn(generateDocument);
  const queryClient = useQueryClient();
  const running = useRef(false);

  useEffect(() => {
    let cancelled = false;

    async function processOne(item: QueueItem) {
      const toastId = `sync-${item.id}`;
      try {
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
        await updateQueueItem(item.id, { status: "generating" });
        toast.loading("🤖 Génération du document…", { id: toastId });

        const requestedType = item.type === "auto" ? undefined : item.type;
        const autoDetect = item.meta?.autoDetect === true || item.type === "auto";

        const result = await generate({
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


        if (!result || !result.title) throw new Error("Génération invalide");

        // ÉTAPE 3.5 — 💡 Suggestions métier (non bloquant)
        let suggestions: string[] = [];
        try {
          const sugg = await suggestImprovements({
            data: { missionType: result.missionType, sections: result.sections, lang, sector, role },
          });

          suggestions = sugg.suggestions ?? [];
        } catch (e) {
          console.warn("suggestImprovements failed", e);
        }

        // Insertion Supabase
        // Normalize the DB `type` column — the check constraint only
        // accepts rapport | pv | recensement | enquete. `missionType`
        // may be `mission_terrain` (legacy) which must collapse to `rapport`.
        const dbType = normalizeDocumentType(result.missionType);

        const { data, error } = await supabase
          .from("documents")
          .insert({
            user_id: userId,
            type: dbType,
            mission_type: result.missionType,
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

        // Upload photos (if any) to storage and patch the document
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
            await supabase
              .from("documents")
              .update({ photo_urls: paths })
              .eq("id", data.id);
          }
          for (const pid of photoIds) {
            try { await deletePhoto(pid); } catch {}
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
        console.log("⏳ ENGINE ALREADY RUNNING");
        return;
      }

      if (!navigator.onLine) {
        console.log("📴 OFFLINE MODE");
        return;
      }

      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session) {
        console.log("🔒 NO SESSION");
        return;
      }

      running.current = true;

      try {
        console.log("🚀 SYNC ENGINE ACTIVE");

        const pending = await listPending();

        console.log("📦 QUEUE LENGTH =", pending.length);

        const now = Date.now();
        const toProcess = pending.filter(
          (i) =>
            i.status === "pending" ||
            i.status === "uploading" ||
            i.status === "transcribing" ||
            i.status === "generating" ||
            (i.status === "error" && (i.nextRetryAt ?? 0) <= now)
        );


        console.log(
          "📋 TO PROCESS =",
          toProcess.map((i) => ({
            id: i.id,
            status: i.status,
            type: i.type,
          }))
        );

        for (const item of toProcess) {
          if (cancelled || !navigator.onLine) {
            console.log("⛔ STOP SYNC LOOP");
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
      console.log("🌐 BACK ONLINE");
      void runPass();
    };

    window.addEventListener("online", onOnline);

    // Manual trigger — dispatch `new CustomEvent("aurum:sync-now")` from anywhere
    const onManualSync = () => {
      console.log("🖐️ MANUAL SYNC TRIGGERED");
      void runPass();
    };
    window.addEventListener("aurum:sync-now", onManualSync);

    const interval = setInterval(() => {
      void runPass();
    }, 30000);

    const unsub = subscribeQueue(() => {
      console.log("📨 QUEUE UPDATED");
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

  }, [transcribe, generate, queryClient]);
}