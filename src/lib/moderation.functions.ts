// ─────────────────────────────────────────────────────────────────────────
// MODERATION — Demandes de modification (superviseur → admin)
//
// Un superviseur ne peut pas modifier directement une donnée validée : il
// soumet une demande. L'admin peut l'approuver ou la rejeter. Si personne
// ne répond dans le délai défini par l'organisation (`organizations
// .modification_request_delay_hours`), la tâche planifiée pg_cron
// `sweep-modification-requests` l'approuve automatiquement (voir migration
// SQL — fonctions `apply_modification_request` / `sweep_expired_...`).
// Chaque décision est journalisée dans `audit_log`.
// ─────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

// ============================================================
// Soumettre une demande (superviseur)
// ============================================================

export const requestModification = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { documentId: string; fieldName: string; currentValue: unknown; proposedValue: unknown; reason: string }) =>
    z.object({
      documentId: z.string().uuid(),
      fieldName: z.string().min(1).max(120),
      currentValue: z.any(),
      proposedValue: z.any(),
      reason: z.string().min(3).max(500),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isSupervisor, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId, _role: "supervisor",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isSupervisor) throw new Error("Accès réservé aux superviseurs.");

    const { data: roleRow, error: orgErr } = await context.supabase
      .from("user_roles")
      .select("organization_id")
      .eq("user_id", context.userId)
      .eq("role", "supervisor")
      .limit(1)
      .maybeSingle();
    if (orgErr || !(roleRow as any)?.organization_id) throw new Error("Aucune organisation associée.");
    const orgId = (roleRow as any).organization_id as string;

    const { data: org, error: orgRowErr } = await supabaseAdmin
      .from("organizations")
      .select("modification_request_delay_hours")
      .eq("id", orgId)
      .single();
    if (orgRowErr || !org) throw new Error("Organisation introuvable.");
    const delayHours = (org as any).modification_request_delay_hours ?? 48;

    const expiresAt = new Date(Date.now() + delayHours * 3600_000).toISOString();

    const { data: inserted, error: insErr } = await supabaseAdmin
      .from("modification_requests")
      .insert({
        document_id: data.documentId,
        organization_id: orgId,
        requested_by: context.userId,
        field_name: data.fieldName,
        current_value: data.currentValue as any,
        proposed_value: data.proposedValue as any,
        reason: data.reason,
        expires_at: expiresAt,
      } as any)
      .select("id")
      .single();
    if (insErr) throw new Error(insErr.message);

    return { success: true, requestId: (inserted as any).id, expiresAt };
  });

// ============================================================
// Lister les demandes en attente (admin, sur son organisation)
// ============================================================

export const listPendingModificationRequests = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId, _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Accès réservé aux administrateurs.");

    const { data: roleRow, error: orgErr } = await context.supabase
      .from("user_roles")
      .select("organization_id")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();
    if (orgErr || !(roleRow as any)?.organization_id) throw new Error("Aucune organisation associée.");
    const orgId = (roleRow as any).organization_id as string;

    const { data: requests, error: reqErr } = await supabaseAdmin
      .from("modification_requests")
      .select("id, document_id, requested_by, field_name, current_value, proposed_value, reason, status, expires_at, created_at")
      .eq("organization_id", orgId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });
    if (reqErr) throw new Error(reqErr.message);

    const requesterIds = Array.from(new Set((requests ?? []).map((r: any) => r.requested_by)));
    const documentIds = Array.from(new Set((requests ?? []).map((r: any) => r.document_id)));

    const [{ data: profiles }, { data: docs }] = await Promise.all([
      requesterIds.length > 0
        ? supabaseAdmin.from("profiles").select("id, full_name").in("id", requesterIds)
        : Promise.resolve({ data: [] as any[] }),
      documentIds.length > 0
        ? supabaseAdmin.from("documents").select("id, title").in("id", documentIds)
        : Promise.resolve({ data: [] as any[] }),
    ]);

    const nameById = new Map((profiles ?? []).map((p: any) => [p.id, p.full_name]));
    const titleById = new Map((docs ?? []).map((d: any) => [d.id, d.title]));

    return {
      requests: (requests ?? []).map((r: any) => ({
        id: r.id,
        documentId: r.document_id,
        documentTitle: titleById.get(r.document_id) ?? "Document",
        requestedByName: nameById.get(r.requested_by) ?? "Superviseur",
        fieldName: r.field_name,
        currentValue: r.current_value,
        proposedValue: r.proposed_value,
        reason: r.reason,
        expiresAt: r.expires_at,
        createdAt: r.created_at,
      })),
    };
  });

// ============================================================
// Approuver ou rejeter une demande (admin)
// ============================================================

export const decideModificationRequest = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { requestId: string; decision: "approved" | "rejected" }) =>
    z.object({
      requestId: z.string().uuid(),
      decision: z.enum(["approved", "rejected"]),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId, _role: "admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isAdmin) throw new Error("Accès réservé aux administrateurs.");

    const { data: reqRow, error: reqErr } = await supabaseAdmin
      .from("modification_requests")
      .select("id, organization_id")
      .eq("id", data.requestId)
      .single();
    if (reqErr || !reqRow) throw new Error("Demande introuvable.");

    const { data: roleRow } = await context.supabase
      .from("user_roles")
      .select("organization_id")
      .eq("user_id", context.userId)
      .eq("role", "admin")
      .limit(1)
      .maybeSingle();
    if ((roleRow as any)?.organization_id !== (reqRow as any).organization_id) {
      throw new Error("Cette demande n'appartient pas à votre organisation.");
    }

    const { error: applyErr } = await supabaseAdmin.rpc("apply_modification_request", {
      _request_id: data.requestId,
      _decided_by: context.userId,
      _new_status: data.decision,
    } as any);
    if (applyErr) throw new Error(applyErr.message);

    return { success: true };
  });
