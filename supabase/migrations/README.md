# ⚠️ Ce dossier ne reflète PAS le schéma réel de la base de production

**Ne considérez pas `supabase/migrations/` comme source de vérité du schéma.**
11 tables existent en base réelle sans jamais avoir été créées par une
migration versionnée ici — elles ont été ajoutées directement en base
(Lovable Cloud / Supabase Studio) pendant le développement, sans que le SQL
correspondant soit committé. C'est une dérive de schéma (« schema drift »)
identifiée lors d'un audit du projet, non encore corrigée.

Concrètement : si vous cherchez la définition d'une colonne, d'une policy
RLS, d'un trigger ou d'une contrainte sur l'une des tables listées
ci-dessous, **vous ne la trouverez pas ici**, même si le code applicatif
(`src/lib/*.functions.ts`) l'utilise activement.

## Comment savoir ce qui existe réellement

Le fichier généré `src/integrations/supabase/types.ts` reflète le schéma
**réel** de la base au moment de sa dernière régénération (via la CLI/le
dashboard Supabase) — c'est aujourd'hui la source la plus fiable pour
connaître les tables, colonnes et types réellement en production. Pour une
vérité à jour, exécuter directement contre le projet réel :

```bash
supabase db pull        # ou
supabase db dump --schema public
```

## Tables présentes en base réelle mais absentes de ces migrations

D'après `src/integrations/supabase/types.ts` (généré depuis la base réelle),
en plus de `documents` et `profiles` (créées ici, voir plus bas) :

| Table | Rôle (déduit du code applicatif) |
|---|---|
| `organizations` | Organisation (tenant), modules activés, délai de modération |
| `parcelles` | Parcelles agricoles (GPS, polygone, culture, EUDR) |
| `producers` | Producteurs, liés à une coopérative |
| `cooperatives` | Coopératives, liées à une organisation |
| `user_roles` | Rôles applicatifs (`agent`, `supervisor`, `admin`, `platform_admin`) par utilisateur/organisation |
| `audit_log` | Journal d'audit (créations/modifications/validations) |
| `duplicate_alerts` | Alertes de doublon GPS sur les parcelles |
| `modification_requests` | Demandes de modification d'un document déjà validé |
| `agro_advisor_reports` | Rapports d'analyse IA archivés (module Agro) |
| `core_outputs` | Sorties structurées produites par la couche CORE à partir d'un document |
| `mission_forms` | Définition des formulaires de mission par module/organisation |

Sont également utilisées par le code sans migration retrouvée pour leur
définition : la fonction `public.has_role(_user, _role)`, la fonction
`public.apply_modification_request(...)`, la fonction
`public.sweep_expired_modification_requests()`, et l'enum
`public.app_role`.

Le bucket de stockage `recensement-videos` a la même origine : créé et
utilisé par le code (`use-sync-engine.ts`, `agro.functions.ts`) avant
d'être enfin créé par migration dans `20260713120000_...sql` — c'est la
première pièce de cette dérive à avoir été corrigée.

## Ce que ces migrations couvrent réellement

- `documents` (création, colonnes ajoutées au fil de l'eau, contrainte
  `type`, RLS de base `auth.uid() = user_id`)
- `profiles` (création, colonnes ajoutées au fil de l'eau, RLS de base,
  trigger `handle_new_user`)
- Bucket `recensement-photos` (création, puis passage en privé + policies
  scopées le 2026-07-13) et bucket `recensement-videos` (créé le
  2026-07-13, privé dès l'origine)
- Fonctions `touch_updated_at()` et `handle_new_user()`
- Fonction `can_access_field_media()` (accès storage owner-or-org-role,
  ajoutée le 2026-07-13 — **dépend de `profiles.organization_id`,
  `user_roles` et `has_role()`, qui ne sont pas définis dans ce dossier**)

## À faire (Phase 1 — reconstruction des migrations)

1. `supabase db pull` (ou dump manuel du schéma `public` + `storage`)
   contre le projet réel pour obtenir le DDL exact des 11 tables
   manquantes, de leurs policies RLS et des fonctions/enums associés.
2. Committer ce DDL comme une migration unique de rattrapage (baseline),
   datée avant toute nouvelle migration future, avec un commentaire
   explicite indiquant qu'il s'agit d'une reconstitution a posteriori et
   non de l'ordre chronologique réel de création.
3. Une fois la baseline committée, supprimer ce README (ou le réduire à un
   simple historique) — le dossier `supabase/migrations/` redevient alors
   une source de vérité fiable.
4. D'ici là, toute nouvelle modification de schéma doit être faite **par
   migration versionnée**, jamais directement en base, pour ne pas
   aggraver la dérive.
