-- AURUM AGRO — identité terrain producteur
-- Code stable, généré côté base à partir de l'UUID, unique par organisation.
ALTER TABLE public.producers
  ADD COLUMN IF NOT EXISTS producer_code text,
  ADD COLUMN IF NOT EXISTS sex text,
  ADD COLUMN IF NOT EXISTS village text,
  ADD COLUMN IF NOT EXISTS commune text,
  ADD COLUMN IF NOT EXISTS department text,
  ADD COLUMN IF NOT EXISTS region text;

UPDATE public.producers
SET producer_code = 'PRD-' || upper(substr(replace(id::text, '-', ''), 1, 8))
WHERE producer_code IS NULL;

ALTER TABLE public.producers
  ALTER COLUMN producer_code SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS producers_organization_producer_code_uidx
  ON public.producers (organization_id, producer_code);

ALTER TABLE public.producers
  ADD CONSTRAINT producers_sex_check
  CHECK (sex IS NULL OR sex IN ('male', 'female', 'unknown'));

COMMENT ON COLUMN public.producers.producer_code IS 'Code producteur AURUM stable et unique dans l''organisation.';
