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
import { computePolygonCenter, computePolygonAreaHectares } from "@/lib/geo-polygon";

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
// Producteurs de l'organisation
// ============================================================

export const listProducers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getCallerOrg(context.userId);

    const { data: producers, error } = await supabaseAdmin
      .from("producers")
      .select("id, full_name, cooperative_id, contact_phone, contact_email")
      .eq("organization_id", orgId)
      .order("full_name", { ascending: true });
    if (error) throw new Error(error.message);

    const { data: coops } = await supabaseAdmin
      .from("cooperatives")
      .select("id, name")
      .eq("organization_id", orgId);
    const coopById = new Map(((coops ?? []) as Array<{ id: string; name: string }>).map(c => [c.id, c.name]));

    const rows = (producers ?? []) as Array<any>;
    const producerIds = rows.map(p => p.id as string);
    const parcelleCountByProducer = new Map<string, number>();
    if (producerIds.length > 0) {
      const { data: parcelleRows } = await supabaseAdmin
        .from("parcelles")
        .select("producer_id")
        .in("producer_id", producerIds);
      for (const p of (parcelleRows ?? []) as Array<{ producer_id: string | null }>) {
        if (p.producer_id) parcelleCountByProducer.set(p.producer_id, (parcelleCountByProducer.get(p.producer_id) ?? 0) + 1);
      }
    }

    return {
      producers: rows.map(p => ({
        id: p.id as string,
        fullName: p.full_name as string,
        cooperativeName: p.cooperative_id ? (coopById.get(p.cooperative_id) ?? null) : null,
        contactPhone: (p.contact_phone ?? null) as string | null,
        contactEmail: (p.contact_email ?? null) as string | null,
        parcelleCount: parcelleCountByProducer.get(p.id) ?? 0,
      })),
    };
  });

export const createProducer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    fullName: string;
    cooperativeId?: string;
    contactPhone?: string;
    contactEmail?: string;
    idDocumentType?: string;
    idDocumentNumber?: string;
  }) =>
    z.object({
      fullName: z.string().min(1).max(200),
      cooperativeId: z.string().uuid().optional(),
      contactPhone: z.string().max(40).optional(),
      contactEmail: z.string().email().max(200).optional(),
      idDocumentType: z.string().max(80).optional(),
      idDocumentNumber: z.string().max(80).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getCallerOrg(context.userId);

    const { data: producer, error } = await supabaseAdmin
      .from("producers")
      .insert({
        organization_id: orgId,
        full_name: data.fullName.trim(),
        cooperative_id: data.cooperativeId ?? null,
        contact_phone: data.contactPhone?.trim() || null,
        contact_email: data.contactEmail?.trim() || null,
        id_document_type: data.idDocumentType?.trim() || null,
        id_document_number: data.idDocumentNumber?.trim() || null,
        registered_by: context.userId,
      } as any)
      .select("id")
      .single();
    if (error) throw new Error(error.message);
    const producerId = (producer as any).id as string;

    // Journalisation — jamais bloquante pour l'agent terrain
    try {
      await supabaseAdmin.from("audit_log").insert({
        organization_id: orgId,
        actor_id: context.userId,
        action: "creation",
        entity_type: "producer",
        entity_id: producerId,
        new_value: {
          full_name: data.fullName.trim(),
          cooperative_id: data.cooperativeId ?? null,
        } as any,
      } as any);
    } catch (e) {
      console.warn("audit_log producer creation failed (non bloquant)", e);
    }

    return { success: true as const, producerId };
  });

