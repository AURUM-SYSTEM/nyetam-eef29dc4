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
// organizations.type — distinct de module_type ("agro" vs "agriculture"),
// voir src/lib/organization-context.ts (même liste, dupliquée ici pour
// rester cohérent avec le style du reste de ce fichier).
const ORG_TYPES = ["agriculture", "health", "ngo", "generic"] as const;
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
// Créer une nouvelle organisation, avec son premier administrateur
// (invité par email) — action de "bootstrap" : l'appelant doit déjà être
// admin d'AU MOINS une organisation, mais l'action n'est pas restreinte à
// celle-ci puisqu'on en crée une nouvelle, indépendante. L'appelant n'est
// jamais ajouté comme admin de la nouvelle organisation — seul le nouvel
// administrateur invité l'est.
// ============================================================

export const createOrganizationWithAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    orgName: string;
    orgType: string;
    moduleType: string;
    adminEmail: string;
    adminFullName: string;
  }) =>
    z.object({
      orgName: z.string().min(1).max(200),
      orgType: z.enum(ORG_TYPES),
      moduleType: z.enum(MODULE_TYPES),
      adminEmail: z.string().email(),
      adminFullName: z.string().min(1).max(200),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    // Réservé aux administrateurs de plateforme (rôle global, non lié à une
    // organisation) — un admin d'organisation classique ne peut plus créer
    // de nouvelles organisations.
    const { data: isPlatformAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId,
      _role: "platform_admin",
    });
    if (roleErr) throw new Error("Vérification du rôle impossible : " + roleErr.message);
    if (!isPlatformAdmin) throw new Error("Seul un administrateur de plateforme peut créer une organisation.");

    const orgName = data.orgName.trim();

    const { data: org, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .insert({
        name: orgName,
        type: data.orgType,
        module_type: data.moduleType,
        enabled_modules: [data.moduleType],
      } as any)
      .select("id")
      .single();
    if (orgErr) throw new Error(orgErr.message);
    const newOrgId = (org as any).id as string;

    const appUrl = process.env.PUBLIC_APP_URL || "https://nyetam.lovable.app";
    const { data: invited, error: inviteErr } = await supabaseAdmin.auth.admin.inviteUserByEmail(
      data.adminEmail,
      {
        data: {
          full_name: data.adminFullName,
          organization_name: orgName,
          organization_type: data.orgType,
          module_type: data.moduleType,
        },
        redirectTo: `${appUrl}/accept-invite`,
      } as any,
    );
    if (inviteErr) {
      // L'organisation ne doit pas rester orpheline sans administrateur si
      // l'invitation échoue.
      await supabaseAdmin.from("organizations").delete().eq("id", newOrgId);
      throw new Error(inviteErr.message);
    }

    const newUserId = (invited as any)?.user?.id;
    if (!newUserId) {
      await supabaseAdmin.from("organizations").delete().eq("id", newOrgId);
      throw new Error("Invitation envoyée mais identifiant utilisateur introuvable.");
    }

    // Le trigger handle_new_user crée déjà le profil depuis les métadonnées
    // ci-dessus ; on complète juste organization_id, comme pour inviteAgent.
    await supabaseAdmin.from("profiles").update({ organization_id: newOrgId }).eq("id", newUserId);

    // Uniquement le nouvel administrateur invité — jamais l'appelant.
    const { error: newAdminRoleErr } = await supabaseAdmin.from("user_roles").insert({
      user_id: newUserId,
      organization_id: newOrgId,
      role: "admin",
    } as any);
    if (newAdminRoleErr) throw new Error(newAdminRoleErr.message);

    try {
      await supabaseAdmin.from("audit_log").insert({
        organization_id: newOrgId,
        actor_id: context.userId,
        action: "creation",
        entity_type: "organization",
        entity_id: newOrgId,
        new_value: {
          name: orgName,
          type: data.orgType,
          module_type: data.moduleType,
          admin_email: data.adminEmail,
        } as any,
      } as any);
    } catch (e) {
      console.warn("audit_log organization creation failed (non bloquant)", e);
    }

    return {
      success: true as const,
      organizationId: newOrgId,
      orgName,
      adminEmail: data.adminEmail,
    };
  });

