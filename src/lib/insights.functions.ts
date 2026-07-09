// ─────────────────────────────────────────────────────────────────────────
// INSIGHTS — Fonctionnalités IA pour le superviseur
//
// - askAgriAssistant : assistant conversationnel (module AGRO), répond à
//   des questions libres sur les données de l'organisation.
// - generateOrientations : synthèse automatique (tendances, points
//   d'attention, recommandations) à partir des documents et core_outputs
//   du module du superviseur. Chaque génération est archivée dans
//   agro_advisor_reports (statut a_traiter/traite).
// - listAdvisorReports / markAdvisorReportTreated : historique et suivi de
//   traitement de ces analyses archivées.
//
// Même pattern d'authentification/scoping que le reste de l'app (voir
// agro.functions.ts) : chaque fonction revérifie côté serveur l'identité
// de l'appelant (middleware requireSupabaseAuth), son rôle (superviseur ou
// admin) et son organisation, via le client `supabaseAdmin` (service role).
//
// L'appel IA réutilise le même backend Gemini que aurum.functions.ts
// (endpoint generateContent, clé GEMINI_API_KEY) — implémentation autonome
// ici pour ne pas toucher à aurum.functions.ts.
// ─────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const GEMINI_URL = "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";

function getGeminiKey(): string {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("GEMINI_API_KEY manquante — à configurer dans les variables d'environnement du projet.");
  return key;
}

