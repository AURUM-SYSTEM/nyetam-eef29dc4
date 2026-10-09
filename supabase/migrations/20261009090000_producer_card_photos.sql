-- Producer photo for the AURUM AGRO printable producer card.
ALTER TABLE public.producers
  ADD COLUMN IF NOT EXISTS photo_url text;

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('producer-photos', 'producer-photos', true, 5242880, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

-- Uploads and producer photo updates are performed server-side with the service role.
-- Public read is intentional: only the selected producer photo is shown on the public card.
DROP POLICY IF EXISTS "Public can read producer card photos" ON storage.objects;
CREATE POLICY "Public can read producer card photos"
ON storage.objects FOR SELECT
TO anon, authenticated
USING (bucket_id = 'producer-photos');
