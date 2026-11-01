import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { assertPermission, getCallerOrganizationId } from "@/lib/rbac";

async function assertProducerCardsEnabled(userId: string): Promise<string> {
  const orgId = await getCallerOrganizationId(userId);
  const { data, error } = await supabaseAdmin
    .from("organizations")
    .select("enabled_features")
    .eq("id", orgId)
    .single();
  if (error) throw new Error(error.message);
  const features = ((data as any)?.enabled_features ?? []) as string[];
  if (!features.includes("producer_cards")) {
    throw new Error("La fonctionnalité « Cartes producteurs » n'est pas activée pour cette organisation.");
  }
  return orgId;
}

async function canManageProducerCards(userId: string, organizationId: string, supabase: any): Promise<boolean> {
  try {
    const { data, error } = await supabase.rpc("has_role", { _user: userId, _role: "platform_admin" });
    if (!error && data === true) return true;
  } catch {}
  try {
    await assertPermission(userId, "producers.cards.create", organizationId);
    return true;
  } catch {
    return false;
  }
}

export const getProducerCardsFeatureStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getCallerOrganizationId(context.userId);
    const { data, error } = await supabaseAdmin.from("organizations").select("enabled_features").eq("id", orgId).single();
    if (error) throw new Error(error.message);
    const enabled = (((data as any)?.enabled_features ?? []) as string[]).includes("producer_cards");
    const canCreate = await canManageProducerCards(context.userId, orgId, context.supabase);
    return { enabled: enabled && canCreate };
  });

export const getProducerCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { producerId: string }) =>
    z.object({ producerId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertProducerCardsEnabled(context.userId);
    await assertPermission(context.userId, "producers.cards.view", orgId);

    const { data: card, error } = await supabaseAdmin
      .from("producer_cards")
      .select("id, producer_id, public_token, status, issued_at, printed_at")
      .eq("organization_id", orgId)
      .eq("producer_id", data.producerId)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw new Error(error.message);
    return { card: card ?? null };
  });

export const issueProducerCard = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { producerId: string }) =>
    z.object({ producerId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertProducerCardsEnabled(context.userId);
    if (!(await canManageProducerCards(context.userId, orgId, context.supabase))) {
      throw new Error("Accès refusé : votre compte ne peut pas créer de cartes producteurs.");
    }

    const { data: producer, error: producerError } = await supabaseAdmin
      .from("producers")
      .select("id, organization_id")
      .eq("id", data.producerId)
      .single();
    if (producerError || !producer || (producer as any).organization_id !== orgId) {
      throw new Error("Producteur introuvable dans votre organisation.");
    }

    const { data: existing } = await supabaseAdmin
      .from("producer_cards")
      .select("id, public_token, status, issued_at, printed_at")
      .eq("organization_id", orgId)
      .eq("producer_id", data.producerId)
      .eq("status", "active")
      .maybeSingle();
    if (existing) return { card: existing, reused: true as const };

    const publicToken = crypto.randomUUID().replaceAll("-", "") + crypto.randomUUID().replaceAll("-", "");
    const { data: card, error } = await supabaseAdmin
      .from("producer_cards")
      .insert({
        organization_id: orgId,
        producer_id: data.producerId,
        public_token: publicToken,
        status: "active",
        issued_by: context.userId,
      } as any)
      .select("id, producer_id, public_token, status, issued_at, printed_at")
      .single();
    if (error) throw new Error(error.message);
    return { card, reused: false as const };
  });

export const markProducerCardPrinted = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { cardId: string }) =>
    z.object({ cardId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertProducerCardsEnabled(context.userId);
    if (!(await canManageProducerCards(context.userId, orgId, context.supabase))) {
      throw new Error("Accès refusé : votre compte ne peut pas imprimer de cartes producteurs.");
    }
    const { error } = await supabaseAdmin
      .from("producer_cards")
      .update({ printed_at: new Date().toISOString() })
      .eq("id", data.cardId)
      .eq("organization_id", orgId);
    if (error) throw new Error(error.message);
    return { success: true as const };
  });

