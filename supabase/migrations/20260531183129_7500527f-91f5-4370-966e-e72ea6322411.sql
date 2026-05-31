
-- Public buckets serve files at /object/public/... without needing an
-- explicit SELECT policy. The broad SELECT policy let clients list every
-- file in the bucket, so we remove it. Direct URL reads still work.
DROP POLICY IF EXISTS "recensement_photos_read_public" ON storage.objects;
