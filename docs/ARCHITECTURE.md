# AURUM SYSTEM — Architecture Technique

> Document destiné à tout développeur Full Stack (ou CTO) reprenant le projet.
> Il décrit l'architecture actuelle du MVP **AURUM COLLECT** et sa place dans
> la vision d'ensemble du système AURUM.

---

## 1. Vue d'ensemble

AURUM est une plateforme de **capture et traitement de données terrain**.
Elle est volontairement découpée en trois couches indépendantes :

```
┌────────────────────┐      ┌──────────────────┐      ┌──────────────────────┐
│  AURUM COLLECT     │ ───▶ │   AURUM CORE     │ ───▶ │  AURUM SUPERVISOR    │
│  (Field App / PWA) │      │  (Processing)    │      │  (Dashboard Web)     │
└────────────────────┘      └──────────────────┘      └──────────────────────┘
        │                            │                          │
        └──────── Supabase (DB + Auth + Storage) ────────────────┘
```

- **COLLECT** = application mobile-first (PWA) utilisée par les agents terrain.
  C'est le seul composant implémenté aujourd'hui.
- **CORE** = couche de traitement (à venir). Elle lira les entrées produites
  par COLLECT, les enrichira, les normalisera et les routera vers les modules
  métiers (Agro, Santé, ONG…).
- **SUPERVISOR** = dashboard web (à venir) destiné aux superviseurs,
  coordinateurs et responsables d'organisation.

Les trois briques partagent **une seule base Supabase** (source de vérité).
Aucune duplication de données n'est prévue.

---

## 2. AURUM COLLECT — Responsabilités

COLLECT est un **moteur de capture générique**. Il ne "comprend" pas ce qu'il
collecte : il stocke des données structurées destinées à CORE.

Responsabilités :

1. Authentification (email/password + OAuth Google via broker Lovable).
2. Capture terrain :
   - audio (enregistrement + transcription IA),
   - texte libre,
   - photos,
   - géolocalisation (GPS + reverse geocoding).
3. File d'attente offline-first (IndexedDB) et synchronisation opportuniste.
4. Persistance dans Supabase (`documents`) avec le contexte organisationnel
   de l'utilisateur (`module_type`).
5. Consultation de son propre historique (RLS `auth.uid() = user_id`).

Ce que COLLECT **ne fait pas** (et ne doit pas faire) :

- pas de génération de rapport structuré pour les nouvelles saisies
  (`field_entry`) — le pipeline IA legacy reste actif uniquement pour les
  anciens types (`rapport`, `pv`, `enquete`, `recensement`) ;
- pas d'analytics, pas de supervision multi-utilisateurs ;
- pas d'export administrateur, pas d'accès aux données d'autres agents ;
- pas de logique métier spécifique à un domaine (agro, santé, ONG…).

---

## 3. AURUM CORE — Rôle futur

CORE est la couche de traitement asynchrone. Elle sera implémentée dans un
second temps, sans modification structurelle de COLLECT.

Missions attendues :

- lire les nouvelles lignes `documents` (via webhook, cron ou trigger DB) ;
- normaliser le transcript brut (nettoyage, structuration) ;
- router chaque entrée vers un **module métier** en fonction de `module_type`
  (voir §5 du document `DATA_MODEL.md`) ;
- générer les sorties métier (rapports, indicateurs, fiches structurées) ;
- écrire les résultats dans de nouvelles tables (`core_outputs`, `analytics`…)
  sans jamais modifier la ligne source.

CORE peut être implémenté comme worker externe, edge functions Supabase, ou
service Node/Python dédié — le choix est libre.

---

## 4. AURUM SUPERVISOR — Rôle futur

SUPERVISOR est le dashboard web des superviseurs. Il consommera la même base
Supabase que COLLECT.

Fonctionnalités attendues :