// ============================================================
// Statut "administrateur de plateforme" (pour affichage conditionnel côté UI)
// ============================================================

export const checkPlatformAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isPlatformAdmin, error } = await context.supabase.rpc("has_role", {
      _user: context.userId,
      _role: "platform_admin",
    });
    if (error) throw new Error("Vérification du rôle impossible : " + error.message);
    return { isPlatformAdmin: Boolean(isPlatformAdmin) };
  });

// ============================================================
// Centre de contrôle AURUM — administrateurs des organisations
// Réservé au Super Administrateur AURUM (platform_admin).
// ============================================================

export const listOrganizationAdmins = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isPlatformAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId,
      _role: "platform_admin",
    });
    if (roleErr) throw new Error("Vérification du rôle impossible : " + roleErr.message);
    if (!isPlatformAdmin) throw new Error("Seul le Super Administrateur AURUM peut gérer les administrateurs.");

    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("id, email, full_name, organization_id")
      .not("organization_id", "is", null)
      .order("full_name", { ascending: true });
    if (profErr) throw new Error(profErr.message);

    const { data: roles, error: rolesErr } = await supabaseAdmin
      .from("user_roles")
      .select("user_id, organization_id, role")
      .eq("role", "admin");
    if (rolesErr) throw new Error(rolesErr.message);

    const adminIds = new Set((roles ?? []).map((r: any) => r.user_id));
    const orgIds = Array.from(new Set((profiles ?? []).map((p: any) => p.organization_id).filter(Boolean)));
    const { data: orgs, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .select("id, name")
      .in("id", orgIds);
    if (orgErr) throw new Error(orgErr.message);
    const orgNames = new Map((orgs ?? []).map((o: any) => [o.id, o.name]));
    return {
      users: (profiles ?? []).map((p: any) => ({
        id: p.id,
        email: p.email ?? "",
        fullName: p.full_name ?? "(sans nom)",
        organizationId: p.organization_id,
        organizationName: orgNames.get(p.organization_id) ?? "Organisation",
        isAdmin: adminIds.has(p.id),
      })),
    };
  });

export const updateOrganizationAdmin = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; makeAdmin: boolean }) =>
    z.object({
      userId: z.string().uuid(),
      makeAdmin: z.boolean(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isPlatformAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId,
      _role: "platform_admin",
    });
    if (roleErr) throw new Error("Vérification du rôle impossible : " + roleErr.message);
    if (!isPlatformAdmin) throw new Error("Seul le Super Administrateur AURUM peut modifier les administrateurs.");

    if (data.userId === context.userId && !data.makeAdmin) {
      throw new Error("Votre compte Super Administrateur AURUM ne peut pas être retiré ici.");
    }

    const { data: target, error: targetErr } = await supabaseAdmin
      .from("profiles")
      .select("id, organization_id")
      .eq("id", data.userId)
      .single();
    if (targetErr || !target || !(target as any).organization_id) {
      throw new Error("Utilisateur ou organisation introuvable.");
    }

    if (data.makeAdmin) {
      const { error } = await supabaseAdmin.from("user_roles").upsert({
        user_id: data.userId,
        organization_id: (target as any).organization_id,
        role: "admin",
      } as any, { onConflict: "user_id,organization_id,role" });
      if (error) throw new Error(error.message);
    } else {
      const { count, error: countErr } = await supabaseAdmin
        .from("user_roles")
        .select("user_id", { count: "exact", head: true })
        .eq("organization_id", (target as any).organization_id)
        .eq("role", "admin");
      if (countErr) throw new Error(countErr.message);
      if ((count ?? 0) <= 1) {
        throw new Error("Impossible de retirer le dernier administrateur de l'organisation.");
      }
      const { error } = await supabaseAdmin
        .from("user_roles")
        .delete()
        .eq("user_id", data.userId)
        .eq("organization_id", (target as any).organization_id)
        .eq("role", "admin");
      if (error) throw new Error(error.message);
    }

    return { success: true as const };
  });

// ============================================================
// RÔLES & PERMISSIONS — centre de contrôle
// ============================================================