export const getProducerDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { producerId: string }) =>
    z.object({ producerId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    const { data: producer, error } = await supabaseAdmin
      .from("producers")
      .select("id, full_name, contact_phone, contact_email, id_document_type, id_document_number, cooperative_id, organization_id")
      .eq("id", data.producerId)
      .single();
    if (error || !producer || (producer as any).organization_id !== orgId) {
      throw new Error("Producteur introuvable dans votre organisation.");
    }
    const p = producer as any;

    const { data: parcelleRows, error: parcErr } = await supabaseAdmin
      .from("parcelles")
      .select("id, culture, surface_ha, created_at")
      .eq("producer_id", data.producerId)
      .order("created_at", { ascending: false });
    if (parcErr) throw new Error(parcErr.message);
    const parcelles = (parcelleRows ?? []) as Array<{ id: string; culture: string; surface_ha: number | null; created_at: string }>;

    const parcelleIds = parcelles.map(pc => pc.id);
    let visitCount = 0;
    if (parcelleIds.length > 0) {
      const { data: docs } = await supabaseAdmin
        .from("documents")
        .select("parcelle_id")
        .in("parcelle_id", parcelleIds);
      visitCount = ((docs ?? []) as Array<{ parcelle_id: string | null }>).filter(d => d.parcelle_id).length;
    }

    return {
      producer: {
        id: p.id as string,
        fullName: p.full_name as string,
        contactPhone: (p.contact_phone ?? null) as string | null,
        contactEmail: (p.contact_email ?? null) as string | null,
        idDocumentType: (p.id_document_type ?? null) as string | null,
        idDocumentNumber: (p.id_document_number ?? null) as string | null,
        cooperativeId: (p.cooperative_id ?? null) as string | null,
      },
      parcelles: parcelles.map(pc => ({
        id: pc.id,
        culture: pc.culture,
        surfaceHa: pc.surface_ha,
        createdAt: pc.created_at,
      })),
      visitCount,
    };
  });

