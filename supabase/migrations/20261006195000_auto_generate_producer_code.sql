-- AURUM AGRO — génération automatique du code producteur pour les nouveaux producteurs.
-- Le code est dérivé de l'UUID déjà généré par PostgreSQL.

CREATE OR REPLACE FUNCTION public.set_producer_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.producer_code IS NULL OR btrim(NEW.producer_code) = '' THEN
    NEW.producer_code := 'PRD-' || upper(substr(replace(NEW.id::text, '-', ''), 1, 8));
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS producers_set_producer_code ON public.producers;

CREATE TRIGGER producers_set_producer_code
BEFORE INSERT ON public.producers
FOR EACH ROW
EXECUTE FUNCTION public.set_producer_code();

COMMENT ON FUNCTION public.set_producer_code() IS 'Génère automatiquement le code producteur AURUM à partir de son UUID.';
