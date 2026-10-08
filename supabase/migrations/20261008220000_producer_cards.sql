-- AURUM : fonctionnalités optionnelles pilotées centralement par le Super Administrateur.
ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS enabled_features text[] NOT NULL DEFAULT ARRAY['reports','commissions','producer_cards']::text[];

COMMENT ON COLUMN public.organizations.enabled_features IS
  'Fonctionnalités optionnelles activées par le Super Administrateur AURUM pour cette organisation.';

-- Autorisations dédiées aux cartes producteurs.
INSERT INTO public.permission_catalog(permission,label,module,description) VALUES
 ('producers.cards.view','Consulter les cartes producteurs','producteurs','Voir et ouvrir les cartes producteurs'),
 ('producers.cards.create','Produire une carte producteur','producteurs','Créer ou rééditer une carte producteur'),
 ('producers.cards.print','Imprimer une carte producteur','producteurs','Préparer une carte producteur pour impression')
ON CONFLICT (permission) DO NOTHING;

WITH role_map AS (
  SELECT id, code FROM public.role_definitions WHERE organization_id IS NULL
)
INSERT INTO public.role_permissions(role_id, permission)
SELECT r.id, p.permission
FROM role_map r
CROSS JOIN public.permission_catalog p
WHERE r.code IN ('admin','supervisor')
  AND p.permission IN ('producers.cards.view','producers.cards.create','producers.cards.print')
ON CONFLICT (role_id, permission) DO NOTHING;

-- Carte publique stable : le jeton est le seul identifiant exposé dans l'URL.
CREATE TABLE IF NOT EXISTS public.producer_cards (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  producer_id uuid NOT NULL REFERENCES public.producers(id) ON DELETE CASCADE,
  public_token text NOT NULL UNIQUE,
  status text NOT NULL DEFAULT 'active',
  issued_at timestamptz NOT NULL DEFAULT now(),
  issued_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  printed_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT producer_cards_status_check CHECK (status IN ('active','revoked','replaced'))
);

CREATE UNIQUE INDEX IF NOT EXISTS producer_cards_one_active_per_producer
  ON public.producer_cards(producer_id) WHERE status = 'active';
CREATE INDEX IF NOT EXISTS producer_cards_org_idx
  ON public.producer_cards(organization_id, issued_at DESC);

ALTER TABLE public.producer_cards ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.producer_cards FROM anon, authenticated;

COMMENT ON TABLE public.producer_cards IS
  'Cartes physiques AURUM des producteurs. Le jeton public donne accès uniquement au profil public autorisé.';
