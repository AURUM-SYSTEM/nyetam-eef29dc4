# AURUM — Modèle de données

> Décrit les tables Supabase utilisées par AURUM COLLECT, leurs relations, le
> rôle de chaque champ important, et la stratégie d'extension pour les futurs
> modules métiers.

---

## 1. Vue synthétique

```
auth.users (Supabase)
    │  1 ─ 1
    ▼
public.profiles ─────────────┐  (organization_type, module_type)
    │  1 ─ N                 │
    ▼                        │
public.documents  ◀──────────┘  (héritage du contexte org via user_id)
    │  1 ─ N
    ▼
storage: recensement-photos/<user_id>/<doc_id>/*
```

Seules deux tables applicatives existent aujourd'hui : `profiles` et
`documents`. Cette simplicité est **volontaire** — CORE et SUPERVISOR
ajouteront leurs propres tables sans modifier celles-ci.

---

## 2. Table `profiles`

Miroir applicatif de `auth.users`. Créée automatiquement par le trigger
`handle_new_user()` à l'inscription.

| Colonne | Type | Rôle |
|---|---|---|
| `id` | uuid (PK, FK `auth.users.id`) | Identité utilisateur |
| `email` | text | Copie de l'email d'auth |
| `full_name` | text | Nom affiché |
| `country` | text | Contexte géo par défaut |
| `profession` | text | Métier déclaré (texte libre) |
| `preferred_lang` | text (`fr`/`en`) | Langue UI + IA |
| `secteur_activite` | text | Champ legacy, conservé pour compat |
| `role_metier` | text | Champ legacy (ex. `agent_terrain`) |
| **`organization_name`** | text | Nom de l'organisation de l'agent |
| **`organization_type`** | text | Type d'organisation (`agriculture`, `health`, `ngo`, `generic`) |
| **`module_type`** | text | Module métier hérité (`agro`, `health`, `ngo`, `generic`) |
| `created_at` / `updated_at` | timestamptz | Audit |

### RLS
Toutes les policies scopent à `auth.uid() = id` (SELECT / INSERT / UPDATE).
Pas de DELETE. Un superviseur futur devra ajouter des policies dédiées
(via `has_role()`) sans toucher aux existantes.

---

## 3. Table `documents`

Table centrale : **une ligne = une saisie terrain**.