async function callGemini(question: string, systemText: string): Promise<string> {
  const apiKey = getGeminiKey();
  const res = await fetch(GEMINI_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-goog-api-key": apiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: systemText }] },
      contents: [{ role: "user", parts: [{ text: question }] }],
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Limite de requêtes Gemini atteinte, réessayez dans un instant.");
    if (res.status === 401 || res.status === 403) throw new Error("Clé GEMINI_API_KEY invalide ou expirée.");
    throw new Error(`Erreur Gemini (${res.status}): ${text.slice(0, 200)}`);
  }
  const json = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return (json.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
}

// Superviseur OU admin — vérification autonome (même logique que
// assertSupervisorOrAdminAndGetOrg dans agro.functions.ts, dupliquée ici
// pour ne pas dépendre d'un export croisé entre fichiers).
async function assertSupervisorOrAdminAndGetOrg(userId: string): Promise<string> {
  const { data: profile, error: profileErr } = await supabaseAdmin
    .from("profiles")
    .select("organization_id")
    .eq("id", userId)
    .single();
  const orgId = (profile as any)?.organization_id as string | null;
  if (profileErr || !orgId) throw new Error("Aucune organisation associée à ce compte.");

  const { data: roles, error: rolesErr } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", orgId);
  if (rolesErr) throw new Error(rolesErr.message);
  const roleSet = new Set(((roles ?? []) as Array<{ role: string }>).map((r) => r.role));
  if (!roleSet.has("admin") && !roleSet.has("supervisor")) {
    throw new Error("Accès réservé aux superviseurs et administrateurs.");
  }
  return orgId;
}

const DOCUMENTS_LIMIT = 200;

// Rassemble un contexte de données récent et borné pour l'organisation —
// jamais tout l'historique — à fournir tel quel à l'IA.
async function buildAgroContext(orgId: string): Promise<string> {
  const [{ data: cooperatives }, { data: producers }, { data: parcelles }, { data: orgProfiles }] = await Promise.all([
    supabaseAdmin.from("cooperatives").select("id, name").eq("organization_id", orgId),
    supabaseAdmin.from("producers").select("id, full_name, cooperative_id").eq("organization_id", orgId),
    supabaseAdmin.from("parcelles").select("id, culture, surface_ha, cooperative_id, producer_id, created_at").eq("organization_id", orgId),
    supabaseAdmin.from("profiles").select("id, full_name").eq("organization_id", orgId),
  ]);

  const coopNameById = new Map(((cooperatives ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
  const agentNameById = new Map(
    ((orgProfiles ?? []) as Array<{ id: string; full_name: string | null }>).map((p) => [p.id, p.full_name || "Agent"]),
  );
  const profileIds = ((orgProfiles ?? []) as Array<{ id: string }>).map((p) => p.id);

  const parcelleRows = (parcelles ?? []) as Array<{
    id: string; culture: string; surface_ha: number | null; cooperative_id: string | null; producer_id: string | null; created_at: string;
  }>;
  const parcelleById = new Map(parcelleRows.map((p) => [p.id, p]));

  // Documents récents de l'organisation (bornés aux 200 derniers)
  let recentDocs: Array<{ id: string; title: string | null; user_id: string; created_at: string; status: string | null; parcelle_id: string | null }> = [];
  if (profileIds.length > 0) {
    const { data: docs } = await supabaseAdmin
      .from("documents")
      .select("id, title, user_id, created_at, status, parcelle_id")
      .in("user_id", profileIds)
      .order("created_at", { ascending: false })
      .limit(DOCUMENTS_LIMIT);
    recentDocs = (docs ?? []) as typeof recentDocs;
  }

  // Dernière visite par parcelle, déduite du même échantillon borné
  const lastVisitByParcelle = new Map<string, string>();
  for (const d of recentDocs) {
    if (!d.parcelle_id) continue;
    const existing = lastVisitByParcelle.get(d.parcelle_id);
    if (!existing || d.created_at > existing) lastVisitByParcelle.set(d.parcelle_id, d.created_at);
  }

  const producerRows = (producers ?? []) as Array<{ id: string; full_name: string; cooperative_id: string | null }>;
  const parcellesByProducer = new Map<string, typeof parcelleRows>();
  for (const p of parcelleRows) {
    if (!p.producer_id) continue;
    const list = parcellesByProducer.get(p.producer_id) ?? [];
    list.push(p);
    parcellesByProducer.set(p.producer_id, list);
  }

  const producerLines = producerRows.map((p) => {
    const own = parcellesByProducer.get(p.id) ?? [];
    let lastVisit: string | null = null;
    for (const pc of own) {
      const v = lastVisitByParcelle.get(pc.id);
      if (v && (!lastVisit || v > lastVisit)) lastVisit = v;
    }
    const coopName = p.cooperative_id ? (coopNameById.get(p.cooperative_id) ?? "coopérative inconnue") : "aucune coopérative";
    return `- ${p.full_name} | coopérative : ${coopName} | parcelles : ${own.length} | dernière visite (fenêtre récente) : ${lastVisit ? new Date(lastVisit).toLocaleDateString("fr-FR") : "aucune visite récente enregistrée"}`;
  });

  const producerNameById = new Map(producerRows.map((p) => [p.id, p.full_name]));
  const parcelleLines = parcelleRows.map((p) => {
    const coopName = p.cooperative_id ? (coopNameById.get(p.cooperative_id) ?? "—") : "—";
    const producerName = p.producer_id ? (producerNameById.get(p.producer_id) ?? "—") : "—";
    return `- culture : ${p.culture} | surface : ${p.surface_ha != null ? `${p.surface_ha} ha` : "non renseignée"} | coopérative : ${coopName} | producteur : ${producerName} | créée le : ${new Date(p.created_at).toLocaleDateString("fr-FR")}`;
  });

  // Alertes de doublons, groupées par coopérative et par agent
  const { data: alerts } = await supabaseAdmin
    .from("duplicate_alerts")
    .select("agent_id, existing_parcelle_id, review_status")
    .eq("organization_id", orgId);
  const alertRows = (alerts ?? []) as Array<{ agent_id: string; existing_parcelle_id: string; review_status: string }>;

  type AlertAgg = { total: number; pending: number; validated: number; rejected: number };
  const byCoop = new Map<string, AlertAgg>();
  const byAgent = new Map<string, AlertAgg>();
  const bump = (map: Map<string, AlertAgg>, key: string, status: string) => {
    const agg = map.get(key) ?? { total: 0, pending: 0, validated: 0, rejected: 0 };
    agg.total += 1;
    if (status === "pending") agg.pending += 1;
    else if (status === "validated") agg.validated += 1;
    else if (status === "rejected") agg.rejected += 1;
    map.set(key, agg);
  };
  for (const a of alertRows) {
    const parcelle = parcelleById.get(a.existing_parcelle_id);
    const coopName = parcelle?.cooperative_id ? (coopNameById.get(parcelle.cooperative_id) ?? "coopérative inconnue") : "sans coopérative";
    bump(byCoop, coopName, a.review_status);
    const agentName = agentNameById.get(a.agent_id) ?? "agent inconnu";
    bump(byAgent, agentName, a.review_status);
  }
  const fmtAgg = (agg: AlertAgg) => `${agg.total} alerte(s) (en attente : ${agg.pending}, validées : ${agg.validated}, rejetées : ${agg.rejected})`;
  const coopAlertLines = Array.from(byCoop.entries()).map(([name, agg]) => `- ${name} : ${fmtAgg(agg)}`);
  const agentAlertLines = Array.from(byAgent.entries()).map(([name, agg]) => `- ${name} : ${fmtAgg(agg)}`);

  const docLines = recentDocs.map((d) =>
    `- "${d.title || "sans titre"}" | agent : ${agentNameById.get(d.user_id) ?? "agent inconnu"} | date : ${new Date(d.created_at).toLocaleDateString("fr-FR")} | statut : ${d.status === "ready" ? "synchronisé" : "brouillon"}`,
  );

  return [
    `PRODUCTEURS (${producerRows.length}) :`,
    producerLines.length > 0 ? producerLines.join("\n") : "Aucun producteur enregistré.",
    "",
    `PARCELLES (${parcelleRows.length}) :`,
    parcelleLines.length > 0 ? parcelleLines.join("\n") : "Aucune parcelle enregistrée.",
    "",
    "ALERTES DE DOUBLONS GPS PAR COOPÉRATIVE :",
    coopAlertLines.length > 0 ? coopAlertLines.join("\n") : "Aucune alerte de doublon.",
    "",
    "ALERTES DE DOUBLONS GPS PAR AGENT :",
    agentAlertLines.length > 0 ? agentAlertLines.join("\n") : "Aucune alerte de doublon.",
    "",
    `DOCUMENTS RÉCENTS (${recentDocs.length} sur un maximum de ${DOCUMENTS_LIMIT}) :`,
    docLines.length > 0 ? docLines.join("\n") : "Aucun document récent.",
  ].join("\n");
}

export const askAgriAssistant = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { question: string }) =>
    z.object({ question: z.string().min(1).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);
    const dataContext = await buildAgroContext(orgId);

    const system = [
      "Tu es un assistant de données pour un superviseur agricole (module AURUM AGRO).",
      "Réponds UNIQUEMENT à partir des données ci-dessous — n'invente JAMAIS de chiffres, de noms ou de faits qui n'y figurent pas.",
      "Réponds en français, de façon concise (quelques phrases ou une petite liste à puces).",
      "Si la question sort du périmètre des données fournies, ou que tu ne peux pas y répondre avec certitude à partir de ces données, réponds EXACTEMENT : « Je n'ai pas assez d'information pour répondre à ça. »",
      "",
      "DONNÉES DE L'ORGANISATION (fenêtre récente, non exhaustive) :",
      dataContext,
    ].join("\n");

    const answer = await callGemini(data.question.trim(), system);
    return { answer: answer.trim() || "Je n'ai pas assez d'information pour répondre à ça." };
  });

// ============================================================
// Analyse IA — Orientations (synthèse automatique, pas de question posée)
// ============================================================

const ORIENTATIONS_DOCS_LIMIT = 200;

export const generateOrientations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    // Le module de l'appelant borne le périmètre de l'analyse.
    const { data: callerProfile, error: callerErr } = await supabaseAdmin
      .from("profiles")
      .select("module_type")
      .eq("id", context.userId)
      .single();
    if (callerErr || !callerProfile) throw new Error("Profil introuvable.");
    const moduleType = (callerProfile as any).module_type as string;

    const { data: orgProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id, full_name")
      .eq("organization_id", orgId);
    const profileRows = (orgProfiles ?? []) as Array<{ id: string; full_name: string | null }>;
    const profileIds = profileRows.map((p) => p.id);
    const agentNameById = new Map(profileRows.map((p) => [p.id, p.full_name || "Agent"]));

    let docs: Array<{ id: string; title: string | null; user_id: string; created_at: string; status: string | null }> = [];
    if (profileIds.length > 0) {
      const { data } = await supabaseAdmin
        .from("documents")
        .select("id, title, user_id, created_at, status")
        .in("user_id", profileIds)
        .eq("module_type", moduleType)
        .order("created_at", { ascending: false })
        .limit(ORIENTATIONS_DOCS_LIMIT);
      docs = (data ?? []) as typeof docs;
    }

    const docIds = docs.map((d) => d.id);
    let outputs: Array<{ document_id: string; payload: unknown }> = [];
    if (docIds.length > 0) {
      const { data } = await supabaseAdmin
        .from("core_outputs")
        .select("document_id, payload")
        .in("document_id", docIds)
        .eq("module_type", moduleType);
      outputs = (data ?? []) as typeof outputs;
    }

    const count = docs.length;
    if (count === 0) {
      return { analysis: "Aucune donnée disponible pour générer une analyse.", count: 0 };
    }

    const docLines = docs.map((d) =>
      `- "${d.title || "sans titre"}" | agent : ${agentNameById.get(d.user_id) ?? "agent inconnu"} | date : ${new Date(d.created_at).toLocaleDateString("fr-FR")} | statut : ${d.status === "ready" ? "synchronisé" : "brouillon"}`,
    );

    const outputLines = outputs.map((o) => {
      const p = (o.payload ?? {}) as { category?: string; summary?: string; indicators?: Array<{ label: string; value: string }>; tags?: string[] };
      const indicators = (p.indicators ?? []).map((i) => `${i.label} : ${i.value}`).join(", ");
      const tags = p.tags?.length ? p.tags.join(", ") : "";
      return `- catégorie : ${p.category ?? "—"} | résumé : ${p.summary ?? "—"}${indicators ? ` | indicateurs : ${indicators}` : ""}${tags ? ` | tags : ${tags}` : ""}`;
    });

    const dataContext = [
      `DOCUMENTS (${docs.length} sur un maximum de ${ORIENTATIONS_DOCS_LIMIT}, module ${moduleType}) :`,
      docLines.join("\n"),
      "",
      `DONNÉES STRUCTURÉES (core_outputs, ${outputs.length}) :`,
      outputLines.length > 0 ? outputLines.join("\n") : "Aucune donnée structurée.",
    ].join("\n");

    const system = [
      `Tu es un analyste terrain pour une organisation de reporting (module ${moduleType}).`,
      "À partir UNIQUEMENT des données ci-dessous, rédige une synthèse en français, 250 mots maximum, structurée en 3 parties :",
      "1) Tendances observées",
      "2) Points d'attention",
      "3) Recommandations concrètes (3 maximum)",
      "N'invente JAMAIS de chiffres, de noms ou de faits absents des données fournies. Reste factuel et concis.",
      "",
      "DONNÉES DE L'ORGANISATION :",
      dataContext,
    ].join("\n");

    const analysis = (await callGemini("Génère la synthèse demandée à partir des données ci-dessus.", system)).trim();

    // Archivage — jamais bloquant pour l'affichage du résultat au superviseur.
    try {
      await supabaseAdmin.from("agro_advisor_reports").insert({
        organization_id: orgId,
        generated_by: context.userId,
        analysis,
        documents_analyzed: count,
        status: "a_traiter",
      } as any);
    } catch (e) {
      console.warn("agro_advisor_reports insert failed (non bloquant)", e);
    }

    return { analysis, count };
  });

// ============================================================
// Historique des analyses Agro Advisor
// ============================================================

export const listAdvisorReports = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    const { data, error } = await supabaseAdmin
      .from("agro_advisor_reports")
      .select("id, analysis, documents_analyzed, generated_by, status, treated_by, treated_at, treatment_notes, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as Array<{
      id: string; analysis: string; documents_analyzed: number; generated_by: string;
      status: string; treated_by: string | null; treated_at: string | null; treatment_notes: string | null; created_at: string;
    }>;

    const userIds = Array.from(new Set(rows.flatMap((r) => [r.generated_by, r.treated_by]).filter((v): v is string => !!v)));
    const nameById = new Map<string, string>();
    if (userIds.length > 0) {
      const { data: profiles } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", userIds);
      for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
        nameById.set(p.id, p.full_name || "Agent");
      }
    }

    return {
      reports: rows.map((r) => ({
        id: r.id,
        analysis: r.analysis,
        documentsAnalyzed: r.documents_analyzed,
        generatedByName: nameById.get(r.generated_by) ?? "Superviseur",
        status: r.status as "a_traiter" | "traite",
        treatedByName: r.treated_by ? (nameById.get(r.treated_by) ?? "Agent") : null,
        treatedAt: r.treated_at,
        treatmentNotes: r.treatment_notes,
        createdAt: r.created_at,
      })),
    };
  });

export const markAdvisorReportTreated = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reportId: string; treatmentNotes?: string }) =>
    z.object({
      reportId: z.string().uuid(),
      treatmentNotes: z.string().max(1000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    const { data: report, error: reportErr } = await supabaseAdmin
      .from("agro_advisor_reports")
      .select("id, organization_id")
      .eq("id", data.reportId)
      .single();
    if (reportErr || !report || (report as any).organization_id !== orgId) {
      throw new Error("Analyse introuvable dans votre organisation.");
    }

    const { error } = await supabaseAdmin
      .from("agro_advisor_reports")
      .update({
        status: "traite",
        treated_by: context.userId,
        treated_at: new Date().toISOString(),
        treatment_notes: data.treatmentNotes?.trim() || null,
      } as any)
      .eq("id", data.reportId);
    if (error) throw new Error(error.message);

    return { success: true as const };
  });
