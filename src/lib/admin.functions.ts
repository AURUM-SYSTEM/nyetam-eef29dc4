// ─────────────────────────────────────────────────────────────────────────
// ADMIN — Gestion des utilisateurs (invitation, affectation module/rôle)
//
// Toute action ici revérifie côté serveur que l'appelant a bien le rôle
// `admin` sur son organisation avant d'utiliser le client `supabaseAdmin`
// (service role, qui contourne les RLS). Aucune requête privilégiée n'est
// jamais exécutée sans cette vérification préalable.
// ─────────────────────────────────────────────────────────────────────────
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { supabaseAdmin } from "@/integrations/supabase/client.server";

const MODULE_TYPES = ["agro", "health", "ngo", "generic"] as const;
const APP_ROLES = ["agent", "supervisor", "admin"] as const;
// Modules de conformité — extensions optionnelles d'un module métier (EUDR
// est une extension d'agro), jamais un module à part entière.
const COMPLIANCE_MODULES = ["eudr"] as const;
type ModuleTypeStr = (typeof MODULE_TYPES)[number];

async function assertAdminAndGetOrg(supabase: any, userId: string): Promise<string> {
  const { data: isAdmin, error } = await supabase.rpc("has_role", { _user: userId, _role: "admin" });
  if (error) throw new Error("Vérification du rôle impossible : " + error.message);
  if (!isAdmin) throw new Error("Accès réservé aux administrateurs.");

  const { data: roleRow, error: roleErr } = await supabase
    .from("user_roles")
    .select("organization_id")
    .eq("user_id", userId)
    .eq("role", "admin")
    .limit(1)
    .maybeSingle();
  if (roleErr || !roleRow?.organization_id) {
    throw new Error("Aucune organisation associée à ce compte administrateur.");
  }
  return roleRow.organization_id as string;
}

// ============================================================
// Liste des utilisateurs de l'organisation
// ============================================================

export const listOrgUsers = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await assertAdminAndGetOrg(context.supabase, context.userId);

    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name, module_type, organization_id")
      .eq("organization_id", orgId)
      .order("full_name", { ascending: true });
    if (profErr) throw new Error(profErr.message);

    const { data: roles, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, role")
      .eq("organization_id", orgId);
    if (rolesErr) throw new Error(rolesErr.message);

    const rolesByUser = new Map<string, string[]>();
    for (const r of (roles ?? []) as Array<{ user_id: string; role: string }>) {
      const list = rolesByUser.get(r.user_id) ?? [];
      list.push(r.role);
      rolesByUser.set(r.user_id, list);
    }

    return {
      organizationId: orgId,
      users: ((profiles ?? []) as Array<{ id: string; email: string | null; full_name: string | null; module_type: string | null }>).map((p) => ({
        id: p.id,
        email: p.email ?? "",
        fullName: p.full_name || "(sans nom)",
        moduleType: (p.module_type as ModuleTypeStr) ?? "generic",
        roles: rolesByUser.get(p.id) ?? [],
      })),
    };
  });

// ============================================================
// Inviter un nouvel agent (email d'invitation Supabase)
// ============================================================

export const inviteAgent = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { email: string; fullName: string; moduleType: string; role: string }) =>
    z.object({
      email: z.string().email(),
      fullName: z.string().min(1).max(200),
      moduleType: z.enum(MODULE_TYPES),
      role: z.enum(APP_ROLES),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertAdminAndGetOrg(context.supabase, context.userId);

    const { data: org, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .select("name, type")
      .eq("id", orgId)
      .single();
    if (orgErr || !org) throw new Error("Organisation introuvable.");

    const appUrl = process.env.PUBLIC_APP_URL || "https://nyetam.lovable.app";

    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      data.email,
      {
        data: {
          full_name: data.fullName,
          organization_name: (org as any).name,
          organization_type: (org as any).type,
          module_type: data.moduleType,
        },
        redirectTo: `${appUrl}/accept-invite`,
      } as any,
    );
    if (inviteErr) throw new Error(inviteErr.message);

    const newUserId = (invited as any)?.user?.id;
    if (!newUserId) throw new Error("Invitation envoyée mais identifiant utilisateur introuvable.");

    // Le trigger handle_new_user crée déjà le profil depuis les métadonnées
    // ci-dessus ; on complète juste organization_id (colonne ajoutée après coup).
    await supabaseAdmin.from("profiles").update({ organization_id: orgId }).eq("id", newUserId);

    const { error: roleErr } = await supabaseAdmin.from("user_roles").insert({
      user_id: newUserId,
      organization_id: orgId,
      role: data.role,
    } as any);
    if (roleErr) throw new Error(roleErr.message);

    return { success: true, userId: newUserId, email: data.email };
  });

