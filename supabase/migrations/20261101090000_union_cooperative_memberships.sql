-- Union / cooperative membership foundation.
-- Additive only: existing organizations and field records are not reassigned.
-- All membership writes remain server-side (service_role) until the
-- platform-admin management workflow and scoped read paths are implemented.

ALTER TABLE public.organizations
  ADD COLUMN IF NOT EXISTS organization_kind text NOT NULL DEFAULT 'independent';

ALTER TABLE public.organizations
  DROP CONSTRAINT IF EXISTS organizations_organization_kind_check;

ALTER TABLE public.organizations
  ADD CONSTRAINT organizations_organization_kind_check
  CHECK (organization_kind IN ('independent', 'cooperative', 'union'));

COMMENT ON COLUMN public.organizations.organization_kind IS
  'AURUM structural classification. independent is the safe default; union must be explicitly assigned by AURUM.';

CREATE TABLE IF NOT EXISTS public.union_cooperatives (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  union_organization_id uuid NOT NULL
    REFERENCES public.organizations(id) ON DELETE CASCADE,
  cooperative_id uuid NOT NULL
    REFERENCES public.cooperatives(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid NULL REFERENCES auth.users(id) ON DELETE SET NULL,
  CONSTRAINT union_cooperatives_unique_membership
    UNIQUE (union_organization_id, cooperative_id)
);

CREATE INDEX IF NOT EXISTS idx_union_cooperatives_union
  ON public.union_cooperatives (union_organization_id);

CREATE INDEX IF NOT EXISTS idx_union_cooperatives_cooperative
  ON public.union_cooperatives (cooperative_id);

COMMENT ON TABLE public.union_cooperatives IS
  'Explicit allow-list: a union can be granted access only to the cooperative records linked here. No implicit organization-wide inheritance.';

CREATE OR REPLACE FUNCTION public.validate_union_cooperative_membership()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
DECLARE
  union_kind text;
  cooperative_org_id uuid;
BEGIN
  SELECT organization_kind
    INTO union_kind
    FROM public.organizations
   WHERE id = NEW.union_organization_id;

  IF union_kind IS DISTINCT FROM 'union' THEN
    RAISE EXCEPTION 'The parent organization must be explicitly classified as a union.'
      USING ERRCODE = '23514';
  END IF;

  SELECT organization_id
    INTO cooperative_org_id
    FROM public.cooperatives
   WHERE id = NEW.cooperative_id;

  IF cooperative_org_id IS NULL THEN
    RAISE EXCEPTION 'Cooperative not found or has no owning organization.'
      USING ERRCODE = '23503';
  END IF;

  IF cooperative_org_id = NEW.union_organization_id THEN
    RAISE EXCEPTION 'A union cannot be linked to a cooperative owned by itself.'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_union_cooperative_membership
  ON public.union_cooperatives;

CREATE TRIGGER trg_validate_union_cooperative_membership
BEFORE INSERT OR UPDATE OF union_organization_id, cooperative_id
ON public.union_cooperatives
FOR EACH ROW
EXECUTE FUNCTION public.validate_union_cooperative_membership();

CREATE OR REPLACE FUNCTION public.prevent_downgrade_linked_union()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NEW.organization_kind <> 'union'
     AND OLD.organization_kind = 'union'
     AND EXISTS (
       SELECT 1
         FROM public.union_cooperatives uc
        WHERE uc.union_organization_id = OLD.id
     ) THEN
    RAISE EXCEPTION 'Remove or transfer all cooperative memberships before changing this union classification.'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_downgrade_linked_union
  ON public.organizations;

CREATE TRIGGER trg_prevent_downgrade_linked_union
BEFORE UPDATE OF organization_kind
ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.prevent_downgrade_linked_union();

ALTER TABLE public.union_cooperatives ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Union members can read their membership list"
  ON public.union_cooperatives;

CREATE POLICY "Union members can read their membership list"
ON public.union_cooperatives
FOR SELECT
TO authenticated
USING (
  union_organization_id IN (
    SELECT p.organization_id
      FROM public.profiles p
     WHERE p.id = auth.uid()
       AND p.organization_id IS NOT NULL
    UNION
    SELECT ur.organization_id
      FROM public.user_roles ur
     WHERE ur.user_id = auth.uid()
       AND ur.organization_id IS NOT NULL
  )
);

REVOKE ALL ON TABLE public.union_cooperatives FROM anon, authenticated;
GRANT SELECT ON TABLE public.union_cooperatives TO authenticated;
GRANT ALL ON TABLE public.union_cooperatives TO service_role;

REVOKE ALL ON FUNCTION public.validate_union_cooperative_membership() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.prevent_downgrade_linked_union() FROM PUBLIC, anon, authenticated;
