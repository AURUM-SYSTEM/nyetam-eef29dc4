-- AURUM — correction du modèle de commission
-- Le PRODUCTEUR est la source de la donnée.
-- L'ACHETEUR / organisation cliente paie l'accès commercial.
-- AURUM reverse ensuite une commission à la COOPÉRATIVE propriétaire
-- des données du producteur.
--
-- La coopérative ne voit jamais le prix facturé à l'acheteur.

ALTER TABLE public.commercial_commission_ledger
  DROP CONSTRAINT IF EXISTS commercial_commission_payer_type_check;

ALTER TABLE public.commercial_commission_ledger
  ADD CONSTRAINT commercial_commission_payer_type_check
  CHECK (payer_type IN ('buyer_organization'));

COMMENT ON COLUMN public.commercial_commission_ledger.organization_id IS
  'Organisation bénéficiaire de la commission (coopérative propriétaire des données du producteur).';

COMMENT ON COLUMN public.commercial_commission_ledger.producer_id IS
  'Producteur dont les données ont généré l usage commercial et la commission. Le producteur n est pas le payeur.';

COMMENT ON COLUMN public.commercial_commission_ledger.payer_type IS
  'Type de payeur commercial. Dans le modèle AURUM: buyer_organization.';

COMMENT ON COLUMN public.commercial_commission_ledger.payer_organization_id IS
  'Organisation acheteuse / cliente qui paie l accès commercial. Cette information reste interne et n est pas exposée à la coopérative.';

COMMENT ON COLUMN public.commercial_commission_ledger.commission_amount IS
  'Commission reversée à l organisation bénéficiaire. Ne révèle jamais le prix payé par l acheteur.';

CREATE INDEX IF NOT EXISTS commercial_commission_ledger_payer_idx
  ON public.commercial_commission_ledger(payer_organization_id, accrued_at DESC);

-- Garde-fou: une commission commerciale doit être rattachée
-- à un événement d'utilisation des données.
ALTER TABLE public.commercial_commission_ledger
  DROP CONSTRAINT IF EXISTS commercial_commission_event_required;

ALTER TABLE public.commercial_commission_ledger
  ADD CONSTRAINT commercial_commission_event_required
  CHECK (data_access_event_id IS NOT NULL);

COMMENT ON TABLE public.commercial_commission_ledger IS
  'Registre interne: producteur source -> acheteur payeur -> coopérative bénéficiaire. Le prix client reste confidentiel.';
