// ─────────────────────────────────────────────────────────────────────────
// AGRO — Parcelles et coopératives (module AURUM AGRO)
//
// Même pattern que admin.functions.ts : chaque fonction revérifie côté
// serveur l'identité de l'appelant (middleware requireSupabaseAuth) et ne
// travaille QUE sur les données de son organisation, via le client
// `supabaseAdmin` (service role).
//
// La détection de doublon GPS n'utilise PAS de RPC PostgREST — le cache de
// schéma de ce projet restait bloqué de façon persistante (confirmé par
// test REST direct, insensible à NOTIFY/GRANT/recréation/restart/
// renommage). À la place : un SELECT classique par boîte englobante (même
// chemin API REST éprouvé que le reste de l'app), puis un calcul de
// distance haversine exact en JS sur les candidats retenus.
// ─────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DUPLICATE_RADIUS_M = 50;
// Marge large autour du seuil réel (50 m) pour le filtrage grossier par
// boîte englobante — 0.001° ≈ 111 m en latitude, un peu moins en longitude
// selon la latitude ; largement suffisant pour ne rater aucun candidat.
const BBOX_DEGREES = 0.001;

async function getCallerOrg(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("organization_id")
    .eq("id", userId)
    .single();
  const orgId = (data as any)?.organization_id as string | null;
  if (error || !orgId) throw new Error("Aucune organisation associée à ce compte.");
  return orgId;
}

type NearbyParcelle = { id: string; culture: string; distanceMeters: number };
type RiskLevel = "low" | "medium" | "high";

function computeRiskLevel(distanceMeters: number): RiskLevel {
  if (distanceMeters < 15) return "high";
  if (distanceMeters < 30) return "medium";
  return "low";
}

// Superviseur OU admin — pas de RPC (voir plus haut), simple lecture de
// user_roles par le chemin API REST classique.
async function assertSupervisorOrAdminAndGetOrg(userId: string): Promise<string> {
  const orgId = await getCallerOrg(userId);
  const { data: roles, error } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", orgId);
  if (error) throw new Error(error.message);
  const roleSet = new Set(((roles ?? []) as Array<{ role: string }>).map(r => r.role));
  if (!roleSet.has("admin") && !roleSet.has("supervisor")) {
    throw new Error("Accès réservé aux superviseurs et administrateurs.");
  }
  return orgId;
}

function haversineMeters(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

async function findNearbyParcelle(orgId: string, lat: number, lng: number): Promise<NearbyParcelle | null> {
  const { data, error } = await supabaseAdmin
    .from("parcelles")
    .select("id, culture, lat, lng")
    .eq("organization_id", orgId)
    .gte("lat", lat - BBOX_DEGREES)
    .lte("lat", lat + BBOX_DEGREES)
    .gte("lng", lng - BBOX_DEGREES)
    .lte("lng", lng + BBOX_DEGREES);
  if (error) throw new Error("Vérification des doublons impossible : " + error.message);

  let nearest: NearbyParcelle | null = null;
  for (const row of (data ?? []) as Array<{ id: string; culture: string; lat: number; lng: number }>) {
    const distanceMeters = haversineMeters(lat, lng, row.lat, row.lng);
    if (distanceMeters <= DUPLICATE_RADIUS_M && (!nearest || distanceMeters < nearest.distanceMeters)) {
      nearest = { id: row.id, culture: row.culture, distanceMeters: Math.round(distanceMeters) };
    }
  }
  return nearest;
}

// ============================================================
// Parcelles de l'organisation (avec coopérative et nb de visites)
// ============================================================

export const listParcelles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getCallerOrg(context.userId);

    const { data: parcelles, error } = await supabaseAdmin
      .from("parcelles")
      .select("id, culture, surface_ha, cooperative_id, lat, lng, notes, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    if (error) throw new Error(error.message);

    const { data: coops } = await supabaseAdmin
      .from("cooperatives")
      .select("id, name")
      .eq("organization_id", orgId);
    const coopById = new Map(((coops ?? []) as Array<{ id: string; name: string }>).map(c => [c.id, c.name]));

    // Nombre de visites (documents liés) par parcelle
    const ids = ((parcelles ?? []) as Array<{ id: string }>).map(p => p.id);
    const visitCount = new Map<string, number>();
    if (ids.length > 0) {
      const { data: docs } = await supabaseAdmin
        .from("documents")
        .select("parcelle_id")
        .in("parcelle_id", ids);
      for (const d of (docs ?? []) as Array<{ parcelle_id: string | null }>) {
        if (d.parcelle_id) visitCount.set(d.parcelle_id, (visitCount.get(d.parcelle_id) ?? 0) + 1);
      }
    }

    return {
      parcelles: ((parcelles ?? []) as Array<any>).map(p => ({
        id: p.id as string,
        culture: p.culture as string,
        surfaceHa: (p.surface_ha ?? null) as number | null,
        cooperativeName: p.cooperative_id ? (coopById.get(p.cooperative_id) ?? null) : null,
        lat: p.lat as number,
        lng: p.lng as number,
        notes: (p.notes ?? null) as string | null,
        visitCount: visitCount.get(p.id) ?? 0,
      })),
    };
  });