export const updateProducer = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    producerId: string;
    fullName?: string;
    contactPhone?: string;
    contactEmail?: string;
    idDocumentType?: string;
    idDocumentNumber?: string;
    cooperativeId?: string | null;
  }) =>
    z.object({
      producerId: z.string().uuid(),
      fullName: z.string().min(1).max(200).optional(),
      contactPhone: z.string().max(40).optional(),
      contactEmail: z.string().email().max(200).optional(),
      idDocumentType: z.string().max(80).optional(),
      idDocumentNumber: z.string().max(80).optional(),
      cooperativeId: z.string().uuid().nullable().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    const { data: existing, error: fetchErr } = await supabaseAdmin
      .from("producers")
      .select("id, full_name, contact_phone, contact_email, id_document_type, id_document_number, cooperative_id, organization_id")
      .eq("id", data.producerId)
      .single();
    if (fetchErr || !existing || (existing as any).organization_id !== orgId) {
      throw new Error("Producteur introuvable dans votre organisation.");
    }
    const before = existing as any;

    const fieldMap: Array<[keyof typeof data, string]> = [
      ["fullName", "full_name"],
      ["contactPhone", "contact_phone"],
      ["contactEmail", "contact_email"],
      ["idDocumentType", "id_document_type"],
      ["idDocumentNumber", "id_document_number"],
      ["cooperativeId", "cooperative_id"],
    ];

    const updatePayload: Record<string, any> = {};
    const oldValue: Record<string, any> = {};
    const newValue: Record<string, any> = {};
    for (const [key, column] of fieldMap) {
      if (!(key in data)) continue;
      const raw = (data as any)[key];
      const nextValue = typeof raw === "string" ? (raw.trim() || null) : raw;
      const prevValue = before[column] ?? null;
      if (nextValue !== prevValue) {
        updatePayload[column] = nextValue;
        oldValue[column] = prevValue;
        newValue[column] = nextValue;
      }
    }

    if (Object.keys(updatePayload).length === 0) {
      return { success: true as const };
    }

    const { error: updateErr } = await supabaseAdmin
      .from("producers")
      .update(updatePayload as any)
      .eq("id", data.producerId);
    if (updateErr) throw new Error(updateErr.message);

    try {
      await supabaseAdmin.from("audit_log").insert({
        organization_id: orgId,
        actor_id: context.userId,
        action: "modification",
        entity_type: "producer",
        entity_id: data.producerId,
        old_value: oldValue as any,
        new_value: newValue as any,
      } as any);
    } catch (e) {
      console.warn("audit_log producer modification failed (non bloquant)", e);
    }

    return { success: true as const };
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
    producerId?: string;
    producerName?: string;
    lat: number;
    lng: number;
    notes?: string;
    forceCreate?: boolean;
    reason?: string;
    boundaryPoints?: Array<{ lat: number; lng: number }>;
  }) =>
    z.object({
      culture: z.string().min(1).max(120),
      surfaceHa: z.number().positive().max(100000).optional(),
      cooperativeName: z.string().min(1).max(200).optional(),
      producerId: z.string().uuid().optional(),
      producerName: z.string().min(1).max(200).optional(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      notes: z.string().max(2000).optional(),
      forceCreate: z.boolean().optional(),
      reason: z.string().max(1000).optional(),
      boundaryPoints: z.array(z.object({
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
      })).min(3).max(500).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getCallerOrg(context.userId);

    // Périmètre (polygone) — recalcul de sécurité côté serveur, jamais
    // confiance dans un centre/surface envoyé par le client.
    const boundaryCenter = data.boundaryPoints ? computePolygonCenter(data.boundaryPoints) : null;
    const surfaceHaCalculated = data.boundaryPoints
      ? Math.round(computePolygonAreaHectares(data.boundaryPoints) * 100) / 100
      : null;
    const effectiveLat = boundaryCenter?.lat ?? data.lat;
    const effectiveLng = boundaryCenter?.lng ?? data.lng;

    // Garde anti-doublon — même logique que checkGpsDuplicate
    const existing = await findNearbyParcelle(orgId, effectiveLat, effectiveLng);
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

        // Journalisation manuelle (comme partout ailleurs dans ce fichier) —
        // volontairement PAS déléguée à un trigger DB : cette création passe
        // par supabaseAdmin (service role), sous lequel auth.uid() est NULL
        // côté Postgres (le JWT service role ne porte pas de claim "sub").
        // Un trigger générique ne pourrait donc pas attribuer cette création
        // à context.userId — seul le code applicatif le sait ici.
        try {
          await supabaseAdmin.from("audit_log").insert({
            organization_id: orgId,
            actor_id: context.userId,
            action: "creation",
            entity_type: "cooperative",
            entity_id: cooperativeId,
            new_value: { name: wanted } as any,
          } as any);
        } catch (e) {
          console.warn("audit_log cooperative creation failed (non bloquant)", e);
        }
      }
    }

    // Producteur : lien direct par id, ou création/réutilisation par nom libre
    // (même pattern que la coopérative ci-dessus)
    let producerId: string | null = data.producerId ?? null;
    if (producerId) {
      const { data: selectedProducer, error: selectedProducerErr } = await supabaseAdmin
        .from("producers")
        .select("id")
        .eq("id", producerId)
        .eq("organization_id", orgId)
        .maybeSingle();
      if (selectedProducerErr) throw new Error(selectedProducerErr.message);
      if (!selectedProducer) throw new Error("Le producteur sélectionné est introuvable dans votre organisation.");
    }
    if (!producerId && data.producerName) {
      const wanted = data.producerName.trim();
      const { data: existingProducers, error: prodErr } = await supabaseAdmin
        .from("producers")
        .select("id, full_name")
        .eq("organization_id", orgId);
      if (prodErr) throw new Error(prodErr.message);
      const match = ((existingProducers ?? []) as Array<{ id: string; full_name: string }>)
        .find(p => p.full_name.trim().toLowerCase() === wanted.toLowerCase());
      if (match) {
        producerId = match.id;
      } else {
        const { data: created, error: createErr } = await supabaseAdmin
          .from("producers")
          .insert({ organization_id: orgId, full_name: wanted, registered_by: context.userId } as any)
          .select("id")
          .single();
        if (createErr) throw new Error(createErr.message);
        producerId = (created as any).id as string;

        // Journalisation manuelle — même raison que pour la coopérative
        // ci-dessus : cette création par nom libre (distincte de la fonction
        // dédiée createProducer, qui journalise déjà) passe aussi par
        // supabaseAdmin, donc pas de auth.uid() exploitable par un trigger.
        try {
          await supabaseAdmin.from("audit_log").insert({
            organization_id: orgId,
            actor_id: context.userId,
            action: "creation",
            entity_type: "producer",
            entity_id: producerId,
            new_value: { full_name: wanted } as any,
          } as any);
        } catch (e) {
          console.warn("audit_log producer creation (via createParcelle) failed (non bloquant)", e);
        }
      }
    }

    const { data: parcelle, error: parcErr } = await supabaseAdmin
      .from("parcelles")
      .insert({
        organization_id: orgId,
        culture: data.culture.trim(),
        surface_ha: data.surfaceHa ?? surfaceHaCalculated ?? null,
        surface_ha_calculated: surfaceHaCalculated,
        boundary_points: (data.boundaryPoints as any) ?? null,
        cooperative_id: cooperativeId,
        producer_id: producerId,
        lat: effectiveLat,
        lng: effectiveLng,
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
          surface_ha: data.surfaceHa ?? surfaceHaCalculated ?? null,
          surface_ha_calculated: surfaceHaCalculated,
          cooperative_id: cooperativeId,
          producer_id: producerId,
          lat: effectiveLat,
          lng: effectiveLng,
          boundary_points_count: data.boundaryPoints?.length ?? 0,
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
          lat: effectiveLat,
          lng: effectiveLng,
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
  .inputValidator((d: { reviewStatus?: "pending" | "validated" | "rejected" } | undefined) =>
    z.object({
      reviewStatus: z.enum(["pending", "validated", "rejected"]).optional(),
    }).parse(d ?? {}),
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

// ============================================================
// Journal d'activité (audit_log) — lecture seule, superviseur/admin de
// l'organisation uniquement (déjà garanti par la RLS de audit_log, revérifié
// ici comme partout ailleurs dans ce fichier). Couvre les entrées écrites
// manuellement (createParcelle, validateDocument, ...) ET celles des
// triggers automatiques (voir migration 20260714150000...sql) — les deux
// partagent la même table, cette fonction ne fait pas de distinction.
//
// Fenêtre des 200 entrées les plus récentes de l'organisation, filtrée
// ensuite côté client (mêmes filtres table/agent que ceux déjà appliqués
// côté client pour les autres sections de ce tableau de bord) plutôt qu'un
// filtre serveur par requête — cohérent avec le reste de ce fichier.
// ============================================================

export const listAuditLog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    const { data: rows, error } = await supabaseAdmin
      .from("audit_log")
      .select("id, action, entity_type, entity_id, actor_id, created_at")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(200);
    if (error) throw new Error(error.message);

    const actorIds = Array.from(new Set((rows ?? []).map((r: any) => r.actor_id).filter(Boolean)));
    const { data: actorProfiles } = actorIds.length > 0
      ? await supabaseAdmin.from("profiles").select("id, full_name").in("id", actorIds)
      : { data: [] as any[] };
    const actorNameById = new Map(((actorProfiles ?? []) as any[]).map((p) => [p.id, p.full_name || "Utilisateur"]));

    return {
      entries: ((rows ?? []) as Array<any>).map((r) => ({
        id: r.id as string,
        action: r.action as string,
        entityType: r.entity_type as string,
        entityId: (r.entity_id ?? null) as string | null,
        actorId: (r.actor_id ?? null) as string | null,
        actorName: r.actor_id ? (actorNameById.get(r.actor_id) ?? "Utilisateur") : "Système",
        createdAt: r.created_at as string,
      })),
    };
  });

// ============================================================
// Détail complet d'un document (données brutes) — superviseur/admin
// ============================================================

async function signStoragePaths(paths: string[] | null | undefined, bucket: string): Promise<string[]> {
  const list = paths ?? [];
  const urls: string[] = [];
  for (const p of list) {
    if (/^https?:\/\//i.test(p)) { urls.push(p); continue; }
    const { data: signed, error } = await supabaseAdmin.storage.from(bucket).createSignedUrl(p, 3600);
    if (!error && signed) urls.push(signed.signedUrl);
  }
  return urls;
}

export const getDocumentDetails = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { documentId: string }) =>
    z.object({ documentId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    const { data: doc, error: docErr } = await supabaseAdmin
      .from("documents")
      .select("id, user_id, title, transcript, field_data, photo_urls, video_urls, parcelle_id, location, location_data, status, validated_at, created_at, agent_name")
      .eq("id", data.documentId)
      .single();
    if (docErr || !doc) throw new Error("Document introuvable.");
    const d = doc as any;

    const { data: ownerProfile } = await supabaseAdmin
      .from("profiles")
      .select("organization_id")
      .eq("id", d.user_id)
      .single();
    if ((ownerProfile as any)?.organization_id !== orgId) {
      throw new Error("Ce document n'appartient pas à votre organisation.");
    }

    const [photoUrls, videoUrls] = await Promise.all([
      signStoragePaths(d.photo_urls, "recensement-photos"),
      signStoragePaths(d.video_urls, "recensement-videos"),
    ]);

    let parcelle: { culture: string; surfaceHa: number | null; producerName: string | null } | null = null;
    if (d.parcelle_id) {
      const { data: pc } = await supabaseAdmin
        .from("parcelles")
        .select("culture, surface_ha, producer_id")
        .eq("id", d.parcelle_id)
        .single();
      if (pc) {
        const pcRow = pc as any;
        let producerName: string | null = null;
        if (pcRow.producer_id) {
          const { data: prod } = await supabaseAdmin
            .from("producers")
            .select("full_name")
            .eq("id", pcRow.producer_id)
            .single();
          producerName = (prod as any)?.full_name ?? null;
        }
        parcelle = { culture: pcRow.culture as string, surfaceHa: (pcRow.surface_ha ?? null) as number | null, producerName };
      }
    }

    const { data: coreOutputRow } = await supabaseAdmin
      .from("core_outputs")
      .select("payload")
      .eq("document_id", data.documentId)
      .order("processed_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const payload = coreOutputRow ? ((coreOutputRow as any).payload as {
      category?: string; summary?: string; indicators?: Array<{ label: string; value: string }>;
    } | null) : null;

    // Le champ_data est un JSON arbitraire (clé -> valeur saisie) — on le
    // normalise en chaînes pour un affichage clé/valeur simple côté client
    // et pour rester strictement sérialisable par createServerFn.
    const rawFieldData = (d.field_data ?? null) as Record<string, unknown> | null;
    const fieldData: Record<string, string> | null = rawFieldData
      ? Object.fromEntries(Object.entries(rawFieldData).map(([k, v]) => [k, v == null ? "" : String(v)]))
      : null;

    return {
      id: d.id as string,
      title: (d.title ?? null) as string | null,
      transcript: (d.transcript ?? "") as string,
      fieldData,
      photoUrls,
      videoUrls,
      location: (d.location ?? null) as string | null,
      locationData: (d.location_data ?? null) as { lat?: number; lng?: number; city?: string } | null,
      status: (d.status ?? null) as string | null,
      validatedAt: (d.validated_at ?? null) as string | null,
      createdAt: d.created_at as string,
      agentName: (d.agent_name ?? null) as string | null,
      parcelle,
      coreOutput: payload
        ? {
            category: (payload.category ?? null) as string | null,
            summary: (payload.summary ?? null) as string | null,
            indicators: Array.isArray(payload.indicators) ? payload.indicators : [],
          }
        : null,
    };
  });

// ============================================================
// Data Analyst — complétude, validation, volumes (superviseur/admin)
// ============================================================

const DATA_ANALYST_DOCS_LIMIT = 1000;

export const getDataAnalystStats = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    const { data: callerProfile, error: callerErr } = await supabaseAdmin
      .from("profiles")
      .select("module_type")
      .eq("id", context.userId)
      .single();
    if (callerErr || !callerProfile) throw new Error("Profil introuvable.");
    const moduleType = (callerProfile as any).module_type as string;

    const { data: orgProfiles } = await supabaseAdmin
      .from("profiles")
      .select("id")
      .eq("organization_id", orgId);
    const profileIds = ((orgProfiles ?? []) as Array<{ id: string }>).map((p) => p.id);

    type DocRow = {
      photo_urls: string[] | null;
      video_urls: string[] | null;
      location_data: { lat?: number; lng?: number } | null;
      parcelle_id: string | null;
      validated_at: string | null;
      created_at: string;
    };
    let docs: DocRow[] = [];
    if (profileIds.length > 0) {
      const { data } = await supabaseAdmin
        .from("documents")
        .select("photo_urls, video_urls, location_data, parcelle_id, validated_at, created_at")
        .in("user_id", profileIds)
        .eq("module_type", moduleType)
        .order("created_at", { ascending: false })
        .limit(DATA_ANALYST_DOCS_LIMIT);
      docs = (data ?? []) as DocRow[];
    }

    const total = docs.length;
    const pct = (n: number) => (total > 0 ? Math.round((n / total) * 100) : 0);

    const withPhoto = docs.filter((d) => (d.photo_urls?.length ?? 0) > 0).length;
    const withVideo = docs.filter((d) => (d.video_urls?.length ?? 0) > 0).length;
    const withGps = docs.filter((d) => typeof d.location_data?.lat === "number" && typeof d.location_data?.lng === "number").length;
    const withParcelle = docs.filter((d) => !!d.parcelle_id).length;

    const validated = docs.filter((d) => !!d.validated_at);
    const validatedCount = validated.length;
    const pendingCount = total - validatedCount;

    let avgValidationHours: number | null = null;
    if (validatedCount > 0) {
      const totalHours = validated.reduce((sum, d) => {
        const created = new Date(d.created_at).getTime();
        const done = new Date(d.validated_at as string).getTime();
        return sum + Math.max(0, done - created) / (1000 * 60 * 60);
      }, 0);
      avgValidationHours = Math.round((totalHours / validatedCount) * 10) / 10;
    }

    const [{ count: parcelleCount }, { count: producerCount }, { count: cooperativeCount }] = await Promise.all([
      supabaseAdmin.from("parcelles").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
      supabaseAdmin.from("producers").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
      supabaseAdmin.from("cooperatives").select("id", { count: "exact", head: true }).eq("organization_id", orgId),
    ]);

    return {
      totalDocuments: total,
      photoRate: pct(withPhoto),
      videoRate: pct(withVideo),
      gpsRate: pct(withGps),
      parcelleRate: pct(withParcelle),
      validatedRate: pct(validatedCount),
      pendingRate: pct(pendingCount),
      avgValidationHours,
      parcelleCount: parcelleCount ?? 0,
      producerCount: producerCount ?? 0,
      cooperativeCount: cooperativeCount ?? 0,
    };
  });

