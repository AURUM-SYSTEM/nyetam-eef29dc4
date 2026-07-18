-- pgTAP — Journal d'audit automatique (triggers ajoutés par la migration
-- 20260714150000_17c5babc-ad6f-42a4-bb06-0d10d9b0ba19.sql).
--
-- Couvre :
--   1. cooperatives : UPDATE et DELETE déclenchent bien une entrée
--      audit_log (le trigger ne couvre PAS l'INSERT — journalisé
--      manuellement dans agro.functions.ts, voir le commentaire de tête de
--      la migration) ; une création "brute" par INSERT direct (hors
--      application) ne doit PAS produire de doublon via le trigger.
--   2. parcelles / producers : DELETE déclenche une entrée ; INSERT/UPDATE
--      ne déclenchent PAS d'entrée automatique (déjà journalisés
--      manuellement côté application — un trigger ici dupliquerait).
--   3. documents : INSERT déclenche une entrée (couvre notamment la
--      création via la synchronisation offline, qui insère directement
--      avec le client authentifié — voir use-sync-engine.ts).
--   4. capture de l'auteur (actor_id) via auth.uid() : correcte quand la
--      claim JWT "sub" est présente au moment de l'écriture (simulée ici
--      via `set_config('request.jwt.claims', ...)`, sans changer de rôle,
--      pour tester UNIQUEMENT la capture par le trigger — indépendamment
--      des policies RLS propres à chaque table, non garanties identiques
--      partout).
--   5. régression explicite demandée : une création de parcelle
--      (INSERT direct, simulant createParcelle) et une validation de
--      document (UPDATE validated_at, simulant validateDocument)
--      continuent de fonctionner normalement et ne sont pas cassées par
--      les nouveaux triggers (aucune entrée en double n'apparaît).
--
-- ⚠️ Comme documents_rls.test.sql, ce test dépend d'objets non couverts par
-- les migrations committées (dérive de schéma préexistante, voir
-- supabase/migrations/README.md). Exécution :
--   psql "$DATABASE_URL" -f supabase/tests/database/audit_log_triggers.test.sql

begin;

create extension if not exists pgtap with schema extensions;

select plan(15);

-- ============================================================
-- Fixtures — une organisation, un agent, un producteur, une parcelle.
-- ============================================================

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user
) values
  ('00000000-0000-0000-0000-000000000000', '33333333-3333-3333-3333-333333333333',
   'authenticated', 'authenticated', 'audit-test-agent@example.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false);
-- Le trigger on_auth_user_created (handle_new_user) crée automatiquement le
-- profil correspondant (organization_id NULL par défaut).

insert into public.organizations (id, name, type, module_type)
values ('44444444-0000-0000-0000-000000000001', 'Org test audit_log', 'agriculture', 'agro');

update public.profiles
  set organization_id = '44444444-0000-0000-0000-000000000001'
  where id = '33333333-3333-3333-3333-333333333333';

-- ============================================================
-- 1. cooperatives — le trigger ne couvre PAS l'INSERT (journalisé
--    manuellement côté application désormais).
-- ============================================================

insert into public.cooperatives (id, organization_id, name)
values ('55555555-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'Coopérative Test');

select is(
  (select count(*)::int from public.audit_log where entity_type = 'cooperative' and entity_id = '55555555-0000-0000-0000-000000000001'),
  0,
  'INSERT sur cooperatives ne déclenche PAS le trigger (journalisé manuellement côté application, pas ici)'
);

-- UPDATE : capture correcte de l'auteur si le contexte JWT est présent au
-- moment de l'écriture (sans changer de rôle, pour isoler la capture
-- auth.uid() des policies RLS de la table).
select set_config('request.jwt.claims', json_build_object('sub', '33333333-3333-3333-3333-333333333333', 'role', 'authenticated')::text, true);
update public.cooperatives set name = 'Coopérative Test (renommée)' where id = '55555555-0000-0000-0000-000000000001';
select set_config('request.jwt.claims', '', true);

select is(
  (select count(*)::int from public.audit_log where entity_type = 'cooperative' and entity_id = '55555555-0000-0000-0000-000000000001' and action = 'modification'),
  1,
  'UPDATE sur cooperatives déclenche bien une entrée audit_log (action = modification)'
);
select is(
  (select actor_id from public.audit_log where entity_type = 'cooperative' and entity_id = '55555555-0000-0000-0000-000000000001' and action = 'modification'),
  '33333333-3333-3333-3333-333333333333'::uuid,
  'actor_id est correctement capturé via auth.uid() quand la claim JWT est présente au moment de l''écriture'
);
select is(
  ((select new_value from public.audit_log where entity_type = 'cooperative' and entity_id = '55555555-0000-0000-0000-000000000001' and action = 'modification')->>'name'),
  'Coopérative Test (renommée)',
  'new_value contient bien la ligne complète après modification'
);

-- DELETE
delete from public.cooperatives where id = '55555555-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.audit_log where entity_type = 'cooperative' and entity_id = '55555555-0000-0000-0000-000000000001' and action = 'deletion'),
  1,
  'DELETE sur cooperatives déclenche bien une entrée audit_log (action = deletion)'
);

