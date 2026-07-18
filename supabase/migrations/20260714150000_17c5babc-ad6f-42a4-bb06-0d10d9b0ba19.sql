-- Journal d'audit automatique (triggers) — complète le journal manuel
-- existant sans le dupliquer.
--
-- ⚠️ CONSTAT IMPORTANT (voir supabase/migrations/README.md) : la table
-- `audit_log` EXISTE DÉJÀ en production, avec un schéma différent de celui
-- généralement attendu pour un journal d'audit "générique" :
--   action, actor_id, entity_type, entity_id, old_value, new_value,
--   organization_id, justification, created_at, id
-- (pas table_name/record_id/user_id/old_values/new_values). Ce schéma est
-- déjà utilisé par du code existant : agro.functions.ts (createParcelle,
-- updateProducer, createProducer, attestEudrCompliance),
-- moderation.functions.ts (updateOwnDocument, validateDocument),
-- admin.functions.ts (createOrganizationWithAdmin, deleteOrganization).
--
-- Créer une nouvelle table avec des noms de colonnes différents aurait
-- cassé tout ce code, ou créé deux journaux d'audit parallèles. Cette
-- migration RÉUTILISE le schéma existant et n'ajoute des triggers
-- automatiques QUE là où rien n'est déjà journalisé manuellement, pour
-- éviter les entrées en double.
--
-- ⚠️ LIMITE STRUCTURELLE DÉCOUVERTE EN ÉCRIVANT CETTE MIGRATION — capture de
-- l'auteur (actor_id) via auth.uid() :
--   auth.uid() ne lit que la claim JWT "sub" de la requête PostgREST en
--   cours. Elle est correcte pour une écriture faite avec le client
--   authentifié de l'utilisateur (JWT utilisateur transmis) — c'est
--   exactement le cas de l'insert `documents` fait directement par le
--   client dans use-sync-engine.ts lors de la synchronisation offline.
--   MAIS elle est NULLE pour toute écriture faite via `supabaseAdmin` (clé
--   service role, sans claim "sub") — qui est le chemin utilisé pour QUASI
--   TOUTES les écritures sur cooperatives/parcelles/producers dans ce
--   projet (createParcelle, createProducer, updateProducer,
--   attestEudrCompliance...). Un trigger ne peut pas deviner qui a déclenché
--   une écriture service-role : seul le code applicatif le sait
--   (context.userId), d'où la convention déjà en place de journaliser
--   manuellement avec actor_id explicite pour ces chemins-là.
--
-- Conséquence concrète pour cette migration : les créations de coopérative
-- ET de producteur "à la volée" à l'intérieur de createParcelle (par nom
-- libre, si aucune correspondance existante) n'étaient PAS journalisées du
-- tout jusqu'ici (contrairement à ce que suggérait une première lecture
-- rapide du code) — corrigé dans ce même changement par l'ajout d'un log
-- manuel dans agro.functions.ts (mêmes lignes que l'insert), AVEC actor_id
-- correct. Les triggers automatiques ci-dessous ne couvrent donc PAS
-- l'INSERT de cooperatives (déjà couvert manuellement, actor_id correct) —
-- seulement UPDATE/DELETE (aucune fonction dédiée n'existe encore pour ces
-- deux opérations sur cooperatives ; actor_id sera NULL le jour où l'une
-- d'elles sera ajoutée via supabaseAdmin, SAUF si son auteur choisit de
-- journaliser manuellement comme ailleurs dans ce fichier).
--
--   Table         | Déjà journalisé manuellement            | Trigger ajouté ici
--   --------------|------------------------------------------|--------------------
--   cooperatives  | creation (créée par ce changement,        | UPDATE/DELETE
--                 | dans createParcelle)                      | (aucune fonction
--                 |                                            | dédiée existante :
--                 |                                            | actor_id restera
--                 |                                            | NULL tant qu'une
--                 |                                            | telle fonction ne
--                 |                                            | journalise pas
--                 |                                            | manuellement)
--   parcelles     | creation (createParcelle),                | DELETE uniquement
--                 | modification EUDR (attestEudrCompliance)  | (idem : actor_id
--                 |                                            | NULL tant qu'aucune
--                 |                                            | fonction de
--                 |                                            | suppression dédiée
--                 |                                            | n'existe)
--   producers     | creation dédiée + modification             | DELETE uniquement
--                 | (createProducer/updateProducer), creation | (idem ci-dessus)
--                 | "à la volée" (créée par ce changement,     |
--                 | dans createParcelle)                       |
--   documents     | modification/validation                   | INSERT uniquement
--                 | (updateOwnDocument/validateDocument),      | — auth.uid() CORRECT
--                 | deletion (delete_own_document)             | ici : ce chemin
--                 |                                            | passe par le client
--                 |                                            | authentifié
--                 |                                            | (use-sync-engine.ts),
--                 |                                            | jamais par
--                 |                                            | supabaseAdmin.
--
-- Un trigger DB (contrairement à un appel manuel dans le code applicatif)
-- s'exécute pour TOUTE écriture qui atteint la table, quel que soit le
-- chemin emprunté — y compris l'insert `documents` fait directement par le
-- client dans use-sync-engine.ts lors de la synchronisation offline, sans
-- avoir besoin de modifier ce fichier. C'est un filet de sécurité qui
-- garantit qu'une entrée existe (entité/action/horodatage toujours
-- corrects) même quand l'auteur exact ne peut pas être déterminé côté DB.

-- ============================================================
-- 1. Table audit_log — CREATE TABLE IF NOT EXISTS défensif (au cas où cette
--    migration tournerait sur une base qui ne l'a pas encore, ex. après la
--    reconstruction de la Phase 1 des migrations). Schéma identique à
--    l'existant, ne change RIEN à ce qui est déjà en place si la table
--    existe déjà.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audit_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id),
  actor_id uuid,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id uuid,
  old_value jsonb,
  new_value jsonb,
  justification text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_log ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- 2. RLS — lecture réservée superviseurs/admins de la même organisation ;
