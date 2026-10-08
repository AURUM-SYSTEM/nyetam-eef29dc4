-- AURUM : transparence des commissions coopératives
ALTER TABLE public.commercial_commission_ledger
  ADD COLUMN IF NOT EXISTS manual_entry boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS payment_note text,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

COMMENT ON COLUMN public.commercial_commission_ledger.commission_amount IS
  'Montant de commission dû/reversé à la coopérative. Visible par la coopérative bénéficiaire.';
COMMENT ON COLUMN public.commercial_commission_ledger.manual_entry IS
  'Indique que le montant peut être saisi manuellement tant que le calcul/paiement automatique n''est pas intégré.';
COMMENT ON COLUMN public.commercial_commission_ledger.payment_note IS
  'Note de versement/justificatif visible par la coopérative, sans révéler le prix client.';

CREATE INDEX IF NOT EXISTS commercial_commission_ledger_beneficiary_idx
  ON public.commercial_commission_ledger(organization_id, status, accrued_at DESC);
