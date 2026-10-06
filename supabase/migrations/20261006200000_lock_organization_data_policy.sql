-- AURUM : la politique commerciale est une configuration interne de la plateforme.
-- Les organisations clientes ne peuvent ni la lire directement ni la modifier via RLS.
-- Les server functions utilisent supabaseAdmin et exposent uniquement les capacités
-- explicitement autorisées à l'organisation.
ALTER TABLE public.organization_data_policies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS organization_data_policies_select_own ON public.organization_data_policies;
DROP POLICY IF EXISTS organization_data_policies_insert_own ON public.organization_data_policies;
DROP POLICY IF EXISTS organization_data_policies_update_own ON public.organization_data_policies;

COMMENT ON TABLE public.organization_data_policies IS 'Configuration interne AURUM des politiques de données par organisation. Les organisations clientes ne modifient pas directement cette table.';
