-- AURUM AGRO : données agronomiques et conformité du recensement parcellaire.
-- Toutes les colonnes restent nullable pour préserver les parcelles historiques.

ALTER TABLE public.parcelles
  ADD COLUMN IF NOT EXISTS species text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS varieties text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS planting_year integer,
  ADD COLUMN IF NOT EXISTS land_tenure text,
  ADD COLUMN IF NOT EXISTS agroforestry boolean,
  ADD COLUMN IF NOT EXISTS certification text,
  ADD COLUMN IF NOT EXISTS estimated_yield_tonnes numeric,
  ADD COLUMN IF NOT EXISTS compliance_status text;

ALTER TABLE public.parcelles
  DROP CONSTRAINT IF EXISTS parcelles_land_tenure_check,
  DROP CONSTRAINT IF EXISTS parcelles_compliance_status_check;

ALTER TABLE public.parcelles
  ADD CONSTRAINT parcelles_land_tenure_check
    CHECK (land_tenure IS NULL OR land_tenure IN ('owner','sharecropper','rental','unknown')),
  ADD CONSTRAINT parcelles_compliance_status_check
    CHECK (compliance_status IS NULL OR compliance_status IN ('compliant','to_review','unknown'));

COMMENT ON COLUMN public.parcelles.planting_year IS 'Année de plantation/mise en culture, donnée de traçabilité terrain ; ne constitue pas à elle seule une preuve EUDR.';
COMMENT ON COLUMN public.parcelles.land_tenure IS 'Statut foncier déclaré sur le terrain : propriétaire, métayer, location ou inconnu.';
COMMENT ON COLUMN public.parcelles.species IS 'Espèces végétales observées sur la parcelle, sélection multiple.';
COMMENT ON COLUMN public.parcelles.varieties IS 'Variétés déclarées/observées, sélection multiple ; peut contenir Inconnue.';
