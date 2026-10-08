-- AURUM — correction du modèle de commission
-- Producteur = source de la donnée.
-- Acheteur/client = payeur commercial.
-- Coopérative = bénéficiaire de la commission.
-- AURUM conserve en interne la tarification client.

-- Convertit proprement les éventuelles lignes créées par la première version
-- du modèle et récupère le payeur depuis l'événement d'accès quand disponible.
UPDATE public.commercial_commission_ledger c
SET
  payer_type = 'buyer_organization',
  payer_organization_id = COALESCE(
    c.payer_organization_id,
    (
      SELECT e.accessor_organization_id
      FROM public.data_access_events e
      WHERE e.id = c.data_access_event_id
    )
  )
WHERE c.payer_type IS DISTINCT FROM 'buyer_organization';

ALTER TABLE public.commercial_commission_ledger
  DROP CONSTRAINT IF EXISTS commercial_commission_payer_type_check;

ALTER TABLE public.commercial_commission_ledger
  ADD CONSTRAINT commercial_commission_payer_type_check
  CHECK (payer_type IN ('buyer_organization'));

COMMENT ON COLUMN public.commercial_commission_ledger.organization_id IS
  'Organisation bénéficiaire de la commission (coopérative propriétaire des données du producteur).';

COMMENT ON COLUMN public.commercial_commission_ledger.producer_id IS
  'Producteur dont les données ont généré l usage commercial. Le producteur n est pas le payeur.';

COMMENT ON COLUMN public.commercial_commission_ledger.payer_type IS
  'Type de payeur commercial. Dans le modèle AURUM: buyer_organization.';

COMMENT ON COLUMN public.commercial_commission_ledger.payer_organization_id IS
  'Organisation acheteuse/client qui paie l accès commercial. Information interne, jamais exposée à la coopérative.';

COMMENT ON COLUMN public.commercial_commission_ledger.commission_amount IS
  'Commission reversée à l organisation bénéficiaire. Ne révèle jamais le prix payé par l acheteur.';

CREATE INDEX IF NOT EXISTS commercial_commission_ledger_payer_idx
  ON public.commercial_commission_ledger(payer_organization_id, accrued_at DESC);

COMMENT ON TABLE public.commercial_commission_ledger IS
  'Registre interne: producteur source -> acheteur payeur -> coopérative bénéficiaire. Le prix client reste confidentiel.';
