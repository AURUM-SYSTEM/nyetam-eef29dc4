import { supabaseAdmin } from "@/integrations/supabase/client.server";

export async function getCallerOrganizationId(userId: string): Promise<string> {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("organization_id")
    .eq("id", userId)
    .single();
  const orgId = (data as any)?.organization_id as string | null;
  if (error || !orgId) throw new Error("Aucune organisation associée à ce compte.");
  return orgId;
}

/**
 * Central authorization check.
 * A user may receive a system role (organization_id IS NULL) or an
 * organization-specific custom role. The permission is granted when any
 * role assigned to the user in the current organization contains it.
 */
export async function assertPermission(
  userId: string,
  permission: string,
  organizationId?: string,
): Promise<string> {
  const orgId = organizationId ?? await getCallerOrganizationId(userId);

  const { data: assignments, error: assignmentError } = await supabaseAdmin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .eq("organization_id", orgId);

  if (assignmentError) throw new Error("Vérification des permissions impossible : " + assignmentError.message);

  const roleCodes = Array.from(new Set(
    ((assignments ?? []) as Array<{ role: string }>).map(r => r.role).filter(Boolean),
  ));
  if (roleCodes.length === 0) {
    throw new Error("Accès refusé : aucun rôle actif pour ce compte.");
  }

  const { data: roles, error: roleError } = await supabaseAdmin
    .from("role_definitions")
    .select("id, code, organization_id")
    .in("code", roleCodes);

  if (roleError) throw new Error("Lecture des rôles impossible : " + roleError.message);

  const roleIds = ((roles ?? []) as Array<{ id: string; code: string; organization_id: string | null }>)
    .filter(r => r.organization_id === null || r.organization_id === orgId)
    .map(r => r.id);

  if (roleIds.length === 0) {
    throw new Error("Accès refusé : rôle non reconnu.");
  }

  const { data: granted, error: permissionError } = await supabaseAdmin
    .from("role_permissions")
    .select("permission")
    .in("role_id", roleIds)
    .eq("permission", permission)
    .limit(1);

  if (permissionError) throw new Error("Lecture des permissions impossible : " + permissionError.message);
  if (!granted?.length) {
    throw new Error("Accès refusé : permission « " + permission + " » requise.");
  }

  return orgId;
}

export async function hasPermission(
  userId: string,
  permission: string,
  organizationId?: string,
): Promise<boolean> {
  try {
    await assertPermission(userId, permission, organizationId);
    return true;
  } catch {
    return false;
  }
}
