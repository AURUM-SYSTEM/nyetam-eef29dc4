
-- Add optional module_type column (nullable, no default logic yet)
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS module_type text;

-- Constrain module_type to known values (nullable stays valid)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'documents_module_type_check'
  ) THEN
    ALTER TABLE public.documents
      ADD CONSTRAINT documents_module_type_check
      CHECK (module_type IS NULL OR module_type IN ('agro','health','ngo','generic'));
  END IF;
END$$;

-- Extend documents_type_check to allow the new neutral 'field_entry' type
ALTER TABLE public.documents
  DROP CONSTRAINT IF EXISTS documents_type_check;

ALTER TABLE public.documents
  ADD CONSTRAINT documents_type_check
  CHECK (type IN ('rapport','pv','recensement','enquete','field_entry'));
