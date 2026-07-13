-- Verrouille "documents" au niveau base une fois validé, au lieu de
-- compter uniquement sur l'application :
--
-- Constat (audit) : la policy UPDATE/DELETE d'origine
-- (20260522071924_...sql:76-80) autorise auth.uid() = user_id SANS AUCUNE
-- condition sur validated_at. updateOwnDocument
-- (src/lib/moderation.functions.ts) est la SEULE fonction qui vérifie
-- validated_at et journalise dans audit_log — mais rien n'empêche un agent
-- d'appeler le SDK Supabase client directement (update ou delete) pour
-- contourner entièrement ce garde-fou applicatif, y compris pour
-- s'auto-valider (poser validated_at/validated_by lui-même).
--
-- Cette migration :
--   1. Restreint UPDATE aux documents non encore validés, ET interdit à
--      l'agent de poser lui-même validated_at via WITH CHECK (empêche
--      l'auto-validation, pas seulement l'édition post-validation).
--   2. Retire la policy DELETE directe. Toute suppression passe désormais
--      par public.delete_own_document(), SECURITY DEFINER, qui revérifie
--      la propriété et le statut de validation, et journalise
--      systématiquement dans audit_log — jamais de suppression silencieuse.
--
-- Flux applicatifs vérifiés comme non affectés (voir audit) :
--   - use-sync-engine.ts : insert (non concerné) puis update(photo_urls /
--     video_urls) juste après l'insert, sur un document dont validated_at
--     est forcément encore NULL à ce stade → toujours autorisé.
--   - moderation.functions.ts:updateOwnDocument : vérifie déjà
--     validated_at IS NULL côté application avant d'appeler update() avec
--     le client RLS — la policy DB devient une seconde ligne de défense
--     cohérente avec ce contrôle, pas une régression.
--   - moderation.functions.ts:validateDocument : écrit validated_at via
--     supabaseAdmin (rôle service, contourne RLS) — non affecté.
--   - Suppression manuelle par l'agent (_authenticated.document.$id.tsx,
--     _authenticated.index.tsx) : migrée vers l'appel RPC dans le même
--     changement applicatif que cette migration.

-- ============================================================
-- 1. UPDATE — autorisé uniquement si le document n'est pas (et ne
--    devient pas) validé.
-- ============================================================

DROP POLICY IF EXISTS "users update own documents" ON public.documents;

CREATE POLICY "users update own unvalidated documents" ON public.documents
  FOR UPDATE
  USING (auth.uid() = user_id AND validated_at IS NULL)
  WITH CHECK (auth.uid() = user_id AND validated_at IS NULL);

-- ============================================================
-- 2. DELETE — plus aucune policy directe : toute tentative de
--    `supabase.from("documents").delete()` échoue désormais (0 ligne
--    affectée), quel que soit le statut de validation. Seule la fonction
--    ci-dessous peut supprimer un document.
-- ============================================================

DROP POLICY IF EXISTS "users delete own documents" ON public.documents;

-- ============================================================
-- 3. Suppression contrôlée + journalisée, réservée au propriétaire, et
--    seulement tant que le document n'est pas validé.
-- ============================================================

CREATE OR REPLACE FUNCTION public.delete_own_document(_document_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_validated_at timestamptz;
  v_org_id uuid;
  v_snapshot jsonb;
BEGIN
  SELECT d.user_id, d.validated_at, to_jsonb(d.*)
    INTO v_owner_id, v_validated_at, v_snapshot
    FROM public.documents d
    WHERE d.id = _document_id;

  IF v_owner_id IS NULL THEN
    RAISE EXCEPTION 'Document introuvable.';
  END IF;

  IF v_owner_id <> auth.uid() THEN
    RAISE EXCEPTION 'Vous ne pouvez supprimer que vos propres documents.';
  END IF;

  IF v_validated_at IS NOT NULL THEN
    RAISE EXCEPTION 'Ce document est validé, il ne peut plus être supprimé.';
  END IF;

  SELECT organization_id INTO v_org_id FROM public.profiles WHERE id = auth.uid();

  DELETE FROM public.documents WHERE id = _document_id;

  INSERT INTO public.audit_log (organization_id, actor_id, action, entity_type, entity_id, old_value)
  VALUES (v_org_id, auth.uid(), 'deletion', 'document', _document_id, v_snapshot);
END;
$$;

REVOKE EXECUTE ON FUNCTION public.delete_own_document(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.delete_own_document(uuid) TO authenticated;
