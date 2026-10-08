-- Idempotence key for producers created from the offline queue.
ALTER TABLE public.producers
  ADD COLUMN IF NOT EXISTS offline_client_id text;

CREATE UNIQUE INDEX IF NOT EXISTS producers_org_offline_client_id_uidx
  ON public.producers (organization_id, offline_client_id)
  WHERE offline_client_id IS NOT NULL;
