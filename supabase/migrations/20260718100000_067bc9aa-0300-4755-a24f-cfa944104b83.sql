-- Idempotence de la synchronisation offline (documents) — voir
-- docs/AUDIT_REPORT.md §3.4.
--
-- Constat : le sync engine (src/hooks/use-sync-engine.ts) insère la ligne
-- `documents` puis continue le traitement (upload photos/vidéos,
-- structuration CORE) avant de marquer l'item de la file "synced". Si
-- l'exécution est interrompue APRÈS l'insertion Supabase réussie mais
-- AVANT ce marquage final — app fermée, coupure réseau, crash — le prochain
-- passage du moteur de synchronisation rejoue le traitement depuis le
-- début pour ce même item, y compris un second INSERT sur `documents`,
-- créant un doublon silencieux.
--
-- Correctif : une clé d'idempotence fournie par le client
-- (`client_queue_id`, l'id local du QueueItem — déjà stable, généré une
-- seule fois par saisie, voir offline-store.ts) associée à une contrainte
-- d'unicité. Le sync engine vérifie désormais l'existence d'un document
-- portant cette clé AVANT d'insérer ; s'il existe déjà (issu d'une
-- tentative précédente interrompue), il réutilise cette ligne au lieu
-- d'en créer une seconde.
--
-- Index unique PARTIEL (WHERE client_queue_id IS NOT NULL) plutôt qu'une
-- contrainte UNIQUE classique sur la colonne : les documents créés avant
-- ce correctif ont tous `client_queue_id = NULL`, et une contrainte UNIQUE
-- standard rejetterait plusieurs NULL simultanément selon certains moteurs
-- — l'index partiel évite toute ambiguïté et ne s'applique qu'aux
-- nouvelles lignes qui renseignent effectivement cette clé.

ALTER TABLE public.documents ADD COLUMN IF NOT EXISTS client_queue_id text;

CREATE UNIQUE INDEX IF NOT EXISTS documents_client_queue_id_unique
  ON public.documents (client_queue_id)
  WHERE client_queue_id IS NOT NULL;
