
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS secteur_activite text NOT NULL DEFAULT 'ong_humanitaire',
  ADD COLUMN IF NOT EXISTS role_metier text NOT NULL DEFAULT 'agent_terrain';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_secteur_activite_check
    CHECK (secteur_activite IN ('ong_humanitaire','sante','collecte_recensement','autre'));

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_role_metier_check
    CHECK (role_metier IN ('agent_terrain','superviseur','enqueteur','coordinateur','chef_projet'));

UPDATE public.profiles
SET secteur_activite = COALESCE(NULLIF(secteur_activite,''), 'ong_humanitaire'),
    role_metier      = COALESCE(NULLIF(role_metier,''),      'agent_terrain');

CREATE OR REPLACE FUNCTION public.handle_new_user()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, country, profession, preferred_lang, secteur_activite, role_metier)
  VALUES (
    NEW.id,
    COALESCE(NEW.email, ''),
    COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', ''),
    COALESCE(NEW.raw_user_meta_data->>'country', ''),
    COALESCE(NEW.raw_user_meta_data->>'profession', ''),
    COALESCE(NEW.raw_user_meta_data->>'preferred_lang', 'fr'),
    COALESCE(NEW.raw_user_meta_data->>'secteur_activite', 'ong_humanitaire'),
    COALESCE(NEW.raw_user_meta_data->>'role_metier', 'agent_terrain')
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$function$;