export const listRoleDefinitions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isPlatformAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId, _role: "platform_admin",
    });
    if (roleErr) throw new Error(roleErr.message);

    let orgId: string | null = null;
    if (!isPlatformAdmin) orgId = await assertAdminAndGetOrg(context.supabase, context.userId);

    let query = supabaseAdmin.from("role_definitions")
      .select("id, organization_id, code, name, description, is_system")
      .order("is_system", { ascending: false }).order("name", { ascending: true });
    if (orgId) query = query.or(`organization_id.is.null,organization_id.eq.${orgId}`);
    const { data: roles, error } = await query;
    if (error) throw new Error(error.message);

    const ids = (roles ?? []).map((r: any) => r.id);
    const { data: permissions, error: pErr } = ids.length
      ? await supabaseAdmin.from("role_permissions").select("role_id, permission").in("role_id", ids)
      : { data: [], error: null };
    if (pErr) throw new Error(pErr.message);

    const byRole = new Map<string, string[]>();
    for (const p of (permissions ?? []) as any[]) {
      byRole.set(p.role_id, [...(byRole.get(p.role_id) ?? []), p.permission]);
    }
    return { roles: (roles ?? []).map((r: any) => ({ ...r, permissions: byRole.get(r.id) ?? [] })) };
  });

export const listPermissionCatalog = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isPlatformAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId, _role: "platform_admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isPlatformAdmin) await assertAdminAndGetOrg(context.supabase, context.userId);
    const { data, error } = await supabaseAdmin.from("permission_catalog")
      .select("permission, label, module, description")
      .order("module").order("label");
    if (error) throw new Error(error.message);
    return { permissions: data ?? [] };
  });

export const createOrganizationRole = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { name: string; code: string; description?: string; permissions: string[] }) =>
    z.object({
      name: z.string().min(2).max(100),
      code: z.string().regex(/^[a-z0-9_-]{2,60}$/),
      description: z.string().max(500).optional(),
      permissions: z.array(z.string()).max(100),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isPlatformAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId, _role: "platform_admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    const orgId = isPlatformAdmin ? null : await assertAdminAndGetOrg(context.supabase, context.userId);
    if (orgId === null && !isPlatformAdmin) throw new Error("Accès refusé.");

    const { data: role, error } = await supabaseAdmin.from("role_definitions").insert({
      organization_id: orgId,
      code: data.code,
      name: data.name,
      description: data.description ?? "",
      is_system: false,
    }).select("id, organization_id, code, name, description, is_system").single();
    if (error) throw new Error(error.message);

    if (data.permissions.length) {
      const { data: allowed } = await supabaseAdmin.from("permission_catalog")
        .select("permission").in("permission", data.permissions);
      const allowedSet = new Set((allowed ?? []).map((p: any) => p.permission));
      const rows = data.permissions.filter(p => allowedSet.has(p)).map(permission => ({ role_id: role.id, permission }));
      if (rows.length) {
        const { error: pErr } = await supabaseAdmin.from("role_permissions").insert(rows);
        if (pErr) throw new Error(pErr.message);
      }
    }
    return { success: true as const, role };
  });

export const updateOrganizationRolePermissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { roleId: string; permissions: string[] }) =>
    z.object({ roleId: z.string().uuid(), permissions: z.array(z.string()).max(100) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isPlatformAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId, _role: "platform_admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    const orgId = isPlatformAdmin ? null : await assertAdminAndGetOrg(context.supabase, context.userId);

    const { data: role, error } = await supabaseAdmin.from("role_definitions")
      .select("id, organization_id, is_system").eq("id", data.roleId).single();
    if (error || !role) throw new Error("Rôle introuvable.");
    if (role.is_system && !isPlatformAdmin) throw new Error("Seul le Super Administrateur peut modifier un rôle système.");
    if (!isPlatformAdmin && role.organization_id !== orgId) throw new Error("Ce rôle appartient à une autre organisation.");

    const { data: allowed } = await supabaseAdmin.from("permission_catalog")
      .select("permission").in("permission", data.permissions);
    const allowedSet = new Set((allowed ?? []).map((p: any) => p.permission));
    const safePermissions = data.permissions.filter(p => allowedSet.has(p));

    const { error: delErr } = await supabaseAdmin.from("role_permissions").delete().eq("role_id", data.roleId);
    if (delErr) throw new Error(delErr.message);
    if (safePermissions.length) {
      const { error: insErr } = await supabaseAdmin.from("role_permissions")
        .insert(safePermissions.map(permission => ({ role_id: data.roleId, permission })));
      if (insErr) throw new Error(insErr.message);
    }
    return { success: true as const };
  });

