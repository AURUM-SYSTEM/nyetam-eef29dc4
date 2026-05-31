
-- Photos column on documents
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS photo_urls text[] NOT NULL DEFAULT '{}';

-- Storage bucket (public so URLs can be embedded in the document view / PDF)
INSERT INTO storage.buckets (id, name, public)
VALUES ('recensement-photos', 'recensement-photos', true)
ON CONFLICT (id) DO NOTHING;

-- Per-user folder policies
DROP POLICY IF EXISTS "recensement_photos_upload_own" ON storage.objects;
CREATE POLICY "recensement_photos_upload_own"
  ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'recensement-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "recensement_photos_read_public" ON storage.objects;
CREATE POLICY "recensement_photos_read_public"
  ON storage.objects FOR SELECT TO anon, authenticated
  USING (bucket_id = 'recensement-photos');

DROP POLICY IF EXISTS "recensement_photos_delete_own" ON storage.objects;
CREATE POLICY "recensement_photos_delete_own"
  ON storage.objects FOR DELETE TO authenticated
  USING (
    bucket_id = 'recensement-photos'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
