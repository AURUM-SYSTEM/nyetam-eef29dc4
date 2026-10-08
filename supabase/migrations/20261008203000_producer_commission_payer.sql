-- AURUM — règle de règlement des commissions
-- Les commissions sont dues par le producteur concerné, selon le modèle
-- commercial convenu pour l'utilisation autorisée de ses données.
-- La coopérative ne voit jamais la valeur commerciale facturée au tiers.

ALTER TABLE public.commercial_commission_ledger
  ADD COLUMN IF NOT EXISTS producer_id UUID REFERENCES public.producers(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payer_type TEXT NOT NULL DEFAULT 'producer',
  ADD COLUMN IF NOT EXISTS payer_organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL;

UPDATE public.commercial_commission_ledger
SET payer_type = 'producer'
WHERE payer_type IS NULL;

ALTER TABLE public.commercial_commission_ledger
  DROP CONSTRAINT IF EXISTS commercial_commission_payer_type_check;

ALTER TABLE public.commercial_commission_ledger
  ADD CONSTRAINT commercial_commission_payer_type_check
  CHECK (payer_type IN ('producer'));

CREATE INDEX IF NOT EXISTS commercial_commission_ledger_producer_idx
  ON public.commercial_commission_ledger(producer_id, accrued_at DESC);

COMMENT ON COLUMN public.commercial_commission_ledger.payer_type IS
  'Payeur contractuel de la commission. Dans le modèle AURUM actuel: producer uniquement.';
COMMENT ON COLUMN public.commercial_commission_ledger.payer_organization_id IS
  'Organisation du producteur au moment du calcul/règlement, si nécessaire pour le suivi comptable interne.';
COMMENT ON COLUMN public.commercial_commission_ledger.commission_amount IS
  'Commission revenant à la coopérative. Ce montant ne révèle jamais le prix facturé au tiers.';
