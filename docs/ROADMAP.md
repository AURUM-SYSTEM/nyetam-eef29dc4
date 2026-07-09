# AURUM — Future Architecture Roadmap

> Ce document décrit les évolutions **planifiées mais non implémentées**.
> Il sert de référence pour le futur CTO / équipe technique. Aucun de ces
> chantiers ne doit être démarré sans validation produit explicite.
>
> Le MVP actuel (COLLECT) reste la référence stable. Les évolutions
> ci-dessous sont **additives** et n'imposent aucun refactor de COLLECT.

---

## Phase 1 — Consolidation multi-organisations

### 1.1 Table `organizations`

Aujourd'hui, l'organisation est stockée en texte libre sur `profiles`
(`organization_name`). Pour supporter plusieurs agents par organisation,
introduire :

```sql
CREATE TABLE public.organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text NOT NULL,          -- agriculture | health | ngo | generic | …
  module_type text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE public.profiles
  ADD COLUMN organization_id uuid REFERENCES public.organizations(id);
```

Backfill : créer une organisation par valeur distincte de
`organization_name` et lier les profils correspondants. `organization_type`
et `module_type` sur `profiles` deviennent alors dérivés (peuvent rester en
cache pour éviter les jointures).

### 1.2 Système de rôles

Suivre le pattern Supabase recommandé (voir `<user-roles>` dans les
directives internes) :

```sql
CREATE TYPE public.app_role AS ENUM ('agent', 'supervisor', 'admin');

CREATE TABLE public.user_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid REFERENCES public.organizations(id),
  role app_role NOT NULL,
  UNIQUE (user_id, organization_id, role)
);

CREATE FUNCTION public.has_role(_user uuid, _role app_role)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _user AND role = _role);
$$;
```

Ne **jamais** stocker le rôle sur `profiles` (risque d'escalade de
privilèges).

---

## Phase 2 — AURUM SUPERVISOR (Dashboard)

Projet Lovable séparé, pointant sur la même base Supabase.

### 2.1 Fonctionnalités cibles

- vue consolidée des saisies d'une organisation ;
- filtres : agent, date, module, géographie, statut ;
- carte des points GPS ;
- exports CSV / PDF / API ;
- gestion des invitations et rôles.

### 2.2 Impact base de données

Ajouter des policies RLS **additives** sur `documents` :

```sql
CREATE POLICY "supervisors read org documents"
ON public.documents FOR SELECT TO authenticated
USING (
  public.has_role(auth.uid(), 'supervisor')
  AND EXISTS (
    SELECT 1 FROM public.profiles p
    WHERE p.id = documents.user_id
      AND p.organization_id = (
        SELECT organization_id FROM public.user_roles
        WHERE user_id = auth.uid() AND role = 'supervisor' LIMIT 1
      )
  )
);
```

Aucune modification des policies existantes de COLLECT.

---

## Phase 3 — AURUM CORE (Processing)

Couche de traitement asynchrone. Options d'implémentation :

- **Worker Node/Python** externe déclenché par webhook Supabase ;
- **Edge Functions** Supabase (`supabase/functions/core-*`) ;
- **pg_cron + fonctions PL/pgSQL** pour les jobs simples.

### 3.1 Responsabilités

1. Lire les nouvelles lignes `documents` (trigger ou polling) ;
2. Nettoyer / normaliser le transcript ;
3. Router vers le module métier via `module_type` ;
4. Produire des sorties structurées dans de nouvelles tables :

```sql
CREATE TABLE public.core_outputs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL REFERENCES public.documents(id) ON DELETE CASCADE,
  module_type text NOT NULL,
  version int NOT NULL DEFAULT 1,
  payload jsonb NOT NULL,
  processed_at timestamptz DEFAULT now()
);
```

CORE **n'écrit jamais** dans `documents`. Séparation stricte source /
dérivé pour permettre le reprocessing.

### 3.2 Modules métiers

Chaque module est un dossier isolé dans le repo CORE :

```
core/
├── modules/
│   ├── agro/       # rendements, cultures, parcelles
│   ├── health/     # patients, campagnes, indicateurs OMS
│   ├── ngo/        # bénéficiaires, distributions
│   └── generic/    # fallback — extraction NER basique
└── router.ts       # dispatch selon document.module_type
```

Ajouter un module = ajouter un dossier + inscription dans le router.
Aucune modification de COLLECT n'est requise.

---

## Phase 4 — Workers IA

Extractions plus lourdes (NER, embeddings, classification) exécutées
hors du chemin critique de capture :

- file de jobs (`core_jobs` table + `pg_notify`) ;
- workers scalables horizontalement ;
- retry / dead letter ;
- observabilité (logs, métriques par module).

---

## Phase 5 — API publique

Exposer une API REST/GraphQL en lecture seule pour partenaires :

- routes sous `src/routes/api/public/*` (bypass auth, signature HMAC) ;
- scopes par organisation ;
- rate limiting (Cloudflare) ;
- documentation OpenAPI.

---

## Phase 6 — Multi-tenant avancé

- séparation logique par `organization_id` sur toutes les tables métier ;
- quotas par organisation (stockage, requêtes IA) ;
- facturation (Stripe / Paddle) ;
- audit trail cross-organisation.

---

## Ce qui **ne doit pas** être fait

- Réécrire COLLECT dans un autre framework.
- Ajouter de la logique métier (agro, santé…) dans COLLECT.
- Supprimer les types legacy (`rapport`, `pv`, `enquete`, `recensement`) —
  ils garantissent la lecture des anciennes données.
- Stocker les rôles sur `profiles`.
- Fusionner CORE et COLLECT dans le même déploiement.

---

## Ordre de priorité suggéré

1. **Phase 2** (SUPERVISOR) — valeur produit immédiate.
2. **Phase 1** (organizations + rôles) — prérequis technique de SUPERVISOR.
3. **Phase 3** (CORE) — dès qu'un module métier a un besoin concret.
4. **Phase 4-6** — selon la traction et les besoins clients.