-- ============================================================
-- 2. parcelles — INSERT/UPDATE ne déclenchent PAS le trigger (déjà
--    journalisés manuellement côté application) ; DELETE le déclenche.
-- ============================================================

insert into public.parcelles (id, organization_id, culture, lat, lng, registered_by)
values ('66666666-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'Cacao', 4.05, 9.76, '33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.audit_log where entity_type = 'parcelle' and entity_id = '66666666-0000-0000-0000-000000000001' and action = 'creation'),
  0,
  'INSERT sur parcelles (simulant createParcelle) ne déclenche PAS le trigger — pas de doublon avec le log manuel applicatif'
);

update public.parcelles set surface_ha = 1.23 where id = '66666666-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.audit_log where entity_type = 'parcelle' and entity_id = '66666666-0000-0000-0000-000000000001' and action = 'modification'),
  0,
  'UPDATE sur parcelles ne déclenche pas le trigger non plus (ex. attestEudrCompliance journalise déjà manuellement)'
);

delete from public.parcelles where id = '66666666-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.audit_log where entity_type = 'parcelle' and entity_id = '66666666-0000-0000-0000-000000000001' and action = 'deletion'),
  1,
  'DELETE sur parcelles déclenche bien une entrée audit_log (aucune fonction dédiée ne le journalise encore manuellement)'
);

-- ============================================================
-- 3. producers — même schéma que parcelles.
-- ============================================================

insert into public.producers (id, organization_id, full_name, registered_by)
values ('77777777-0000-0000-0000-000000000001', '44444444-0000-0000-0000-000000000001', 'Producteur Test', '33333333-3333-3333-3333-333333333333');

select is(
  (select count(*)::int from public.audit_log where entity_type = 'producer' and entity_id = '77777777-0000-0000-0000-000000000001' and action = 'creation'),
  0,
  'INSERT sur producers ne déclenche PAS le trigger (createProducer journalise déjà manuellement)'
);

delete from public.producers where id = '77777777-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.audit_log where entity_type = 'producer' and entity_id = '77777777-0000-0000-0000-000000000001' and action = 'deletion'),
  1,
  'DELETE sur producers déclenche bien une entrée audit_log'
);

-- ============================================================
-- 4. documents — INSERT déclenche une entrée (couvre la synchronisation
--    offline, qui insère directement avec le client authentifié).
-- ============================================================

insert into public.documents (id, type, user_id, title, status)
values ('88888888-0000-0000-0000-000000000001', 'field_entry', '33333333-3333-3333-3333-333333333333', 'Doc audit_log test', 'ready');

select is(
  (select count(*)::int from public.audit_log where entity_type = 'document' and entity_id = '88888888-0000-0000-0000-000000000001' and action = 'creation'),
  1,
  'INSERT sur documents déclenche bien une entrée audit_log (couvre notamment la création via synchro offline)'
);
select is(
  (select organization_id from public.audit_log where entity_type = 'document' and entity_id = '88888888-0000-0000-0000-000000000001' and action = 'creation'),
  '44444444-0000-0000-0000-000000000001'::uuid,
  'organization_id est bien déduit via profiles.organization_id (documents n''a pas de colonne organization_id propre)'
);

-- Régression explicite demandée : la validation d'un document (UPDATE
-- validated_at, simulant validateDocument) ne doit pas créer d'entrée
-- automatique en plus de celle déjà écrite manuellement par
-- validateDocument dans le code applicatif (non simulée ici, donc 0 attendu
-- côté trigger).
update public.documents set validated_at = now(), validated_by = '33333333-3333-3333-3333-333333333333'
  where id = '88888888-0000-0000-0000-000000000001';
select is(
  (select count(*)::int from public.audit_log where entity_type = 'document' and entity_id = '88888888-0000-0000-0000-000000000001' and action = 'modification'),
  0,
  'UPDATE sur documents (validation) ne déclenche pas le trigger — validateDocument journalise déjà manuellement, pas de doublon'
);

-- ============================================================
-- 5. Immuabilité — le REVOKE porte sur authenticated/anon/service_role, PAS
--    sur le rôle propriétaire de la table (postgres, utilisé pour toutes
--    les fixtures ci-dessus) : un test lancé en tant que postgres passerait
--    à tort (le propriétaire n'est jamais soumis aux GRANT/REVOKE). On doit
--    donc explicitement se placer sous authenticated pour vérifier le
--    blocage réel.
-- ============================================================

set local role authenticated;
select throws_ok(
  $$ update public.audit_log set action = 'hacked' where entity_type = 'document' $$,
  'UPDATE direct sur audit_log est bloqué au niveau GRANT (immuabilité réelle, pas seulement RLS)'
);
select throws_ok(
  $$ delete from public.audit_log where entity_type = 'document' $$,
  'DELETE direct sur audit_log est bloqué au niveau GRANT'
);
reset role;

select * from finish();
rollback;