// ============================================================
// Suivi de parcelle dans le temps — superviseur/admin
// ============================================================

export const getParcelleTimeline = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { parcelleId: string }) =>
    z.object({ parcelleId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    const { data: parcelle, error: parcErr } = await supabaseAdmin
      .from("parcelles")
      .select("id, culture, surface_ha, surface_ha_calculated, boundary_points, lat, lng, cooperative_id, producer_id, organization_id, eudr_deforestation_free, eudr_attested_by, eudr_attested_at, eudr_notes")
      .eq("id", data.parcelleId)
      .single();
    if (parcErr || !parcelle || (parcelle as any).organization_id !== orgId) {
      throw new Error("Parcelle introuvable dans votre organisation.");
    }
    const pc = parcelle as any;

    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("enabled_compliance_modules")
      .eq("id", orgId)
      .single();
    const eudrEnabled = (((org as any)?.enabled_compliance_modules ?? []) as string[]).includes("eudr");

    const [{ data: coop }, { data: producer }, { data: attester }] = await Promise.all([
      pc.cooperative_id
        ? supabaseAdmin.from("cooperatives").select("name").eq("id", pc.cooperative_id).single()
        : Promise.resolve({ data: null as any }),
      pc.producer_id
        ? supabaseAdmin.from("producers").select("full_name").eq("id", pc.producer_id).single()
        : Promise.resolve({ data: null as any }),
      pc.eudr_attested_by
        ? supabaseAdmin.from("profiles").select("full_name").eq("id", pc.eudr_attested_by).single()
        : Promise.resolve({ data: null as any }),
    ]);

    const { data: docs, error: docsErr } = await supabaseAdmin
      .from("documents")
      .select("id, title, mission_type, field_data, user_id, created_at, photo_urls, video_urls, status, validated_at")
      .eq("parcelle_id", data.parcelleId)
      .order("created_at", { ascending: false });
    if (docsErr) throw new Error(docsErr.message);
    const docRows = (docs ?? []) as Array<{
      id: string; title: string | null; mission_type: string | null; field_data: Record<string, unknown> | null;
      user_id: string; created_at: string; photo_urls: string[] | null; video_urls: string[] | null;
      status: string | null; validated_at: string | null;
    }>;

    const agentIds = Array.from(new Set(docRows.map((d) => d.user_id)));
    const agentNameById = new Map<string, string>();
    if (agentIds.length > 0) {
      const { data: profiles } = await supabaseAdmin.from("profiles").select("id, full_name").in("id", agentIds);
      for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
        agentNameById.set(p.id, p.full_name || "Agent");
      }
    }

    return {
      eudrEnabled,
      parcelle: {
        id: pc.id as string,
        culture: pc.culture as string,
        surfaceHa: (pc.surface_ha ?? null) as number | null,
        surfaceHaCalculated: (pc.surface_ha_calculated ?? null) as number | null,
        boundaryPoints: (pc.boundary_points ?? null) as Array<{ lat: number; lng: number }> | null,
        lat: (pc.lat ?? null) as number | null,
        lng: (pc.lng ?? null) as number | null,
        producerName: (producer as any)?.full_name ?? null,
        cooperativeName: (coop as any)?.name ?? null,
        eudr: {
          deforestationFree: (pc.eudr_deforestation_free ?? null) as boolean | null,
          attestedByName: (attester as any)?.full_name ?? null,
          attestedAt: (pc.eudr_attested_at ?? null) as string | null,
          notes: (pc.eudr_notes ?? null) as string | null,
        },
      },
      documents: docRows.map((d) => ({
        id: d.id,
        title: d.title,
        missionType: d.mission_type,
        fieldData: d.field_data
          ? Object.fromEntries(Object.entries(d.field_data).map(([k, v]) => [k, v == null ? "" : String(v)]))
          : null,
        agentName: agentNameById.get(d.user_id) ?? "Agent",
        createdAt: d.created_at,
        photoCount: d.photo_urls?.length ?? 0,
        videoCount: d.video_urls?.length ?? 0,
        status: d.status,
        validatedAt: d.validated_at,
      })),
    };
  });