export const assignRoleToOrganizationUser = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { userId: string; roleCode: string }) =>
    z.object({ userId: z.string().uuid(), roleCode: z.string().min(2).max(60) }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isPlatformAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId, _role: "platform_admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    const orgId = isPlatformAdmin ? null : await assertAdminAndGetOrg(context.supabase, context.userId);

    const { data: target } = await supabaseAdmin.from("profiles").select("id, organization_id").eq("id", data.userId).single();
    if (!target) throw new Error("Utilisateur introuvable.");
    if (!isPlatformAdmin && target.organization_id !== orgId) throw new Error("Utilisateur hors de votre organisation.");

    const roleQuery = supabaseAdmin.from("role_definitions").select("id, organization_id, code").eq("code", data.roleCode);
    const { data: role, error: roleErr2 } = isPlatformAdmin
      ? await roleQuery.is("organization_id", null).single()
      : await roleQuery.or(`organization_id.is.null,organization_id.eq.${orgId}`).order("organization_id", { ascending: true, nullsFirst: true }).limit(1).maybeSingle();
    if (roleErr2 || !role) throw new Error("Rôle introuvable.");
    if (!isPlatformAdmin && role.organization_id !== null && role.organization_id !== orgId) throw new Error("Rôle hors organisation.");

    if (!isPlatformAdmin && data.userId === context.userId && role.code !== "admin") {
      const { count, error: cntErr } = await supabaseAdmin
        .from("user_roles").select("user_id", { count: "exact", head: true })
        .eq("organization_id", orgId).eq("role", "admin").neq("user_id", context.userId);
      if (cntErr) throw new Error(cntErr.message);
      if ((count ?? 0) === 0) throw new Error("Impossible de retirer votre propre rôle administrateur : nommez d'abord un autre administrateur.");
    }

    if (!isPlatformAdmin && role.code !== "admin") {
      const { data: current } = await supabaseAdmin.from("user_roles")
        .select("role").eq("user_id", data.userId).eq("organization_id", orgId).limit(1).maybeSingle();
      if (current?.role === "admin") {
        const { count } = await supabaseAdmin.from("user_roles")
          .select("user_id", { count: "exact", head: true })
          .eq("organization_id", orgId).eq("role", "admin");
        if ((count ?? 0) <= 1) throw new Error("Impossible de retirer le dernier administrateur de l'organisation.");
      }
    }

    const { error } = await supabaseAdmin.from("user_roles").upsert({
      user_id: data.userId, organization_id: target.organization_id, role: role.code,
    } as any, { onConflict: "user_id,organization_id,role" });
    if (error) throw new Error(error.message);
    return { success: true as const };
  });

// ============================================================
// Liste de toutes les organisations (réservé platform_admin)
// ============================================================