| Colonne | Type | Rôle |
|---|---|---|
| `id` | uuid (PK) | Identifiant document |
| `user_id` | uuid (FK auth.users) | Propriétaire — clef de RLS |
| **`type`** | text | Type technique (`field_entry` par défaut, ou legacy : `rapport`, `pv`, `recensement`, `enquete`) |
| `mission_type` | text | Sous-type sémantique (auto-détecté par l'IA pour legacy) |
| **`module_type`** | text (nullable) | Contexte métier hérité du profil au moment de la capture |
| `title` | text | Titre affiché |
| `transcript` | text | Transcript brut (audio + texte) — **source de vérité pour CORE** |
| `introduction` / `faits` / `declarations` / `observations` / `conclusion` | text | Sections structurées **legacy uniquement**. Vides pour `field_entry` — CORE se chargera de la structuration. |
| `agent_name`, `signature_name` | text | Métadonnées agent |
| `location` | text | Libellé lisible ("Douala, Cameroun (GPS)") |
| `location_data` | jsonb | `{ lat, lng, city, country, source }` |
| `photo_urls` | text[] | Chemins Supabase Storage |
| `suggestions` | text[] | Suggestions IA legacy |
| `doc_date` / `doc_time` | date/time | Date de terrain (peut différer de `created_at`) |
| `lang` | text | Langue de rédaction |
| `reference` | text | Référence externe optionnelle |
| `observations` | text | (voir sections) |
| `status` | text | `draft` / `ready` |
| `created_at` / `updated_at` | timestamptz | Audit |

### RLS
Policies strictes `auth.uid() = user_id` sur SELECT / INSERT / UPDATE / DELETE.
Un agent ne voit **jamais** les données d'un autre. SUPERVISOR ajoutera ses
propres policies (rôle `supervisor`).

---

## 4. Pourquoi `module_type` ?

`module_type` est le **point d'ancrage du routing métier futur**. Il
répond à la question : *"quel module CORE doit traiter cette entrée ?"*.

Choix de design :

- champ **plat, texte, indexable** — pas de FK vers une table modules
  (permet d'ajouter un module sans migration) ;
- rempli **automatiquement** depuis le profil (`organization_type`) — pas
  de choix utilisateur à la saisie ;
- valeur `generic` = fallback sûr, traité par CORE en mode "capture brute".

Ajouter un module se fait en 3 étapes, **sans casser l'existant** :

1. ajouter la nouvelle valeur dans `ModuleType` (`src/lib/offline-store.ts`) ;
2. l'exposer dans `ORGANIZATION_TYPES` (`src/lib/organization-context.ts`) ;
3. implémenter le handler côté CORE.

Aucun changement de schéma DB n'est nécessaire.

---

## 5. Pourquoi `organization_type` ?

`organization_type` vit **sur le profil**, pas sur le document. Raisons :

- un agent appartient à **une** organisation à un instant T ;
- cela évite de demander le contexte à chaque saisie (UX terrain) ;
- si l'agent change d'organisation, ses futures saisies héritent du nouveau
  contexte sans réécrire l'historique.

Mapping `organization_type` → `module_type` centralisé dans
`src/lib/organization-context.ts`. C'est le **seul endroit** à modifier pour
ajouter un domaine métier.

---

## 6. Ajouter un nouveau module (procédure)

Exemple : ajouter un module "Éducation".

1. `src/lib/offline-store.ts` — étendre `ModuleType` :
   ```ts
   export type ModuleType = "agro" | "health" | "ngo" | "generic" | "education";
   ```
2. `src/lib/organization-context.ts` — ajouter l'entrée :
   ```ts
   { key: "education", fr: "Éducation", en: "Education", module: "education", hint: "..." }
   ```
3. (Optionnel) migration Supabase si vous voulez restreindre les valeurs
   côté DB via un CHECK — **non recommandé** : garder le champ ouvert
   facilite l'évolution.
4. Côté CORE (futur) : ajouter le handler `education`.

Aucune modification des écrans de capture n'est nécessaire.

---

## 7. Storage

Buckets privés `recensement-photos` et `recensement-videos`. Chemin :
`<user_id>/<document_id>/<photo_id>.<ext>` (idem pour les vidéos).

RLS storage : écriture (INSERT/UPDATE/DELETE) réservée au propriétaire (via
user_id dans le chemin). Lecture (SELECT) ouverte au propriétaire OU à un
superviseur/admin de la même organisation (`public.can_access_field_media`,
voir migration `20260713120000_...`). Aucun accès public direct : toute
consultation passe par une URL signée à expiration courte (`createSignedUrl`,
1h), jamais par une URL publique permanente. Renommer le bucket serait
cosmétique — le nom historique est conservé pour éviter une migration de
fichiers.

---

## 8. Migrations

Toutes les migrations vivent dans `supabase/migrations/`. Principe :

- **jamais** de migration destructive sur `documents` ou `profiles` ;
- toute nouvelle table CORE / SUPERVISOR est **additive** ;
- les GRANTs sont explicites sur chaque table publique
  (voir directives Supabase Data API).

---

## 9. Cycle de vie d'une entrée

```
draft (client, IndexedDB)
  ├─ pending  → uploading → transcribing → generating → synced (status='ready')
  └─ error    → retry (backoff exponentiel, max 8 tentatives)
```

Une fois `synced`, la ligne `documents` est en lecture seule côté agent
(hors édition manuelle). CORE opère en lecture seule sur cette table et
écrit dans ses propres tables.