// ============================================================
// Conformité EUDR — extension optionnelle du module agro, jamais un
// module à part. N'a d'effet que si 'eudr' figure dans
// organizations.enabled_compliance_modules ; sinon renvoie eudrEnabled:
// false et rien d'autre n'est calculé.
// ============================================================

function hasValidBoundary(boundaryPoints: unknown): boolean {
  return Array.isArray(boundaryPoints) && boundaryPoints.length >= 3;
}

export const getEudrCompliance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    const { data: org } = await supabaseAdmin
      .from("organizations")
      .select("enabled_compliance_modules")
      .eq("id", orgId)
      .single();
    const eudrEnabled = (((org as any)?.enabled_compliance_modules ?? []) as string[]).includes("eudr");
    if (!eudrEnabled) {
      return { eudrEnabled: false as const };
    }

    const { data: parcelles, error } = await supabaseAdmin
      .from("parcelles")
      .select("id, culture, boundary_points, eudr_deforestation_free")
      .eq("organization_id", orgId);
    if (error) throw new Error(error.message);
    const rows = (parcelles ?? []) as Array<{
      id: string; culture: string; boundary_points: unknown; eudr_deforestation_free: boolean | null;
    }>;

    const total = rows.length;
    const isCompliant = (p: (typeof rows)[number]) => hasValidBoundary(p.boundary_points) && p.eudr_deforestation_free === true;
    const compliantCount = rows.filter(isCompliant).length;
    const readinessRate = total > 0 ? Math.round((compliantCount / total) * 100) : 0;

    return {
      eudrEnabled: true as const,
      totalParcelles: total,
      compliantCount,
      readinessRate,
      nonCompliantParcelles: rows.filter((p) => !isCompliant(p)).map((p) => ({
        id: p.id,
        culture: p.culture,
        missingPolygon: !hasValidBoundary(p.boundary_points),
        missingAttestation: p.eudr_deforestation_free !== true,
      })),
    };
  });

