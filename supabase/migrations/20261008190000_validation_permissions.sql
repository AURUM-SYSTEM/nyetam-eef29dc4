-- AURUM — validation centralisée des données terrain
-- La validation est une permission distincte de la modification.
INSERT INTO public.permission_catalog(permission,label,module,description)
VALUES (
  'terrain.collect.validate',
  'Valider une collecte',
  'collecte',
  'Valider définitivement une donnée terrain soumise par un agent'
)
ON CONFLICT (permission) DO NOTHING;

-- Les rôles système qui contrôlent les données peuvent valider.
WITH role_map AS (
  SELECT id, code
  FROM public.role_definitions
  WHERE organization_id IS NULL
)
INSERT INTO public.role_permissions(role_id, permission)
SELECT r.id, 'terrain.collect.validate'
FROM role_map r
WHERE r.code IN ('supervisor', 'admin')
ON CONFLICT (role_id, permission) DO NOTHING;
