-- pgTAP — Idempotence de la synchronisation offline (documents), voir
-- docs/AUDIT_REPORT.md §3.4 et la migration
-- 20260718100000_067bc9aa-0300-4755-a24f-cfa944104b83.sql.
--
-- Ne teste que la garantie côté base (l'index unique partiel) — la logique
-- de reprise elle-même (vérifier l'existence avant d'insérer, réutiliser la
-- ligne trouvée) vit côté client dans use-sync-engine.ts et n'est pas
-- exécutable depuis pgTAP. Ce test fige le contrat dont ce code dépend :
-- deux documents ne peuvent jamais partager le même client_queue_id non nul,
-- et les documents pré-existants (client_queue_id NULL) ne sont pas affectés.
--
-- Exécution : psql "$DATABASE_URL" -f supabase/tests/database/documents_idempotency.test.sql

begin;

create extension if not exists pgtap with schema extensions;

select plan(4);

insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data, is_sso_user
) values
  ('00000000-0000-0000-0000-000000000000', '99999999-9999-9999-9999-999999999999',
   'authenticated', 'authenticated', 'idempotency-test-agent@example.test', 'not-a-real-hash',
   now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false);

-- 1. Premier document avec une clé d'idempotence donnée : passe.
select lives_ok(
  $$ insert into public.documents (id, type, user_id, title, status, client_queue_id)
     values ('aaaaaaaa-1111-0000-0000-000000000001', 'field_entry', '99999999-9999-9999-9999-999999999999', 'Doc A', 'ready', 'client-queue-key-1') $$,
  'Premier document avec client_queue_id = ''client-queue-key-1'' : accepté'
);

-- 2. Un second document avec LA MÊME clé (simulant une reprise après crash
--    qui, par erreur, insérerait à nouveau au lieu de réutiliser la ligne
--    existante) : refusé par l'index unique — c'est exactement la garantie
--    qui élimine le risque de doublon.
select throws_ok(
  $$ insert into public.documents (id, type, user_id, title, status, client_queue_id)
     values ('aaaaaaaa-1111-0000-0000-000000000002', 'field_entry', '99999999-9999-9999-9999-999999999999', 'Doc A (doublon)', 'ready', 'client-queue-key-1') $$,
  'Un second document avec le même client_queue_id est rejeté (index unique partiel)'
);

-- 3. Deux documents avec client_queue_id NULL (documents pré-existants,
--    créés avant ce correctif, ou tout chemin qui ne fournit pas cette clé)
--    ne doivent PAS entrer en conflit entre eux — l'index est partiel
--    (WHERE client_queue_id IS NOT NULL).
select lives_ok(
  $$ insert into public.documents (id, type, user_id, title, status, client_queue_id)
     values ('aaaaaaaa-1111-0000-0000-000000000003', 'field_entry', '99999999-9999-9999-9999-999999999999', 'Doc B (sans clé)', 'ready', null) $$,
  'Un document avec client_queue_id NULL est accepté'
);
select lives_ok(
  $$ insert into public.documents (id, type, user_id, title, status, client_queue_id)
     values ('aaaaaaaa-1111-0000-0000-000000000004', 'field_entry', '99999999-9999-9999-9999-999999999999', 'Doc C (sans clé)', 'ready', null) $$,
  'Un second document avec client_queue_id NULL est aussi accepté (NULL exclu de l''index unique)'
);

select * from finish();
rollback;