export const attestEudrCompliance = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { parcelleId: string; deforestationFree: boolean; notes?: string }) =>
    z.object({
      parcelleId: z.string().uuid(),
      deforestationFree: z.boolean(),
      notes: z.string().max(1000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);

    const { data: parcelle, error: parcErr } = await supabaseAdmin
      .from("parcelles")
      .select("id, organization_id")
      .eq("id", data.parcelleId)
      .single();
    if (parcErr || !parcelle || (parcelle as any).organization_id !== orgId) {
      throw new Error("Parcelle introuvable dans votre organisation.");
    }

    const notes = data.notes?.trim() || null;
    const { error } = await supabaseAdmin
      .from("parcelles")
      .update({
        eudr_deforestation_free: data.deforestationFree,
        eudr_attested_by: context.userId,
        eudr_attested_at: new Date().toISOString(),
        eudr_notes: notes,
      } as any)
      .eq("id", data.parcelleId);
    if (error) throw new Error(error.message);

    // Journalisation — jamais bloquante. Réutilise action "modification" /
    // entity_type "parcelle" (déjà éprouvés) plutôt qu'une nouvelle valeur
    // d'enum non vérifiable sur la base réelle.
    try {
      await supabaseAdmin.from("audit_log").insert({
        organization_id: orgId,
        actor_id: context.userId,
        action: "modification",
        entity_type: "parcelle",
        entity_id: data.parcelleId,
        new_value: {
          eudr_deforestation_free: data.deforestationFree,
          eudr_notes: notes,
        } as any,
      } as any);
    } catch (e) {
      console.warn("audit_log eudr attestation failed (non bloquant)", e);
    }

    return { success: true as const };
  });

