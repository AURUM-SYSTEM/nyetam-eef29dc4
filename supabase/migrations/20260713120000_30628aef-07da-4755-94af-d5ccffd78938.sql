-- Sécurisation du stockage des médias terrain (photos/vidéos) :
--
-- 1. "recensement-photos" passe de public à privé. Un bucket public sert les
--    fichiers via /object/public/<bucket>/<chemin> SANS AUCUNE vérification
--    RLS — retirer une policy SELECT publique (fait en 20260531183129) ne
--    protège rien tant que le bucket lui-même reste public. Les chemins
--    <user_id>/<doc_id>/<photo_id>.<ext> pointent vers des photos
--    géolocalisées de producteurs : elles doivent être strictement privées.
-- 2. "recensement-videos" est créé ici, privé dès l'origine — le bucket
--    était utilisé par le code (use-sync-engine.ts, agro.functions.ts)
--    sans jamais avoir été créé par une migration.
-- 3. La policy SELECT pour les deux buckets est unifiée dans une fonction
--    SECURITY DEFINER (public.can_access_field_media) plutôt que des
--    sous-requêtes RLS imbriquées : "profiles" est lui-même protégé par RLS
--    (auth.uid() = id), donc une sous-requête directe dans la policy de
--    storage.objects ne pourrait jamais lire le profil du PROPRIÉTAIRE du
--    fichier quand l'appelant est un superviseur/admin différent de lui —
--    la fonction contourne ce problème de la même façon que has_role().
--
-- Dépendance connue : cette migration suppose l'existence de
-- public.profiles(organization_id), public.user_roles et
-- public.has_role(_user uuid, _role app_role) tels que reflétés dans
-- src/integrations/supabase/types.ts. Ces objets ont été créés hors
-- migration (dérive de schéma préexistante — voir audit) : à vérifier
-- contre le schéma réel avant application si un doute subsiste.

-- ============================================================
-- 1. Bucket "recensement-photos" → privé
-- ============================================================

UPDATE storage.buckets
SET public = false
WHERE id = 'recensement-photos';

-- ============================================================
-- 2. Bucket "recensement-videos" → créé privé
-- ============================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('recensement-videos', 'recensement-videos', false)
ON CONFLICT (id) DO NOTHING;

-- ============================================================
-- 3. Fonction d'accès partagée (SECURITY DEFINER) — propriétaire du
--    fichier OU superviseur/admin de la même organisation.
-- ============================================================

CREATE OR REPLACE FUNCTION public.can_access_field_media(_owner_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT
    auth.uid() = _owner_user_id
    OR EXISTS (
      SELECT 1
      FROM public.profiles caller
      JOIN public.profiles owner ON owner.id = _owner_user_id
      WHERE caller.id = auth.uid()
        AND caller.organization_id IS NOT NULL
        AND caller.organization_id = owner.organization_id
        AND (
          public.has_role(_user => auth.uid(), _role => 'supervisor')
          OR public.has_role(_user => auth.uid(), _role => 'admin')
        )
    );
$$;

REVOKE EXECUTE ON FUNCTION public.can_access_field_media(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_access_field_media(uuid) TO authenticated;

-- ============================================================
-- 4. Policies "recensement-photos" — remplace la policy SELECT
--    owner-only par la version unifiée owner-or-org-role. INSERT/UPDATE/
--    DELETE restent volontairement strictement owner-only (un
--    superviseur consulte via URL signée générée côté serveur avec le
--    rôle service — agro.functions.ts:getDocumentDetails — jamais via
--    une écriture directe sur les fichiers d'un agent).
-- ============================================================

DROP POLICY IF EXISTS "Users can view own recensement photos" ON storage.objects;
DROP POLICY IF EXISTS "recensement_photos_select_scoped" ON storage.objects;

CREATE POLICY "recensement_photos_select_scoped"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'recensement-photos'
  AND public.can_access_field_media(((storage.foldername(name))[1])::uuid)
);

-- ============================================================
-- 5. Policies "recensement-videos" — même schéma que les photos
--    (INSERT/UPDATE/DELETE owner-only, SELECT owner-or-org-role).
-- ============================================================

DROP POLICY IF EXISTS "recensement_videos_insert_own" ON storage.objects;
CREATE POLICY "recensement_videos_insert_own"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'recensement-videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "recensement_videos_select_scoped" ON storage.objects;
CREATE POLICY "recensement_videos_select_scoped"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'recensement-videos'
  AND public.can_access_field_media(((storage.foldername(name))[1])::uuid)
);

DROP POLICY IF EXISTS "recensement_videos_update_own" ON storage.objects;
CREATE POLICY "recensement_videos_update_own"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'recensement-videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'recensement-videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

DROP POLICY IF EXISTS "recensement_videos_delete_own" ON storage.objects;
CREATE POLICY "recensement_videos_delete_own"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'recensement-videos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);