--    aucune policy INSERT/UPDATE/DELETE pour authenticated/anon (RLS
--    activée + policy absente = refus par défaut pour ces rôles).
-- ============================================================

DROP POLICY IF EXISTS "audit_log_select_supervisors_admins" ON public.audit_log;
CREATE POLICY "audit_log_select_supervisors_admins"
ON public.audit_log FOR SELECT
TO authenticated
USING (
  organization_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = auth.uid() AND p.organization_id = audit_log.organization_id
  )
  AND (
    public.has_role(_user => auth.uid(), _role => 'supervisor')
    OR public.has_role(_user => auth.uid(), _role => 'admin')
  )
);

-- ============================================================
-- 3. Immuabilité réelle — la RLS seule ne suffit pas : service_role
--    contourne systématiquement les policies RLS. On retire donc aussi le
--    privilège UPDATE/DELETE au niveau GRANT, pour tous les rôles
--    applicatifs y compris service_role : personne, même le backend avec
--    la clé service, ne peut modifier ou supprimer une ligne déjà écrite.
--    (INSERT n'est pas concerné : les écritures manuelles existantes via
--    supabaseAdmin, et les nouveaux triggers ci-dessous, restent possibles.)
-- ============================================================

REVOKE UPDATE, DELETE ON public.audit_log FROM authenticated, anon, service_role;

-- ============================================================
-- 4. Fonction trigger générique — journalise INSERT/UPDATE/DELETE avec
--    l'utilisateur authentifié, l'ancienne et la nouvelle valeur complètes
--    de la ligne (contrairement aux entrées manuelles existantes qui ne
--    journalisent que les champs modifiés — ici, la ligne entière avant/
--    après, plus simple et générique pour un trigger table-agnostique).
--    SECURITY DEFINER : s'exécute avec les privilèges du propriétaire de
--    la fonction (contourne le besoin d'un GRANT INSERT direct sur
--    audit_log pour le rôle qui déclenche le trigger). auth.uid() reste
--    correct malgré SECURITY DEFINER : il lit les claims JWT de la requête
--    en cours (GUC de session), non affectés par le changement de
--    privilèges d'exécution.
-- ============================================================