export const listAllOrganizations = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data: isPlatformAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId,
      _role: "platform_admin",
    });
    if (roleErr) throw new Error("Vérification du rôle impossible : " + roleErr.message);
    if (!isPlatformAdmin) throw new Error("Seul un administrateur de plateforme peut consulter la liste des organisations.");

    const { data: orgs, error: orgsErr } = await supabaseAdmin
      .from("organizations")
      .select("id, name, type, module_type, enabled_modules, enabled_compliance_modules, enabled_features, created_at")
      .order("created_at", { ascending: false });
    if (orgsErr) throw new Error(orgsErr.message);

    const { data: profiles, error: profErr } = await supabaseAdmin
      .from("profiles")
      .select("organization_id");
    if (profErr) throw new Error(profErr.message);

    const userCounts = new Map<string, number>();
    for (const p of (profiles ?? []) as Array<{ organization_id: string | null }>) {
      if (!p.organization_id) continue;
      userCounts.set(p.organization_id, (userCounts.get(p.organization_id) ?? 0) + 1);
    }

    return {
      organizations: ((orgs ?? []) as Array<{
        id: string;
        name: string;
        type: string;
        module_type: string;
        enabled_modules: string[] | null;
        enabled_compliance_modules: string[] | null;
        enabled_features: string[] | null;
        created_at: string;
      }>).map((o) => ({
        id: o.id,
        name: o.name,
        type: o.type,
        moduleType: o.module_type,
        enabledModules: (o.enabled_modules ?? [o.module_type]) as string[],
        enabledComplianceModules: (o.enabled_compliance_modules ?? []) as string[],
        enabledFeatures: (o.enabled_features ?? []) as string[],
        createdAt: o.created_at,
        userCount: userCounts.get(o.id) ?? 0,
      })),
    };
  });

// ============================================================
// Modules d'une organisation — réservé au Super Administrateur AURUM
// ============================================================

export const updateOrganizationModules = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { organizationId: string; enabledModules: string[]; enabledComplianceModules?: string[] }) =>
    z.object({
      organizationId: z.string().uuid(),
      enabledModules: z.array(z.enum(MODULE_TYPES)).min(1, "Au moins un module doit rester activé."),
      enabledComplianceModules: z.array(z.enum(COMPLIANCE_MODULES)).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isPlatformAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId, _role: "platform_admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isPlatformAdmin) throw new Error("Seul le Super Administrateur AURUM peut modifier les modules d'une organisation.");

    const modules = Array.from(new Set(data.enabledModules));
    const patch: Record<string, unknown> = { enabled_modules: modules };
    if (data.enabledComplianceModules !== undefined) {
      patch.enabled_compliance_modules = Array.from(new Set(data.enabledComplianceModules));
    }
    const { error } = await supabaseAdmin
      .from("organizations")
      .update(patch as any)
      .eq("id", data.organizationId);
    if (error) throw new Error(error.message);

    return {
      success: true as const,
      enabledModules: modules,
      enabledComplianceModules: data.enabledComplianceModules ?? [],
    };
  });

// ============================================================
// Fonctionnalités optionnelles — pilotées uniquement par platform_admin
// ============================================================

const OPTIONAL_FEATURES = ["reports", "commissions", "producer_cards"] as const;

export const updateOrganizationFeatures = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { organizationId: string; enabledFeatures: string[] }) =>
    z.object({
      organizationId: z.string().uuid(),
      enabledFeatures: z.array(z.enum(OPTIONAL_FEATURES)),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isPlatformAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId, _role: "platform_admin",
    });
    if (roleErr) throw new Error(roleErr.message);
    if (!isPlatformAdmin) throw new Error("Seul le Super Administrateur AURUM peut activer les fonctionnalités.");
    const features = Array.from(new Set(data.enabledFeatures));
    const { error } = await supabaseAdmin.from("organizations")
      .update({ enabled_features: features } as any).eq("id", data.organizationId);
    if (error) throw new Error(error.message);
    return { success: true as const, enabledFeatures: features };
  });

// ============================================================
// Supprimer une organisation (réservé platform_admin)
//
// Le comportement réel de ON DELETE CASCADE sur les clés étrangères
// organization_id n'a pas pu être vérifié directement dans ce contexte
// (aucun accès d'introspection au schéma en production). Par prudence, on
// refuse donc explicitement la suppression tant que des données actives
// (utilisateurs, parcelles, producteurs, etc.) sont encore rattachées à
// l'organisation, plutôt que de compter sur un cascade non confirmé.
// audit_log est volontairement exclu de cette vérification : organization_id
// y est nullable, il s'agit de données historiques non "vivantes", et
// chaque organisation y a toujours au moins une entrée (sa propre création),
// ce qui rendrait toute suppression impossible si on l'incluait.
// ============================================================

