-- Link field captures to the operational assignment selected at capture time.
-- Nullable by design: all legacy and unassigned captures continue to work.
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS assignment_id uuid NULL
  REFERENCES public.agent_assignments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_assignment_id
  ON public.documents (assignment_id)
  WHERE assignment_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.validate_document_agent_assignment()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_assignment public.agent_assignments%ROWTYPE;
  v_org_id uuid;
BEGIN
  IF NEW.assignment_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- The signed-in agent may only attach their own assignment.
  IF auth.uid() IS NOT NULL AND auth.uid() <> NEW.user_id THEN
    RAISE EXCEPTION 'Document owner does not match authenticated user';
  END IF;

  SELECT organization_id INTO v_org_id
  FROM public.profiles
  WHERE id = NEW.user_id;

  SELECT * INTO v_assignment
  FROM public.agent_assignments
  WHERE id = NEW.assignment_id;

  IF NOT FOUND
     OR v_assignment.agent_user_id <> NEW.user_id
     OR v_assignment.organization_id IS DISTINCT FROM v_org_id
     OR v_assignment.status = 'cancelled' THEN
    RAISE EXCEPTION 'Invalid or unavailable agent assignment';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_document_agent_assignment ON public.documents;
CREATE TRIGGER trg_validate_document_agent_assignment
BEFORE INSERT OR UPDATE OF assignment_id, user_id
ON public.documents
FOR EACH ROW
EXECUTE FUNCTION public.validate_document_agent_assignment();

REVOKE ALL ON FUNCTION public.validate_document_agent_assignment() FROM PUBLIC, anon, authenticated;