- vision consolidée des saisies d'une organisation ;
- filtres par module, agent, période, géographie ;
- validation / annotation des entrées ;
- exports (CSV, PDF, API) ;
- gestion des rôles et invitations.

Prérequis techniques (documentés mais **non implémentés**) :

- table `user_roles` + enum `app_role` + fonction `has_role()` ;
- policies RLS supplémentaires pour ouvrir les SELECT aux rôles
  `supervisor` / `admin` (sans toucher aux policies existantes de COLLECT).

Voir `ROADMAP.md` pour le détail.

---

## 5. Flux de données

### 5.1 Capture d'une entrée terrain (nominal)

```
[Agent]
  │  1. enregistre audio + photos + GPS
  ▼
[IndexedDB]  ── file d'attente offline (offline-store.ts)
  │  2. sync engine détecte connexion
  ▼
[Server Fn: transcribeAudio]  ── Lovable AI Gateway (Gemini)
  │  3. transcript texte
  ▼
[Server Fn: reverseGeocode]  ── résolution ville / pays
  │
  ▼
[Insert Supabase.documents]  ── type = 'field_entry', module_type = <profil>
  │
  ▼
[CORE (futur)]  ── lit, normalise, route vers module métier
  │
  ▼
[SUPERVISOR (futur)]  ── affichage dashboard
```

### 5.2 Contexte organisationnel

Le `module_type` n'est **jamais choisi à la saisie**. Il est hérité du
profil utilisateur (`profiles.organization_type` → mapping dans
`src/lib/organization-context.ts`). Cela garantit que :

- un même agent produit toujours des entrées cohérentes ;
- changer d'organisation ne casse pas l'historique ;
- ajouter un nouveau module se fait sans modifier les écrans de capture.

---

## 6. Stack technique

| Couche | Technologie |
|---|---|
| Framework | TanStack Start v1 (React 19, Vite 7, SSR Edge) |
| Styling | Tailwind CSS v4, shadcn/ui |
| État serveur | TanStack Query |
| Backend | Supabase (Postgres + Auth + Storage) |
| IA | Lovable AI Gateway (Gemini 2.5 Flash) |
| Offline | IndexedDB (via `idb`) + Service Worker |
| Server logic | `createServerFn` (`@tanstack/react-start`) |

---

## 7. Organisation du code

```
src/
├── routes/                   # Routing fichier TanStack (voir routeTree.gen.ts)
│   ├── __root.tsx            # Layout racine + providers
│   ├── _authenticated.tsx    # Gate d'auth (redirect /login)
│   ├── _authenticated.index.tsx        # Accueil agent
│   ├── _authenticated.new.tsx          # Nouvelle saisie (unifiée)
│   ├── _authenticated.record.$type.tsx # Écran de capture
│   ├── _authenticated.recensements.tsx # "Mes saisies" (historique perso)
│   └── ...
├── hooks/
│   ├── use-auth.ts           # Contexte Supabase Auth + profil
│   └── use-sync-engine.ts    # Boucle de synchro offline → cloud
├── lib/
│   ├── aurum.functions.ts    # Server functions IA (transcribe, generate…)
│   ├── offline-store.ts      # IndexedDB (queue, audio, photos)
│   ├── organization-context.ts # Mapping org_type → module_type
│   ├── document-types.ts     # Normalisation legacy → schéma DB
│   └── pdf.ts                # Export PDF côté client
└── integrations/supabase/    # Clients Supabase (auto-générés — ne pas éditer)
```

---

## 8. Compatibilité et migration

L'application est **backward compatible** :

- les types legacy (`rapport`, `pv`, `enquete`, `recensement`, `mission_terrain`)
  continuent d'être lisibles et affichables ;
- les nouvelles saisies utilisent `field_entry` (neutre, sans génération
  structurée) ;
- aucune migration destructive n'a été effectuée sur `documents`.

Voir `DATA_MODEL.md` pour le détail des colonnes et de leur cycle de vie.