// ============================================================
// Paramètres de l'organisation (nom, modules activés, délai
// d'auto-approbation des demandes de modification)
// ============================================================

export const getOrgSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await assertAdminAndGetOrg(context.supabase, context.userId);

    const { data: org, error } = await supabaseAdmin
      .from("organizations")
      .select("id, name, enabled_modules, enabled_compliance_modules, modification_request_delay_hours")
      .eq("id", orgId)
      .single();
    if (error || !org) throw new Error("Organisation introuvable.");

    return {
      id: (org as any).id as string,
      name: ((org as any).name ?? "") as string,
      enabled_modules: (((org as any).enabled_modules ?? [...MODULE_TYPES]) as string[]),
      enabled_compliance_modules: (((org as any).enabled_compliance_modules ?? []) as string[]),
      modification_request_delay_hours: (org as any).modification_request_delay_hours as number,
    };
  });

export const updateOrgSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    name?: string;
    enabledModules?: string[];
    enabledComplianceModules?: string[];
    modificationRequestDelayHours?: number;
  }) =>
    z.object({
      name: z.string().min(1).max(200).optional(),
      enabledModules: z
        .array(z.enum(MODULE_TYPES))
        .min(1, "Au moins un module doit rester activé.")
        .optional(),
      enabledComplianceModules: z.array(z.enum(COMPLIANCE_MODULES)).optional(),
      modificationRequestDelayHours: z.number().int().min(1).max(720).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertAdminAndGetOrg(context.supabase, context.userId);

    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.enabledModules !== undefined) patch.enabled_modules = Array.from(new Set(data.enabledModules));
    if (data.enabledComplianceModules !== undefined) {
      patch.enabled_compliance_modules = Array.from(new Set(data.enabledComplianceModules));
    }
    if (data.modificationRequestDelayHours !== undefined) {
      patch.modification_request_delay_hours = data.modificationRequestDelayHours;
    }
    if (Object.keys(patch).length === 0) return { success: true };

    const { error } = await supabaseAdmin.from("organizations").update(patch as any).eq("id", orgId);
    if (error) throw new Error(error.message);

    return { success: true };
  });

// ============================================================
// Modifier le module et/ou le rôle d'un agent existant
// ============================================================

export const updateAgentAssignment = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; moduleType?: string; role?: string }) =>
    z.object({
      userId: z.string().uuid(),
      moduleType: z.enum(MODULE_TYPES).optional(),
      role: z.enum(APP_ROLES).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertAdminAndGetOrg(context.supabase, context.userId);

    const { data: target, error: targetErr } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id")
      .eq("id", data.userId)
      .single();
    if (targetErr || !target || (target as any).organization_id !== orgId) {
      throw new Error("Utilisateur introuvable dans votre organisation.");
    }

    if (data.moduleType) {
      await supabaseAdmin.from("profiles").update({ module_type: data.moduleType }).eq("id", data.userId);
    }

    if (data.role) {
      // Garde-fou : un admin ne peut pas retirer son propre rôle admin s'il
      // est le dernier admin de l'organisation (sinon plus personne ne peut
      // administrer — incident déjà survenu).
      if (data.userId === context.userId && data.role !== "admin") {
        const { count, error: cntErr } = await supabaseAdmin
          .from("user_roles")
          .select("user_id", { count: "exact", head: true })
          .eq("organization_id", orgId)
          .eq("role", "admin")
          .neq("user_id", context.userId);
        if (cntErr) throw new Error(cntErr.message);
        if ((count ?? 0) === 0) {
          throw new Error("Impossible de retirer votre propre rôle administrateur : vous êtes le seul admin de l'organisation. Nommez d'abord un autre admin.");
        }
      }

      await supabaseAdmin.from("user_roles").delete().eq("user_id", data.userId).eq("organization_id", orgId);
      await supabaseAdmin.from("user_roles").insert({
        user_id: data.userId,
        organization_id: orgId,
        role: data.role,
      } as any);
    }

    return { success: true };
  });
