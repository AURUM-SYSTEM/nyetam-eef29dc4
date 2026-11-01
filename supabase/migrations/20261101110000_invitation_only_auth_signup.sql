-- AURUM AGRO: closed, invitation-only account provisioning.
-- Existing auth.users rows are untouched. New Auth users must be created through
-- Supabase's admin invite flow (inviteUserByEmail), which sets invited_at.
CREATE OR REPLACE FUNCTION public.require_admin_invitation_for_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, auth
AS $$
BEGIN
  IF NEW.invited_at IS NULL THEN
    RAISE EXCEPTION 'AURUM access is invitation-only. Contact your organization administrator.'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.require_admin_invitation_for_new_auth_user() FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS require_admin_invitation_before_auth_user_insert ON auth.users;
CREATE TRIGGER require_admin_invitation_before_auth_user_insert
BEFORE INSERT ON auth.users
FOR EACH ROW
EXECUTE FUNCTION public.require_admin_invitation_for_new_auth_user();

COMMENT ON FUNCTION public.require_admin_invitation_for_new_auth_user() IS
'Blocks public self-registration; only Auth users created through the Supabase admin invitation flow are accepted. Existing users are not affected.';