// ============================================================
// Infos parcelle pour la carte de supervision (popup marqueur)
// ============================================================

export const getParcelleMapInfo = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { parcelleIds: string[] }) =>
    z.object({ parcelleIds: z.array(z.string().uuid()).max(500) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertSupervisorOrAdminAndGetOrg(context.userId);
    if (data.parcelleIds.length === 0) return { parcelles: [] as Array<{ id: string; culture: string; producerName: string | null; cooperativeName: string | null }> };

    const { data: rows, error } = await supabaseAdmin
      .from("parcelles")
      .select("id, culture, cooperative_id, producer_id")
      .in("id", data.parcelleIds)
      .eq("organization_id", orgId);
    if (error) throw new Error(error.message);
    const parcelles = (rows ?? []) as Array<{ id: string; culture: string; cooperative_id: string | null; producer_id: string | null }>;

    const coopIds = Array.from(new Set(parcelles.map((p) => p.cooperative_id).filter((x): x is string => !!x)));
    const producerIds = Array.from(new Set(parcelles.map((p) => p.producer_id).filter((x): x is string => !!x)));

    const [{ data: coops }, { data: producers }] = await Promise.all([
      coopIds.length > 0 ? supabaseAdmin.from("cooperatives").select("id, name").in("id", coopIds) : Promise.resolve({ data: [] as any[] }),
      producerIds.length > 0 ? supabaseAdmin.from("producers").select("id, full_name").in("id", producerIds) : Promise.resolve({ data: [] as any[] }),
    ]);
    const coopNameById = new Map(((coops ?? []) as Array<{ id: string; name: string }>).map((c) => [c.id, c.name]));
    const producerNameById = new Map(((producers ?? []) as Array<{ id: string; full_name: string }>).map((p) => [p.id, p.full_name]));

    return {
      parcelles: parcelles.map((p) => ({
        id: p.id,
        culture: p.culture,
        cooperativeName: p.cooperative_id ? (coopNameById.get(p.cooperative_id) ?? null) : null,
        producerName: p.producer_id ? (producerNameById.get(p.producer_id) ?? null) : null,
      })),
    };
  });
