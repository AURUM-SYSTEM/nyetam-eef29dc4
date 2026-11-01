-- Public self-onboarding: every verified self-signup receives a separate organization workspace.
-- Invited users retain the existing organization assignment flow.
DROP TRIGGER IF EXISTS require_admin_invitation_before_auth_user_insert ON auth.users;
DROP FUNCTION IF EXISTS public.require_admin_invitation_for_new_auth_user();

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, pg_temp
AS $$
DECLARE
  v_org_id uuid;
  v_org_name text;
  v_org_type text;
  v_module_type text;
  v_org_kind text;
BEGIN
  v_org_name := NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'organization_name', '')), '');
  v_org_type := COALESCE(NEW.raw_user_meta_data->>'organization_type', 'generic');
  v_module_type := COALESCE(NEW.raw_user_meta_data->>'module_type', 'generic');
  v_org_kind := COALESCE(NEW.raw_user_meta_data->>'organization_kind', 'independent');

  INSERT INTO public.profiles (
    id, email, full_name, country, profession, preferred_lang,
    secteur_activite, role_metier, organization_name, organization_type, module_type
  )
  VALUES (
    NEW.id, COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'country', 'Cameroun'),
    COALESCE(NEW.raw_user_meta_data->>'profession', 'Administrateur'),
    COALESCE(NEW.raw_user_meta_data->>'preferred_lang', 'fr'),
    COALESCE(NEW.raw_user_meta_data->>'secteur_activite', 'ong_humanitaire'),
    COALESCE(NEW.raw_user_meta_data->>'role_metier', 'administrateur'),
    COALESCE(v_org_name, ''),
    v_org_type,
    v_module_type
  )
  ON CONFLICT (id) DO NOTHING;

  -- An Auth invitation already carries the target organization's metadata;
  -- do not create another organization or assign an extra admin role.
  IF NEW.invited_at IS NULL THEN
    IF v_org_name IS NULL THEN
      v_org_name := COALESCE(NULLIF(trim(COALESCE(NEW.raw_user_meta_data->>'full_name', '')), ''), 'Nouvelle organisation');
    END IF;

    IF v_org_type NOT IN ('agriculture', 'health', 'ngo', 'generic') THEN v_org_type := 'generic'; END IF;
    IF v_module_type NOT IN ('agro', 'health', 'ngo', 'generic') THEN v_module_type := 'generic'; END IF;
    IF v_org_kind NOT IN ('independent', 'cooperative', 'union') THEN v_org_kind := 'independent'; END IF;

    INSERT INTO public.organizations (name, type, module_type, enabled_modules, organization_kind)
    VALUES (v_org_name, v_org_type, v_module_type, ARRAY[v_module_type], v_org_kind)
    RETURNING id INTO v_org_id;

    UPDATE public.profiles
      SET organization_id = v_org_id,
          organization_name = v_org_name,
          organization_type = v_org_type,
          module_type = v_module_type
      WHERE id = NEW.id;

    INSERT INTO public.user_roles (user_id, organization_id, role)
    VALUES (NEW.id, v_org_id, 'admin'::public.app_role)
    ON CONFLICT DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.handle_new_user() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO supabase_auth_admin;
