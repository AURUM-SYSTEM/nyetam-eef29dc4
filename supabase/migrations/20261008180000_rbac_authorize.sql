-- AURUM — autorisation centrale au niveau base de données
-- Compatible avec les rôles système et les rôles personnalisés par organisation.
-- Les fonctions serveur utilisent déjà la même logique via src/lib/rbac.ts.
CREATE OR REPLACE FUNCTION public.authorize(requested_permission TEXT)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  current_user_id UUID := auth.uid();
  current_org_id UUID;
BEGIN
  IF current_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT p.organization_id
    INTO current_org_id
  FROM public.profiles p
  WHERE p.id = current_user_id;

  IF current_org_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.user_roles ur
    JOIN public.role_definitions rd
      ON rd.code = ur.role
     AND (rd.organization_id IS NULL OR rd.organization_id = current_org_id)
    JOIN public.role_permissions rp
      ON rp.role_id = rd.id
     AND rp.permission = requested_permission
    WHERE ur.user_id = current_user_id
      AND ur.organization_id = current_org_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.authorize(TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.authorize(TEXT) TO authenticated;