// ============================================================
// Coopératives de l'organisation
// ============================================================

export const listCooperatives = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getCallerOrg(context.userId);
    const { data, error } = await supabaseAdmin
      .from("cooperatives")
      .select("id, name")
      .eq("organization_id", orgId)
      .order("name", { ascending: true });
    if (error) throw new Error(error.message);
    return { cooperatives: ((data ?? []) as Array<{ id: string; name: string }>) };
  });

// ============================================================
// Détection de doublon GPS
// ============================================================

export const checkGpsDuplicate = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { lat: number; lng: number }) =>
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getCallerOrg(context.userId);
    const existing = await findNearbyParcelle(orgId, data.lat, data.lng);
    return existing
      ? { duplicate: true as const, existingParcelle: existing }
      : { duplicate: false as const };
  });

// ============================================================
// Création d'une parcelle (avec garde anti-doublon et audit)
// ============================================================

export const createParcelle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    culture: string;
    surfaceHa?: number;
    cooperativeName?: string;
    lat: number;
    lng: number;
    notes?: string;
    forceCreate?: boolean;
    reason?: string;
  }) =>
    z.object({
      culture: z.string().min(1).max(120),
      surfaceHa: z.number().positive().max(100000).optional(),
      cooperativeName: z.string().min(1).max(200).optional(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      notes: z.string().max(2000).optional(),
      forceCreate: z.boolean().optional(),
      reason: z.string().max(1000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getCallerOrg(context.userId);

    // Garde anti-doublon — même logique que checkGpsDuplicate
    const existing = await findNearbyParcelle(orgId, data.lat, data.lng);
    if (existing && data.forceCreate !== true) {
      return { success: false as const, duplicateFound: true as const, existingParcelle: existing };
    }

    // "Créer quand même" malgré un doublon détecté : justification obligatoire
    const forcingThroughDuplicate = !!existing && data.forceCreate === true;
    const reason = data.reason?.trim() ?? "";
    if (forcingThroughDuplicate && reason.length < 10) {
      throw new Error("Une justification d'au moins 10 caractères est requise pour créer une parcelle malgré un doublon détecté.");
    }

    // Coopérative : réutiliser si elle existe déjà (insensible à la casse), sinon créer
    let cooperativeId: string | null = null;
    if (data.cooperativeName) {
      const wanted = data.cooperativeName.trim();
      const { data: coops, error: coopErr } = await supabaseAdmin
        .from("cooperatives")
        .select("id, name")
        .eq("organization_id", orgId);
      if (coopErr) throw new Error(coopErr.message);
      const match = ((coops ?? []) as Array<{ id: string; name: string }>)
        .find(c => c.name.trim().toLowerCase() === wanted.toLowerCase());
      if (match) {
        cooperativeId = match.id;
      } else {
        const { data: created, error: createErr } = await supabaseAdmin
          .from("cooperatives")
          .insert({ organization_id: orgId, name: wanted } as any)
          .select("id")
          .single();
        if (createErr) throw new Error(createErr.message);
        cooperativeId = (created as any).id as string;
      }
    }

    const { data: parcelle, error: parcErr } = await supabaseAdmin
      .from("parcelles")
      .insert({
        organization_id: orgId,
        culture: data.culture.trim(),
        surface_ha: data.surfaceHa ?? null,
        cooperative_id: cooperativeId,
        lat: data.lat,
        lng: data.lng,
        notes: data.notes?.trim() || null,
        registered_by: context.userId,
      } as any)
      .select("id")
      .single();
    if (parcErr) throw new Error(parcErr.message);
    const parcelleId = (parcelle as any).id as string;

    // Journalisation — jamais bloquante pour l'agent terrain
    try {
      await supabaseAdmin.from("audit_log").insert({
        organization_id: orgId,
        actor_id: context.userId,
        action: "creation",
        entity_type: "parcelle",
        entity_id: parcelleId,
        new_value: {
          culture: data.culture.trim(),
          surface_ha: data.surfaceHa ?? null,
          cooperative_id: cooperativeId,
          lat: data.lat,
          lng: data.lng,
          forced: forcingThroughDuplicate,
        } as any,
      } as any);
    } catch (e) {
      console.warn("audit_log parcelle creation failed (non bloquant)", e);
    }

    // Alerte qualité de données — uniquement quand l'agent a forcé la
    // création malgré un doublon détecté. Jamais bloquant pour l'agent.
    if (forcingThroughDuplicate && existing) {
      try {
        await supabaseAdmin.from("duplicate_alerts").insert({
          organization_id: orgId,
          agent_id: context.userId,
          action: "created_anyway",
          existing_parcelle_id: existing.id,
          new_parcelle_id: parcelleId,
          distance_meters: existing.distanceMeters,
          risk_level: computeRiskLevel(existing.distanceMeters),
          reason,
          lat: data.lat,
          lng: data.lng,
        } as any);
      } catch (e) {
        console.warn("duplicate_alerts insert (created_anyway) failed (non bloquant)", e);
      }
    }

    return { success: true as const, parcelleId };
  });

// ============================================================
// Qualité des données — alertes de doublons GPS
// ============================================================

export const logUsedExistingParcelle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { existingParcelleId: string; lat: number; lng: number; distanceMeters: number }) =>
    z.object({
      existingParcelleId: z.string().uuid(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      distanceMeters: z.number().min(0),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Journalisation silencieuse — ne doit jamais bloquer le flux de saisie
    // de l'agent, même en cas d'échec (organisation introuvable, insert
    // refusé, etc.).
    try {
      const orgId = await getCallerOrg(context.userId);
      await supabaseAdmin.from("duplicate_alerts").insert({
        organization_id: orgId,
        agent_id: context.userId,
        action: "used_existing",
        existing_parcelle_id: data.existingParcelleId,
        new_parcelle_id: null,
        distance_meters: data.distanceMeters,
        risk_level: computeRiskLevel(data.distanceMeters),
        reason: null,
        lat: data.lat,
        lng: data.lng,
      } as any);
    } catch (e) {
      console.warn("duplicate_alerts insert (used_existing) failed (non bloquant)", e);
    }
    return { success: true as const };
  });

export const listDuplicateAlerts = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { reviewStatus?: "pending" | "validated" | "rejected" }) =>
    z.object({
      reviewStatus: z.enum(["pending", "validated", "rejected"]).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    let query = supabaseAdmin
      .from("duplicate_alerts")
      .select("id, agent_id, action, existing_parcelle_id, new_parcelle_id, distance_meters, risk_level, reason, review_status, reviewed_by, reviewed_at, review_notes, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false });
    if (data.reviewStatus) query = query.eq("review_status", data.reviewStatus);

    const { data: alerts, error } = await query;
    if (error) throw new Error(error.message);
    const rows = (alerts ?? []) as Array<any>;

    // Jointures manuelles par chemin API REST classique (pas de RPC) :
    // profils des agents concernés + parcelles impliquées + coopératives.
    const agentIds = Array.from(new Set(rows.map(r => r.agent_id).filter(Boolean)));
    const parcelleIds = Array.from(new Set(
      rows.flatMap(r => [r.existing_parcelle_id, r.new_parcelle_id]).filter(Boolean),
    ));

    const [{ data: agentProfiles }, { data: parcelleRows }, { data: coopRows }] = await Promise.all([
      agentIds.length > 0
        ? supabaseAdmin.from("profiles").select("id, full_name").in("id", agentIds)
        : Promise.resolve({ data: [] as any[] }),
      parcelleIds.length > 0
        ? supabaseAdmin.from("parcelles").select("id, culture, cooperative_id").in("id", parcelleIds)
        : Promise.resolve({ data: [] as any[] }),
      supabaseAdmin.from("cooperatives").select("id, name").eq("organization_id", orgId),
    ]);

    const agentNameById = new Map(((agentProfiles ?? []) as any[]).map(p => [p.id, p.full_name || "Agent"]));
    const coopNameById = new Map(((coopRows ?? []) as any[]).map(c => [c.id, c.name as string]));
    const parcelleById = new Map(((parcelleRows ?? []) as any[]).map(p => [p.id, {
      culture: p.culture as string,
      cooperativeName: p.cooperative_id ? (coopNameById.get(p.cooperative_id) ?? null) : null,
    }]));

    return {
      alerts: rows.map(r => {
        const parcelleInfo = parcelleById.get(r.existing_parcelle_id) ?? null;
        return {
          id: r.id as string,
          agentId: r.agent_id as string,
          agentName: agentNameById.get(r.agent_id) ?? "Agent",
          action: r.action as "created_anyway" | "used_existing",
          existingParcelleId: r.existing_parcelle_id as string,
          newParcelleId: (r.new_parcelle_id ?? null) as string | null,
          culture: parcelleInfo?.culture ?? null,
          cooperativeName: parcelleInfo?.cooperativeName ?? null,
          distanceMeters: Math.round(r.distance_meters as number),
          riskLevel: r.risk_level as RiskLevel,
          reason: (r.reason ?? null) as string | null,
          reviewStatus: r.review_status as "pending" | "validated" | "rejected",
          reviewedBy: (r.reviewed_by ?? null) as string | null,
          reviewedAt: (r.reviewed_at ?? null) as string | null,
          reviewNotes: (r.review_notes ?? null) as string | null,
          createdAt: r.created_at as string,
        };
      }),
    };
  });

export const reviewDuplicateAlert = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { alertId: string; reviewStatus: "validated" | "rejected"; reviewNotes?: string }) =>
    z.object({
      alertId: z.string().uuid(),
      reviewStatus: z.enum(["validated", "rejected"]),
      reviewNotes: z.string().max(1000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    const { data: alert, error: alertErr } = await supabaseAdmin
      .from("duplicate_alerts")
      .select("id, organization_id")
      .eq("id", data.alertId)
      .single();
    if (alertErr || !alert || (alert as any).organization_id !== orgId) {
      throw new Error("Alerte introuvable dans votre organisation.");
    }

    const { error } = await supabaseAdmin
      .from("duplicate_alerts")
      .update({
        review_status: data.reviewStatus,
        reviewed_by: context.userId,
        reviewed_at: new Date().toISOString(),
        review_notes: data.reviewNotes?.trim() || null,
      } as any)
      .eq("id", data.alertId);
    if (error) throw new Error(error.message);

    return { success: true as const };
  });

export const getAgentQualityScores = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    const { data: alerts, error } = await supabaseAdmin
      .from("duplicate_alerts")
      .select("agent_id, action, review_status")
      .eq("organization_id", orgId);
    if (error) throw new Error(error.message);
    const rows = (alerts ?? []) as Array<{ agent_id: string; action: string; review_status: string }>;

    const agentIds = Array.from(new Set(rows.map(r => r.agent_id)));
    const { data: profiles } = agentIds.length > 0
      ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", agentIds)
      : { data: [] as any[] };
    const nameById = new Map(((profiles ?? []) as any[]).map(p => [p.id, p.full_name || "Agent"]));

    type Agg = { total: number; createdAnyway: number; usedExisting: number; reviewed: number; validated: number; confirmedDuplicates: number };
    const byAgent = new Map<string, Agg>();
    for (const r of rows) {
      const agg = byAgent.get(r.agent_id) ?? { total: 0, createdAnyway: 0, usedExisting: 0, reviewed: 0, validated: 0, confirmedDuplicates: 0 };
      agg.total += 1;
      if (r.action === "created_anyway") agg.createdAnyway += 1;
      if (r.action === "used_existing") agg.usedExisting += 1;
      if (r.review_status !== "pending") agg.reviewed += 1;
      if (r.review_status === "validated") {
        agg.validated += 1;
        if (r.action === "created_anyway") agg.confirmedDuplicates += 1;
      }
      byAgent.set(r.agent_id, agg);
    }

    return {
      scores: Array.from(byAgent.entries())
        .map(([agentId, agg]) => ({
          agentId,
          agentName: nameById.get(agentId) ?? "Agent",
          totalAlerts: agg.total,
          createdAnywayRate: agg.total > 0 ? Math.round((agg.createdAnyway / agg.total) * 100) : 0,
          usedExistingRate: agg.total > 0 ? Math.round((agg.usedExisting / agg.total) * 100) : 0,
          validationRate: agg.reviewed > 0 ? Math.round((agg.validated / agg.reviewed) * 100) : 0,
          confirmedDuplicates: agg.confirmedDuplicates,
        }))
        .sort((a, b) => b.totalAlerts - a.totalAlerts),
    };
  });
