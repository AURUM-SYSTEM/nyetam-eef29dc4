-- AURUM field mission assignments. Additive: no legacy documents or users are reassigned.
CREATE TABLE IF NOT EXISTS public.agent_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  agent_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  title text NOT NULL CHECK (char_length(btrim(title)) BETWEEN 3 AND 160),
  instructions text NULL CHECK (instructions IS NULL OR char_length(instructions) <= 2000),
  module_type text NOT NULL CHECK (module_type IN ('agro','health','ngo','generic')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active','completed','cancelled')),
  starts_at timestamptz NULL,
  due_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT agent_assignments_due_after_start CHECK (due_at IS NULL OR starts_at IS NULL OR due_at >= starts_at)
);

CREATE INDEX IF NOT EXISTS idx_agent_assignments_org_status
  ON public.agent_assignments (organization_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_agent_assignments_agent_status
  ON public.agent_assignments (agent_user_id, status, created_at DESC);

COMMENT ON TABLE public.agent_assignments IS
  'Operational work assignments. Assignment records are organization-scoped and do not themselves grant access to other records.';

ALTER TABLE public.agent_assignments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.agent_assignments FROM anon, authenticated;
GRANT ALL ON TABLE public.agent_assignments TO service_role;

DROP POLICY IF EXISTS "agent assignments updated timestamp" ON public.agent_assignments;
CREATE OR REPLACE FUNCTION public.set_agent_assignment_updated_at()
RETURNS trigger LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
CREATE TRIGGER trg_agent_assignments_updated_at
BEFORE UPDATE ON public.agent_assignments
FOR EACH ROW EXECUTE FUNCTION public.set_agent_assignment_updated_at();
REVOKE ALL ON FUNCTION public.set_agent_assignment_updated_at() FROM PUBLIC, anon, authenticated;