const ORG_DEPENDENCY_TABLES: Array<{ table: string; label: string }> = [
  { table: "profiles", label: "utilisateur(s)" },
  { table: "user_roles", label: "rôle(s) attribué(s)" },
  { table: "parcelles", label: "parcelle(s)" },
  { table: "cooperatives", label: "coopérative(s)" },
  { table: "producers", label: "producteur(s)" },
  { table: "mission_forms", label: "formulaire(s) de mission personnalisé(s)" },
  { table: "duplicate_alerts", label: "alerte(s) de doublon" },
  { table: "agro_advisor_reports", label: "rapport(s) Agro Advisor" },
  { table: "modification_requests", label: "demande(s) de modification" },
];

export const deleteOrganization = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { organizationId: string }) =>
    z.object({ organizationId: z.string().uuid() }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const { data: isPlatformAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId,
      _role: "platform_admin",
    });
    if (roleErr) throw new Error("Vérification du rôle impossible : " + roleErr.message);
    if (!isPlatformAdmin) throw new Error("Seul un administrateur de plateforme peut supprimer une organisation.");

    const { data: org, error: orgErr } = await supabaseAdmin
      .from("organizations")
      .select("id, name")
      .eq("id", data.organizationId)
      .single();
    if (orgErr || !org) throw new Error("Organisation introuvable.");
    const orgName = (org as any).name as string;

    const blocking: string[] = [];
    for (const dep of ORG_DEPENDENCY_TABLES) {
      const { count, error } = await supabaseAdmin
        .from(dep.table as any)
        .select("id", { count: "exact", head: true })
        .eq("organization_id", data.organizationId);
      if (error) throw new Error(error.message);
      if ((count ?? 0) > 0) blocking.push(`${count} ${dep.label}`);
    }
    if (blocking.length > 0) {
      throw new Error(
        `Impossible de supprimer « ${orgName} » : elle contient encore ${blocking.join(", ")}. Retirez-les d'abord.`,
      );
    }

    const { error: delErr } = await supabaseAdmin.from("organizations").delete().eq("id", data.organizationId);
    if (delErr) throw new Error(delErr.message);

    try {
      await supabaseAdmin.from("audit_log").insert({
        organization_id: null,
        actor_id: context.userId,
        action: "deletion",
        entity_type: "organization",
        entity_id: data.organizationId,
        old_value: { name: orgName } as any,
      } as any);
    } catch (e) {
      console.warn("audit_log organization deletion failed (non bloquant)", e);
    }

    return { success: true as const, organizationName: orgName };
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
    const { data: isPlatformAdmin, error: roleErr } = await context.supabase.rpc("has_role", {
      _user: context.userId,
      _role: "platform_admin",
    });
    if (roleErr) throw new Error("Vérification du rôle impossible : " + roleErr.message);

    const orgId = await assertAdminAndGetOrg(context.supabase, context.userId);
    const patch: Record<string, unknown> = {};

    if (data.name !== undefined) patch.name = data.name.trim();
    if (data.modificationRequestDelayHours !== undefined) {
      patch.modification_request_delay_hours = data.modificationRequestDelayHours;
    }

    // L'activation/désactivation des modules et extensions est centralisée :
    // seul le Super Administrateur AURUM la pilote depuis le centre de contrôle.
    if (data.enabledModules !== undefined || data.enabledComplianceModules !== undefined) {
      if (!isPlatformAdmin) {
        throw new Error("Seul le Super Administrateur AURUM peut activer ou désactiver les modules.");
      }
      if (data.enabledModules !== undefined) {
        patch.enabled_modules = Array.from(new Set(data.enabledModules));
      }
      if (data.enabledComplianceModules !== undefined) {
        patch.enabled_compliance_modules = Array.from(new Set(data.enabledComplianceModules));
      }
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


// ============================================================
// COMMISSIONS — transparence coopérative et saisie manuelle
// Le prix payé par l'acheteur reste interne à AURUM.
// La commission due à la coopérative est explicitement visible.
// ============================================================

async function getCallerOrgId(context: any): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("profiles").select("organization_id").eq("id", context.userId).single();
  if (error || !(data as any)?.organization_id) throw new Error("Aucune organisation associée à ce compte.");
  return (data as any).organization_id as string;
}

