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

export const getProducerCardsFeatureStatus = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getCallerOrganizationId(context.userId);
    const { data, error } = await supabaseAdmin.from("organizations").select("enabled_features").eq("id", orgId).single();
    if (error) throw new Error(error.message);
    const enabled = (((data as any)?.enabled_features ?? []) as string[]).includes("producer_cards");
    let canCreate = false;
    try { await assertPermission(context.userId, "producers.cards.create", orgId); canCreate = true; } catch {}
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
    await assertPermission(context.userId, "producers.cards.create", orgId);

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
    await assertPermission(context.userId, "producers.cards.print", orgId);
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
      .select("producer_code, full_name, village, commune, department, region, cooperative_id")
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

    try {
      await supabaseAdmin.from("data_access_events").insert({
        producer_id: (card as any).producer_id,
        producer_organization_id: (card as any).organization_id,
        accessor_organization_id: null,
        accessor_user_id: null,
        event_type: "PROFILE_VIEW",
        access_scope: "PUBLIC",
        data_categories: ["identity", "cooperative", "location"],
        source: "producer_card_qr",
        metadata: { card_id: (card as any).id },
      } as any);
    } catch (e) {
      console.warn("producer card access event failed (non bloquant)", e);
    }

    return {
      producer: {
        producerCode: (producer as any).producer_code,
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
