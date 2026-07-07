// ─────────────────────────────────────────────────────────────────────────
// AGRO — Parcelles et coopératives (module AURUM AGRO)
//
// Même pattern que admin.functions.ts : chaque fonction revérifie côté
// serveur l'identité de l'appelant (middleware requireSupabaseAuth) et ne
// travaille QUE sur les données de son organisation, via le client
// `supabaseAdmin` (service role). La détection de doublon GPS s'appuie sur
// la fonction SQL `find_nearby_parcelle` (haversine, rayon 50 m).
// ─────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const DUPLICATE_RADIUS_M = 50;

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

async function findNearbyParcelle(orgId: string, lat: number, lng: number): Promise<NearbyParcelle | null> {
  const { data, error } = await supabaseAdmin.rpc("find_nearby_parcelle", {
    _org: orgId,
    _lat: lat,
    _lng: lng,
    _radius_m: DUPLICATE_RADIUS_M,
  });
  if (error) throw new Error("Vérification des doublons impossible : " + error.message);
  const row = (data as Array<{ id: string; culture: string; distance_meters: number }> | null)?.[0];
  if (!row) return null;
  return { id: row.id, culture: row.culture, distanceMeters: Math.round(row.distance_meters) };
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
  }) =>
    z.object({
      culture: z.string().min(1).max(120),
      surfaceHa: z.number().positive().max(100000).optional(),
      cooperativeName: z.string().min(1).max(200).optional(),
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
      notes: z.string().max(2000).optional(),
      forceCreate: z.boolean().optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await getCallerOrg(context.userId);

    // Garde anti-doublon — même logique que checkGpsDuplicate
    const existing = await findNearbyParcelle(orgId, data.lat, data.lng);
    if (existing && data.forceCreate !== true) {
      return { success: false as const, duplicateFound: true as const, existingParcelle: existing };
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
        created_by: context.userId,
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
          forced: data.forceCreate === true && !!existing,
        } as any,
      } as any);
    } catch (e) {
      console.warn("audit_log parcelle creation failed (non bloquant)", e);
    }

    return { success: true as const, parcelleId };
  });