export const listCooperativeCommissions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const orgId = await getCallerOrgId(context);

    const { data, error } = await supabaseAdmin
      .from("commercial_commission_ledger")
      .select("id, producer_id, data_access_event_id, commission_amount, currency, status, accrued_at, paid_at, payout_reference, payment_note, manual_entry")
      .eq("organization_id", orgId)
      .order("accrued_at", { ascending: false });
    if (error) throw new Error(error.message);

    const producerIds = Array.from(new Set((data ?? []).map((r: any) => r.producer_id).filter(Boolean)));
    const { data: producers } = producerIds.length
      ? await supabaseAdmin.from("producers").select("id, full_name").in("id", producerIds)
      : { data: [] };
    const names = new Map((producers ?? []).map((p: any) => [p.id, p.full_name]));

    return {
      commissions: (data ?? []).map((r: any) => ({
        ...r,
        producerName: names.get(r.producer_id) ?? "Producteur",
      })),
    };
  });

export const createManualCommission = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: {
    organizationId: string;
    producerId: string;
    amount: number;
    currency?: string;
    dataAccessEventId?: string;
    note?: string;
  }) => z.object({
    organizationId: z.string().uuid(),
    producerId: z.string().uuid(),
    amount: z.number().nonnegative(),
    currency: z.string().length(3).default("XAF"),
    dataAccessEventId: z.string().uuid().optional(),
    note: z.string().max(1000).optional(),
  }).parse(d))
  .handler(async ({ data, context }) => {
    const isPlatformAdmin = Boolean((await context.supabase.rpc("has_role", {
      _user: context.userId, _role: "platform_admin",
    })).data);
    const callerOrgId = isPlatformAdmin ? null : await assertAdminAndGetOrg(context.supabase, context.userId);
    if (!isPlatformAdmin && callerOrgId !== data.organizationId) {
      throw new Error("Vous ne pouvez créer une commission que pour votre organisation.");
    }

    const { data: producer } = await supabaseAdmin
      .from("producers").select("id, organization_id").eq("id", data.producerId).single();
    if (!producer || (producer as any).organization_id !== data.organizationId) {
      throw new Error("Le producteur n'appartient pas à l'organisation bénéficiaire.");
    }

    const { data: row, error } = await supabaseAdmin
      .from("commercial_commission_ledger")
      .insert({
        organization_id: data.organizationId,
        producer_id: data.producerId,
        data_access_event_id: data.dataAccessEventId ?? null,
        commission_amount: data.amount,
        currency: data.currency,
        status: "accrued",
        manual_entry: true,
        created_by: context.userId,
        payment_note: data.note ?? null,
      } as any)
      .select("id, commission_amount, currency, status, accrued_at")
      .single();
    if (error) throw new Error(error.message);
    return { success: true as const, commission: row };
  });

export const markCommissionPaid = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((d: { commissionId: string; payoutReference?: string; paymentNote?: string }) =>
    z.object({
      commissionId: z.string().uuid(),
      payoutReference: z.string().max(200).optional(),
      paymentNote: z.string().max(1000).optional(),
    }).parse(d),
  )
  .handler(async ({ data, context }) => {
    const orgId = await assertAdminAndGetOrg(context.supabase, context.userId);
    const { data: row, error: findErr } = await supabaseAdmin
      .from("commercial_commission_ledger")
      .select("id, organization_id, status")
      .eq("id", data.commissionId).single();
    if (findErr || !row) throw new Error("Commission introuvable.");
    if ((row as any).organization_id !== orgId) throw new Error("Commission hors de votre organisation.");
    if ((row as any).status === "cancelled") throw new Error("Une commission annulée ne peut pas être versée.");

    const { error } = await supabaseAdmin
      .from("commercial_commission_ledger")
      .update({
        status: "paid",
        paid_at: new Date().toISOString(),
        payout_reference: data.payoutReference ?? null,
        payment_note: data.paymentNote ?? null,
        updated_at: new Date().toISOString(),
      } as any)
      .eq("id", data.commissionId);
    if (error) throw new Error(error.message);
    return { success: true as const };
  });
