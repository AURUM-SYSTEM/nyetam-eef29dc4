ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS mission_type text,
  ADD COLUMN IF NOT EXISTS suggestions text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS location_data jsonb;