-- AURUM : politique de données configurable par organisation.
-- La plateforme reste multi-tenant : aucune organisation n'est codée en dur.
-- L'exploitation commerciale est désactivée par défaut.

CREATE TABLE IF NOT EXISTS public.organization_data_policies (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  export_enabled boolean NOT NULL DEFAULT true,
  commercial_data_use boolean NOT NULL DEFAULT false,
  agreement_status text NOT NULL DEFAULT 'pending',
  commission_type text NOT NULL DEFAULT 'none',
  commission_rate numeric,
  allowed_scopes text[] NOT NULL DEFAULT '{}'::text[],
  agreement_reference text,
  agreement_start timestamptz,
  agreement_end timestamptz,
  notes text,
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_data_policies_status_check CHECK (agreement_status IN ('pending','active','suspended','terminated')),
  CONSTRAINT organization_data_policies_commission_type_check CHECK (commission_type IN ('percentage','fixed_per_record','none')),
  CONSTRAINT organization_data_policies_rate_check CHECK (commission_rate IS NULL OR commission_rate >= 0),
  CONSTRAINT organization_data_policies_dates_check CHECK (agreement_end IS NULL OR agreement_start IS NULL OR agreement_end >= agreement_start)
);

COMMENT ON TABLE public.organization_data_policies IS 'Politique de données propre à chaque organisation : export, valorisation commerciale et commission. Exploitation commerciale désactivée par défaut.';
COMMENT ON COLUMN public.organization_data_policies.commercial_data_use IS 'Autorisation contractuelle de valorisation/exploitation commerciale des données de cette organisation.';
COMMENT ON COLUMN public.organization_data_policies.allowed_scopes IS 'Types de données explicitement autorisés pour la valorisation commerciale.';

ALTER TABLE public.organization_data_policies ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_data_policies_select_own
  ON public.organization_data_policies FOR SELECT
  USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY organization_data_policies_insert_own
  ON public.organization_data_policies FOR INSERT
  WITH CHECK (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));

CREATE POLICY organization_data_policies_update_own
  ON public.organization_data_policies FOR UPDATE
  USING (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()))
  WITH CHECK (organization_id = (SELECT organization_id FROM public.profiles WHERE id = auth.uid()));
