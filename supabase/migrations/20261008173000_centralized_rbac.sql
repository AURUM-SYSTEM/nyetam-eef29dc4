-- AURUM — RBAC centralisé
-- Les rôles métier sont séparés des permissions. Les rôles personnalisés
-- appartiennent à une organisation; les rôles système sont globaux.
CREATE TABLE IF NOT EXISTS public.role_definitions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  is_system BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (organization_id, code)
);

CREATE UNIQUE INDEX IF NOT EXISTS role_definitions_system_code_uidx ON public.role_definitions(code) WHERE organization_id IS NULL;

CREATE TABLE IF NOT EXISTS public.role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES public.role_definitions(id) ON DELETE CASCADE,
  permission TEXT NOT NULL,
  UNIQUE (role_id, permission)
);

ALTER TABLE public.role_definitions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.role_permissions ENABLE ROW LEVEL SECURITY;

-- Les fonctions serveur vérifient l'organisation et utilisent supabaseAdmin.
-- Aucun accès direct client n'est nécessaire à ces tables.
REVOKE ALL ON public.role_definitions FROM anon, authenticated;
REVOKE ALL ON public.role_permissions FROM anon, authenticated;

INSERT INTO public.role_definitions (organization_id, code, name, description, is_system)
VALUES
  (NULL, 'agent', 'Agent', 'Accès opérationnel de terrain.', true),
  (NULL, 'supervisor', 'Superviseur', 'Contrôle et suivi opérationnel.', true),
  (NULL, 'admin', 'Administrateur', 'Administration de l’organisation.', true)
ON CONFLICT DO NOTHING;

-- Catalogue stable de permissions utilisé par l'interface et les contrôles serveur.
CREATE TABLE IF NOT EXISTS public.permission_catalog (
  permission TEXT PRIMARY KEY,
  label TEXT NOT NULL,
  module TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

INSERT INTO public.permission_catalog(permission,label,module,description) VALUES
 ('terrain.collect.create','Créer une collecte','collecte','Enregistrer une nouvelle collecte terrain'),
 ('terrain.collect.view','Consulter les collectes','collecte','Consulter les collectes'),
 ('terrain.collect.edit','Modifier une collecte','collecte','Modifier une collecte existante'),
 ('producers.view','Consulter les producteurs','producteurs','Voir les fiches producteurs'),
 ('producers.create','Créer un producteur','producteurs','Créer une fiche producteur'),
 ('producers.edit','Modifier un producteur','producteurs','Modifier une fiche producteur'),
 ('parcels.view','Consulter les parcelles','parcelles','Voir les parcelles et leurs GPS'),
 ('parcels.create','Créer une parcelle','parcelles','Créer une nouvelle parcelle'),
 ('parcels.edit','Modifier une parcelle','parcelles','Modifier les données parcellaire'),
 ('missions.view','Consulter les missions','missions','Voir les missions terrain'),
 ('missions.create','Créer une mission','missions','Créer une mission'),
 ('missions.edit','Modifier une mission','missions','Modifier une mission'),
 ('production.view','Consulter la production','production','Voir les données de production'),
 ('production.create','Enregistrer la production','production','Enregistrer une production'),
 ('production.edit','Modifier la production','production','Modifier une production'),
 ('harvest.view','Consulter les récoltes','récoltes','Voir les récoltes'),
 ('harvest.create','Enregistrer une récolte','récoltes','Créer une récolte'),
 ('harvest.edit','Modifier une récolte','récoltes','Modifier une récolte'),
 ('collection.view','Consulter les collectes','collecte','Voir les opérations de collecte'),
 ('collection.create','Créer une collecte','collecte','Créer une opération de collecte'),
 ('collection.edit','Modifier une collecte','collecte','Modifier une opération de collecte'),
 ('lots.view','Consulter les lots','lots','Voir les lots'),
 ('lots.create','Créer un lot','lots','Créer un lot traçable'),
 ('lots.edit','Modifier un lot','lots','Modifier un lot'),
 ('stock.view','Consulter le stock','stock','Voir le stock'),
 ('stock.create','Enregistrer un mouvement de stock','stock','Créer un mouvement'),
 ('stock.edit','Modifier le stock','stock','Modifier un mouvement'),
 ('deliveries.view','Consulter les livraisons','livraisons','Voir les livraisons'),
 ('deliveries.create','Créer une livraison','livraisons','Créer une livraison'),
 ('deliveries.edit','Modifier une livraison','livraisons','Modifier une livraison'),
 ('reports.view','Consulter les rapports','rapports','Voir les rapports et analyses'),
 ('reports.export','Exporter les rapports','rapports','Exporter les données autorisées'),
 ('users.manage','Gérer les utilisateurs','administration','Inviter et affecter des utilisateurs'),
 ('roles.manage','Gérer les rôles','administration','Créer et modifier les rôles'),
 ('settings.manage','Gérer les paramètres','administration','Modifier les paramètres de l’organisation')
ON CONFLICT (permission) DO NOTHING;

-- Permissions de base des rôles système.
WITH role_map AS (
  SELECT id, code FROM public.role_definitions WHERE organization_id IS NULL
)
INSERT INTO public.role_permissions(role_id, permission)
SELECT r.id, p.permission
FROM role_map r
CROSS JOIN public.permission_catalog p
WHERE r.code = 'admin'
ON CONFLICT (role_id, permission) DO NOTHING;

WITH role_map AS (
  SELECT id, code FROM public.role_definitions WHERE organization_id IS NULL
)
INSERT INTO public.role_permissions(role_id, permission)
SELECT r.id, p.permission
FROM role_map r
JOIN public.permission_catalog p ON p.permission IN (
  'terrain.collect.create','terrain.collect.view','terrain.collect.edit',
  'producers.view','producers.create','producers.edit',
  'parcels.view','parcels.create','parcels.edit',
  'missions.view','missions.create','missions.edit'
)
WHERE r.code = 'agent'
ON CONFLICT (role_id, permission) DO NOTHING;

WITH role_map AS (
  SELECT id, code FROM public.role_definitions WHERE organization_id IS NULL
)
INSERT INTO public.role_permissions(role_id, permission)
SELECT r.id, p.permission
FROM role_map r
JOIN public.permission_catalog p ON p.permission NOT IN ('users.manage','roles.manage','settings.manage')
WHERE r.code = 'supervisor'
ON CONFLICT (role_id, permission) DO NOTHING;
