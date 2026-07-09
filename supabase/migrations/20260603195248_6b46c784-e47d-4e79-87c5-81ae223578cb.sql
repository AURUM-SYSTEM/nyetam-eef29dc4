-- SELECT: owner can read own photos
CREATE POLICY "Users can view own recensement photos"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'recensement-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);

-- UPDATE: owner can update own photos
CREATE POLICY "Users can update own recensement photos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'recensement-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
)
WITH CHECK (
  bucket_id = 'recensement-photos'
  AND (storage.foldername(name))[1] = auth.uid()::text
);