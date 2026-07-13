-- pgTAP — RLS de "documents" : propriété + verrouillage post-validation.
--
-- Couvre la régression corrigée par la migration
-- 20260713130000_...sql :
--   1. un agent ne peut pas modifier le document d'un autre agent ;
--   2. un document validé (validated_at IS NOT NULL) ne peut plus être
--      modifié ni supprimé via le client, même par son propriétaire ;
-- ainsi que le flux normal (un agent modifie/supprime toujours son propre
-- document tant qu'il n'est pas validé), pour garantir l'absence de
-- régression sur la saisie terrain.
--
-- ⚠️ Dépendance connue (voir supabase/migrations/README.md) : ce test
-- s'appuie sur profiles.organization_id, audit_log et
-- public.delete_own_document(), qui référencent eux-mêmes des objets non
-- couverts par les migrations committées (dérive de schéma préexistante).
-- Il doit donc être exécuté contre une base qui reflète le schéma RÉEL du
-- projet, pas une base fraîche reconstruite uniquement depuis
-- supabase/migrations/.
--
-- Exécution :
--   - Idéal (une fois la Phase 1 de reconstruction des migrations faite) :
--       supabase test db
--   - Immédiat, contre le projet réel (staging de préférence, jamais prod
--     sans copie jetable) :
--       psql "$DATABASE_URL" -f supabase/tests/database/documents_rls.test.sql

begin;

create extension if not exists pgtap with schema extensions;

select plan(12);

-- ============================================================
-- Fixtures — deux agents, chacun un document (créé "postgres", donc hors
-- RLS, comme le ferait normalement supabaseAdmin côté serveur).
-- ============================================================

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user
) values
  ('00000000-0000-0000-0000-000000000000', '11111111-1111-1111-1111-111111111111',
   'authenticated', 'authenticated', 'rls-test-agent-a@example.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false),
  ('00000000-0000-0000-0000-000000000000', '22222222-2222-2222-2222-222222222222',
   'authenticated', 'authenticated', 'rls-test-agent-b@example.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false);
-- Le trigger on_auth_user_created (handle_new_user) crée automatiquement
-- les deux lignes "profiles" correspondantes.

insert into public.documents (id, type, user_id, title, status)
values
  ('aaaaaaaa-0000-0000-0000-000000000001', 'field_entry', '11111111-1111-1111-1111-111111111111', 'Doc A — non validé', 'ready'),
  ('aaaaaaaa-0000-0000-0000-000000000002', 'field_entry', '11111111-1111-1111-1111-111111111111', 'Doc A — validé', 'ready'),
  ('bbbbbbbb-0000-0000-0000-000000000001', 'field_entry', '22222222-2222-2222-2222-222222222222', 'Doc B — non validé', 'ready');

update public.documents
  set validated_at = now(), validated_by = '22222222-2222-2222-2222-222222222222'
  where id = 'aaaaaaaa-0000-0000-0000-000000000002';

-- Petit helper local : bascule la session sur un utilisateur "authenticated" donné.
create or replace function pg_temp.act_as(_user_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claim.sub', _user_id::text, true);
  perform set_config('request.jwt.claims', json_build_object('sub', _user_id, 'role', 'authenticated')::text, true);
  set local role authenticated;
end;
$$ language plpgsql;

-- ============================================================
-- 1. Flux normal — le propriétaire modifie son propre document tant
--    qu'il n'est pas validé.
-- ============================================================

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');

select lives_ok(
  $$ update public.documents set title = 'Doc A — édité par son auteur' where id = 'aaaaaaaa-0000-0000-0000-000000000001' $$,
  'Le propriétaire peut modifier son propre document non validé'
);

reset role;
select is(
  (select title from public.documents where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Doc A — édité par son auteur',
  'La modification du propriétaire est bien persistée'
);

-- ============================================================
-- 2. Un agent ne peut pas modifier le document d'un autre agent.
-- ============================================================

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
update public.documents set title = 'Hacked by B' where id = 'aaaaaaaa-0000-0000-0000-000000000001';

reset role;
select is(
  (select title from public.documents where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  'Doc A — édité par son auteur',
  'Agent B ne peut pas modifier un document appartenant à Agent A (aucune ligne affectée)'
);

-- ============================================================
-- 3. Un document validé ne peut plus être modifié, même par son
--    propriétaire.
-- ============================================================

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
update public.documents set title = 'Tentative post-validation' where id = 'aaaaaaaa-0000-0000-0000-000000000002';

reset role;
select is(
  (select title from public.documents where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  'Doc A — validé',
  'Le propriétaire ne peut plus modifier son document une fois validé'
);

-- ============================================================
-- 4. Un agent ne peut pas s'auto-valider (poser validated_at lui-même
--    sur son propre document non validé).
-- ============================================================

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ update public.documents set validated_at = now() where id = 'bbbbbbbb-0000-0000-0000-000000000001' $$,
  'Un agent ne peut pas poser lui-même validated_at sur son propre document (auto-validation bloquée)'
);

-- ============================================================
-- 5. Suppression directe (SDK client) : plus aucune policy DELETE —
--    bloquée dans tous les cas, même document non validé et propriétaire.
-- ============================================================

select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
delete from public.documents where id = 'bbbbbbbb-0000-0000-0000-000000000001';

reset role;
select is(
  (select count(*)::int from public.documents where id = 'bbbbbbbb-0000-0000-0000-000000000001'),
  1,
  'La suppression directe (sans passer par delete_own_document) est bloquée, même sur un document non validé'
);

select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
delete from public.documents where id = 'aaaaaaaa-0000-0000-0000-000000000002';

reset role;
select is(
  (select count(*)::int from public.documents where id = 'aaaaaaaa-0000-0000-0000-000000000002'),
  1,
  'La suppression directe d''un document déjà validé est bloquée'
);

-- ============================================================
-- 6. delete_own_document() — suppression contrôlée.
-- ============================================================

-- Un document validé reste protégé même via la fonction dédiée.
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select throws_ok(
  $$ select public.delete_own_document('aaaaaaaa-0000-0000-0000-000000000002') $$,
  'delete_own_document() refuse de supprimer un document déjà validé'
);

-- Un agent ne peut pas supprimer le document d'un autre agent via la fonction.
select pg_temp.act_as('22222222-2222-2222-2222-222222222222');
select throws_ok(
  $$ select public.delete_own_document('aaaaaaaa-0000-0000-0000-000000000001') $$,
  'delete_own_document() refuse de supprimer le document d''un autre agent'
);

-- Le propriétaire peut supprimer son propre document non validé via la fonction.
select pg_temp.act_as('11111111-1111-1111-1111-111111111111');
select lives_ok(
  $$ select public.delete_own_document('aaaaaaaa-0000-0000-0000-000000000001') $$,
  'delete_own_document() supprime bien le document non validé de son propriétaire'
);

reset role;
select is(
  (select count(*)::int from public.documents where id = 'aaaaaaaa-0000-0000-0000-000000000001'),
  0,
  'Le document est effectivement supprimé'
);
select is(
  (select count(*)::int from public.audit_log where entity_type = 'document' and entity_id = 'aaaaaaaa-0000-0000-0000-000000000001' and action = 'deletion'),
  1,
  'La suppression via delete_own_document() est journalisée dans audit_log'
);

select * from finish();
rollback;
