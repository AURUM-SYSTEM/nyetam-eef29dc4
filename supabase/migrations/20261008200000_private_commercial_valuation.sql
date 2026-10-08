-- AURUM — gouvernance commerciale des données
-- La coopérative voit l'usage de ses données et ses commissions,
-- mais JAMAIS le prix/valorisation facturé au tiers.
--
-- Principe:
-- 1) data_access_events = journal interne des usages autorisés.
-- 2) cooperative_data_usage_alerts = visibilité coopérative sans valeur commerciale.
-- 3) commercial_commission_ledger = calcul/commission interne, séparé du prix de vente.
-- 4) organization_data_policies devient serveur-seulement afin d'empêcher une coop
--    de lire ou modifier commission_rate / règles internes de valorisation.

INSERT INTO public.permission_catalog(permission,label,module,description)
VALUES
  ('data_access.alerts.view','Voir les alertes d’utilisation des données','commercial',
   'Consulter les alertes indiquant que les données de l’organisation ont été utilisées'),
  ('commercial.commissions.view','Consulter les commissions','commercial',
   'Consulter les commissions attribuées à l’organisation sans exposer la valorisation commerciale')
ON CONFLICT (permission) DO NOTHING;

WITH role_map AS (
  SELECT id, code
  FROM public.role_definitions
  WHERE organization_id IS NULL
)
INSERT INTO public.role_permissions(role_id, permission)
SELECT r.id, p.permission
FROM role_map r
CROSS JOIN public.permission_catalog p
WHERE r.code IN ('supervisor','admin')
  AND p.permission IN ('data_access.alerts.view','commercial.commissions.view')
ON CONFLICT (role_id, permission) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.data_access_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  producer_id UUID NOT NULL REFERENCES public.producers(id) ON DELETE CASCADE,
  producer_organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  accessor_organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  accessor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  access_scope TEXT NOT NULL,
  data_categories TEXT[] NOT NULL DEFAULT '{}'::text[],
  source TEXT NOT NULL DEFAULT 'aurum',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT data_access_events_event_type_check
    CHECK (event_type IN (
      'SCAN','PROFILE_VIEW','ACCESS_REQUEST','ACCESS_GRANTED',
      'REPORT_VIEW','REPORT_DOWNLOAD','LEAD_CREATED'
    )),
  CONSTRAINT data_access_events_scope_check
    CHECK (access_scope IN ('PUBLIC','PROFESSIONAL','ADVANCED'))
);

CREATE INDEX IF NOT EXISTS data_access_events_producer_idx
  ON public.data_access_events(producer_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS data_access_events_owner_idx
  ON public.data_access_events(producer_organization_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS public.cooperative_data_usage_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  data_access_event_id UUID NOT NULL UNIQUE REFERENCES public.data_access_events(id) ON DELETE CASCADE,
  alert_type TEXT NOT NULL DEFAULT 'DATA_USED',
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS cooperative_data_usage_alerts_org_idx
  ON public.cooperative_data_usage_alerts(organization_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.commercial_commission_ledger (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  data_access_event_id UUID REFERENCES public.data_access_events(id) ON DELETE SET NULL,
  commission_amount NUMERIC(14,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'XAF',
  status TEXT NOT NULL DEFAULT 'accrued',
  accrued_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  paid_at TIMESTAMPTZ,
  payout_reference TEXT,
  internal_note TEXT,
  CONSTRAINT commercial_commission_status_check
    CHECK (status IN ('accrued','approved','paid','cancelled')),
  CONSTRAINT commercial_commission_amount_check
    CHECK (commission_amount >= 0)
);

CREATE INDEX IF NOT EXISTS commercial_commission_ledger_org_idx
  ON public.commercial_commission_ledger(organization_id, accrued_at DESC);

ALTER TABLE public.data_access_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.cooperative_data_usage_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.commercial_commission_ledger ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.data_access_events FROM anon, authenticated;
REVOKE ALL ON public.commercial_commission_ledger FROM anon, authenticated;

DROP POLICY IF EXISTS cooperative_data_usage_alerts_select_own ON public.cooperative_data_usage_alerts;
CREATE POLICY cooperative_data_usage_alerts_select_own
  ON public.cooperative_data_usage_alerts FOR SELECT
  USING (
    organization_id = (
      SELECT organization_id FROM public.profiles WHERE id = auth.uid()
    )
    AND public.authorize('data_access.alerts.view')
  );

REVOKE INSERT, UPDATE, DELETE ON public.cooperative_data_usage_alerts FROM anon, authenticated;

-- IMPORTANT : organization_data_policies contient commission_rate et des règles
-- internes. Elle doit rester accessible uniquement aux fonctions serveur.
REVOKE ALL ON public.organization_data_policies FROM anon, authenticated;

COMMENT ON TABLE public.data_access_events IS
  'Journal interne AURUM des usages de données producteurs. Non exposé directement aux coopératives.';
COMMENT ON TABLE public.cooperative_data_usage_alerts IS
  'Notifications visibles par la coopérative lorsqu une donnée est utilisée. Aucun prix de valorisation.';
COMMENT ON TABLE public.commercial_commission_ledger IS
  'Registre interne des commissions dues à une organisation. Ne contient pas le prix facturé au tiers.';
COMMENT ON COLUMN public.commercial_commission_ledger.commission_amount IS
  'Montant de commission dû à l organisation, distinct de toute valorisation ou tarification client.';