CREATE OR REPLACE FUNCTION public.audit_log_trigger()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row jsonb;
  v_record_id uuid;
  v_org_id uuid;
  v_user_id uuid;
  v_action text;
  v_entity_type text;
BEGIN
  v_row := to_jsonb(COALESCE(NEW, OLD));
  v_record_id := NULLIF(v_row->>'id', '')::uuid;

  -- organization_id direct si la table en a une (parcelles, producers,
  -- cooperatives) ; sinon déduit via profiles.organization_id à partir de
  -- user_id (documents, qui n'a pas organization_id en colonne propre).
  v_org_id := NULLIF(v_row->>'organization_id', '')::uuid;
  IF v_org_id IS NULL THEN
    v_user_id := NULLIF(v_row->>'user_id', '')::uuid;
    IF v_user_id IS NOT NULL THEN
      SELECT organization_id INTO v_org_id FROM public.profiles WHERE id = v_user_id;
    END IF;
  END IF;

  v_action := CASE TG_OP
    WHEN 'INSERT' THEN 'creation'
    WHEN 'UPDATE' THEN 'modification'
    WHEN 'DELETE' THEN 'deletion'
    ELSE lower(TG_OP)
  END;

  -- Nom singulier, cohérent avec les entrées déjà écrites manuellement
  -- ("parcelle", "producer", "document") — pas le nom de table brut (au
  -- pluriel), pour que le filtre par "élément concerné" reste cohérent.
  v_entity_type := CASE TG_TABLE_NAME
    WHEN 'parcelles' THEN 'parcelle'
    WHEN 'producers' THEN 'producer'
    WHEN 'cooperatives' THEN 'cooperative'
    WHEN 'documents' THEN 'document'
    ELSE TG_TABLE_NAME
  END;

  INSERT INTO public.audit_log (organization_id, actor_id, action, entity_type, entity_id, old_value, new_value)
  VALUES (
    v_org_id,
    auth.uid(),
    v_action,
    v_entity_type,
    v_record_id,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN to_jsonb(NEW) ELSE NULL END
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.audit_log_trigger() FROM PUBLIC, anon, authenticated;

-- ============================================================
-- 5. Rattachement — uniquement sur les combinaisons table/opération non
--    déjà couvertes par une journalisation manuelle (voir tableau en tête
--    de fichier), pour ne jamais dupliquer une entrée.
-- ============================================================

-- Pas de trigger INSERT sur cooperatives : désormais journalisé
-- manuellement (avec actor_id correct) dans agro.functions.ts — voir le
-- commentaire de tête. Un trigger INSERT ici dupliquerait cette entrée avec
-- un actor_id NULL en plus.
DROP TRIGGER IF EXISTS audit_cooperatives ON public.cooperatives;
DROP TRIGGER IF EXISTS audit_cooperatives_update_delete ON public.cooperatives;
CREATE TRIGGER audit_cooperatives_update_delete
  AFTER UPDATE OR DELETE ON public.cooperatives
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

DROP TRIGGER IF EXISTS audit_parcelles_delete ON public.parcelles;
CREATE TRIGGER audit_parcelles_delete
  AFTER DELETE ON public.parcelles
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

DROP TRIGGER IF EXISTS audit_producers_delete ON public.producers;
CREATE TRIGGER audit_producers_delete
  AFTER DELETE ON public.producers
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();

DROP TRIGGER IF EXISTS audit_documents_insert ON public.documents;
CREATE TRIGGER audit_documents_insert
  AFTER INSERT ON public.documents
  FOR EACH ROW EXECUTE FUNCTION public.audit_log_trigger();