export const getPublicProducerCard = createServerFn({ method: "POST" })
  .inputValidator((d: { token: string }) =>
    z.object({ token: z.string().regex(/^[a-f0-9]{32,64}$/) }).parse(d),
  )
  .handler(async ({ data }) => {
    const { data: card, error } = await supabaseAdmin
      .from("producer_cards")
      .select("id, producer_id, organization_id, public_token, status, issued_at")
      .eq("public_token", data.token)
      .eq("status", "active")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!card) throw new Error("Carte producteur introuvable ou désactivée.");

    const { data: producer, error: producerError } = await supabaseAdmin
      .from("producers")
      .select("producer_code, full_name, village, commune, department, region, cooperative_id, photo_url")
      .eq("id", (card as any).producer_id)
      .eq("organization_id", (card as any).organization_id)
      .single();
    if (producerError || !producer) throw new Error("Profil producteur introuvable.");

    let cooperativeName: string | null = null;
    if ((producer as any).cooperative_id) {
      const { data: coop } = await supabaseAdmin
        .from("cooperatives")
        .select("name")
        .eq("id", (producer as any).cooperative_id)
        .eq("organization_id", (card as any).organization_id)
        .maybeSingle();
      cooperativeName = (coop as any)?.name ?? null;
    }

    const { data: parcels, error: parcelsError } = await supabaseAdmin
      .from("parcelles")
      .select("id, culture, surface_ha_calculated, surface_ha, lat, lng, boundary_points, species, varieties, planting_year, agroforestry, certification, estimated_yield_tonnes, compliance_status")
      .eq("producer_id", (card as any).producer_id)
      .eq("organization_id", (card as any).organization_id)
      .order("created_at", { ascending: false });
    if (parcelsError) throw new Error("Impossible de charger les parcelles publiques.");

    try {
      await supabaseAdmin.from("data_access_events").insert({
        producer_id: (card as any).producer_id,
        producer_organization_id: (card as any).organization_id,
        accessor_organization_id: null,
        accessor_user_id: null,
        event_type: "PROFILE_VIEW",
        access_scope: "PUBLIC",
        data_categories: ["identity", "cooperative", "location", "parcel_summary", "traceability"],
        source: "producer_card_qr",
        metadata: { card_id: (card as any).id, parcel_count: parcels?.length ?? 0 },
      } as any);
    } catch (e) {
      console.warn("producer card access event failed (non bloquant)", e);
    }

    return {
      parcels: (parcels ?? []).map((parcel: any) => ({
        id: parcel.id,
        culture: parcel.culture,
        surfaceHa: parcel.surface_ha_calculated ?? parcel.surface_ha ?? null,
        latitude: parcel.lat ?? null,
        longitude: parcel.lng ?? null,
        boundaryPoints: Array.isArray(parcel.boundary_points) ? parcel.boundary_points : [],
        species: parcel.species ?? [],
        varieties: parcel.varieties ?? [],
        plantingYear: parcel.planting_year ?? null,
        agroforestry: parcel.agroforestry ?? null,
        certification: parcel.certification ?? null,
        estimatedYieldTonnes: parcel.estimated_yield_tonnes ?? null,
        complianceStatus: parcel.compliance_status ?? null,
      })),
      producer: {
        producerCode: (producer as any).producer_code,
        photoUrl: (producer as any).photo_url ?? null,
        fullName: (producer as any).full_name,
        cooperativeName,
        village: (producer as any).village ?? null,
        commune: (producer as any).commune ?? null,
        department: (producer as any).department ?? null,
        region: (producer as any).region ?? null,
      },
      issuedAt: (card as any).issued_at,
    };
  });


export const uploadProducerCardPhoto = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { producerId: string; imageBase64: string; contentType: string }) =>
    z.object({
      producerId: z.string().uuid(),
      imageBase64: z.string().min(100).max(7_000_000),
      contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertProducerCardsEnabled(context.userId);
    if (!(await canManageProducerCards(context.userId, orgId, context.supabase))) {
      throw new Error("Accès refusé : seul un superviseur autorisé peut ajouter la photo.");
    }
    const { data: producer, error: producerError } = await supabaseAdmin
      .from("producers").select("id, organization_id")
      .eq("id", data.producerId).eq("organization_id", orgId).single();
    if (producerError || !producer) throw new Error("Producteur introuvable dans votre organisation.");

    const ext = data.contentType === "image/png" ? "png" : data.contentType === "image/webp" ? "webp" : "jpg";
    const path = orgId + "/" + data.producerId + "." + ext;
    const bytes = Uint8Array.from(atob(data.imageBase64), ch => ch.charCodeAt(0));
    const { error: uploadError } = await supabaseAdmin.storage.from("producer-photos").upload(path, bytes, {
      contentType: data.contentType, upsert: true, cacheControl: "3600",
    });
    if (uploadError) throw new Error("Téléversement de la photo impossible : " + uploadError.message);
    const { data: publicData } = supabaseAdmin.storage.from("producer-photos").getPublicUrl(path);
    const photoUrl = publicData.publicUrl + "?v=" + Date.now();
    const { error: updateError } = await supabaseAdmin.from("producers")
      .update({ photo_url: photoUrl } as any).eq("id", data.producerId).eq("organization_id", orgId);
    if (updateError) throw new Error("Photo envoyée, mais enregistrement impossible : " + updateError.message);
    return { photoUrl };
  });
