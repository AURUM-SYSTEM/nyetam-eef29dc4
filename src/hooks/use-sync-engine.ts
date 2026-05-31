import { useEffect, useRef } from "react";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import {
  listPending,
  updateQueueItem,
  getAudio,
  deleteAudio,
  blobToBase64,
  subscribeQueue,
  type QueueItem,
} from "@/lib/offline-store";
import { transcribeAudio, generateDocument } from "@/lib/aurum.functions";
import { supabase } from "@/integrations/supabase/client";
import { useServerFn } from "@tanstack/react-start";
import { getCachedProfile } from "@/hooks/use-auth";

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

        let transcript = item.transcript ?? "";

        // ÉTAPE 1 — 🎤 Audio reçu
        if (item.audioId && !transcript) {
          toast.loading("🎤 Audio reçu — préparation…", { id: toastId });
        } else {
          toast.loading("📝 Texte reçu — préparation…", { id: toastId });
        }

        // ÉTAPE 2 — 📝 Transcription
        if (item.audioId && !transcript) {
          await updateQueueItem(item.id, { status: "transcribing" });
          toast.loading("📝 Transcription en cours…", { id: toastId });

          const audio = await getAudio(item.audioId);
          if (!audio) throw new Error("Audio introuvable");

          const audioBase64 = await blobToBase64(audio.blob);
          const t = await transcribe({
            data: { audioBase64, mimeType: audio.mimeType, lang },
          });

          if (!t || !t.text) throw new Error("Transcription invalide ou vide");
          transcript = t.text;
          await updateQueueItem(item.id, { transcript });
        }

        if (!transcript.trim()) throw new Error("Aucun texte à traiter");

        // ÉTAPE 3 — 🤖 Génération
        await updateQueueItem(item.id, { status: "generating" });
        toast.loading("🤖 Génération du document…", { id: toastId });

        const result = await generate({
          data: { transcript, type: item.type, lang, country, profession },
        });

        if (!result || !result.title) throw new Error("Génération invalide");

        // Insertion Supabase
        const { data, error } = await supabase
          .from("documents")
          .insert({
            user_id: userId,
            type: item.type,
            title: result.title ?? "Sans titre",
            transcript: result.cleanedTranscript ?? transcript,
            introduction: result.introduction ?? "",
            faits: result.faits ?? "",
            declarations: result.declarations ?? "",
            observations: result.observations ?? "",
            conclusion: result.conclusion ?? "",
            status: "ready",
            agent_name: item.meta?.agentName ?? "",
            location: item.meta?.location ?? "",
            reference: item.meta?.reference ?? "",
            signature_name:
              item.meta?.signatureName ?? item.meta?.agentName ?? "",
            doc_date: item.meta?.docDate ?? null,
            doc_time: item.meta?.docTime ?? null,
            lang,
          })
          .select("id")
          .single();

        if (error) throw error;

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
        await updateQueueItem(item.id, {
          status: "error",
          errorMsg: e?.message ?? "Erreur inconnue",
        });
        toast.error(`Échec : ${e?.message ?? "Erreur inconnue"}`, { id: toastId });
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

        const toProcess = pending.filter(
          (i) =>
            i.status === "pending" ||
            i.status === "uploading" ||
            i.status === "transcribing" ||
            i.status === "generating"
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

      clearInterval(interval);

      unsub();
    };
  }, [transcribe, generate, queryClient]);
}