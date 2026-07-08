// ─────────────────────────────────────────────────────────────────────────
// INSIGHTS — Assistant IA conversationnel pour le superviseur (module AGRO)
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
