
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS organization_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS organization_type text NOT NULL DEFAULT 'generic',
  ADD COLUMN IF NOT EXISTS module_type text NOT NULL DEFAULT 'generic';

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, country, profession, preferred_lang,
    secteur_activite, role_metier,
    organization_name, organization_type, module_type
  )
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'country', ''),
    COALESCE(NEW.raw_user_meta_data->>'profession', ''),
    COALESCE(NEW.raw_user_meta_data->>'preferred_lang', 'fr'),
    COALESCE(NEW.raw_user_meta_data->>'secteur_activite', 'ong_humanitaire'),
    COALESCE(NEW.raw_user_meta_data->>'role_metier', 'agent_terrain'),
    COALESCE(NEW.raw_user_meta_data->>'organization_name', ''),
    COALESCE(NEW.raw_user_meta_data->>'organization_type', 'generic'),
    COALESCE(NEW.raw_user_meta_data->>'module_type', 'generic')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;
