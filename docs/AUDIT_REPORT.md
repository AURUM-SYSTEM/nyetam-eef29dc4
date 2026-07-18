# AURUM AGRO — Rapport d'audit consolidé

> Destiné à toute personne qui rejoint le projet. Ce document rassemble les
> constats de sécurité, d'architecture et de fiabilité relevés au fil des
> sessions d'audit/correction sur ce dépôt, leur statut réel, et ce qu'il
> reste à faire. Il n'est **pas** un journal de commits — pour le détail
> ligne par ligne, voir l'historique git et les migrations citées.
>
> Dernière mise à jour : voir la date du commit qui introduit ce fichier.

## Comment lire ce document

Chaque point est classé :
- **✅ Corrigé** — le correctif est mergé sur cette branche, avec tests
  et/ou vérification décrits.
- **⚠️ Corrigé partiellement / mitigé** — le risque principal est réduit,
  mais une limite structurelle subsiste et est documentée.
- **🔴 À corriger** — identifié, pas encore traité. Priorité et
  recommandation données pour chacun.

---

## 1. Sécurité & accès aux données

### 1.1 — RLS `documents` : modifiable/supprimable après validation ✅ Corrigé

**Constat.** La policy RLS sur `documents` autorisait UPDATE/DELETE sans
condition sur `validated_at` : un document déjà validé par un superviseur
pouvait être réécrit ou supprimé par son auteur (ou n'importe quel agent
propriétaire), ce qui casse la valeur probante de la validation — un
document "validé" n'avait de validé que le nom.

**Correctif** (`supabase/migrations/20260713130000_39ec04c7-...sql`) :
- UPDATE désormais conditionné à `validated_at IS NULL` en `USING` **et**
  `WITH CHECK` (empêche aussi l'auto-validation : un agent ne peut pas
  poser lui-même `validated_at`).
- Policy DELETE supprimée entièrement ; remplacée par
  `public.delete_own_document(_document_id uuid)` (`SECURITY DEFINER`),
  qui refuse tout document déjà validé et journalise la suppression dans
  `audit_log`.
- Le code client (`document.$id.tsx`, `_authenticated.index.tsx`) appelle
  ce RPC au lieu d'un `.delete()` direct ; le bouton de suppression est
  masqué dès que `validated_at` est renseigné.

**Vérifié par** `supabase/tests/database/documents_rls.test.sql` (12
assertions pgTAP) : flux normal préservé (propriétaire peut éditer/
supprimer tant que non validé), verrouillage post-validation, isolation
entre agents, journalisation de la suppression.

**Limite connue** : ce test dépend d'objets (`audit_log`,
`profiles.organization_id`, `delete_own_document`) non couverts par les
migrations versionnées — voir §2.

---

### 1.2 — Buckets Storage publics ✅ Corrigé

**Constat.** `recensement-photos` était un bucket Storage **public**
(`public: true`) — toute photo terrain était accessible par URL directe,
sans authentification, à quiconque devinait/obtenait un chemin.

**Correctif** (`supabase/migrations/20260713120000_30628aef-...sql`) :
- `recensement-photos` passé en privé ; `recensement-videos` créé privé
  dès le départ.
- Fonction `public.can_access_field_media(_owner_user_id uuid)`
  (`SECURITY DEFINER`) : autorise le propriétaire du fichier OU un
  superviseur/admin de la même organisation.
- Policy SELECT unifiée sur `storage.objects` pour les deux buckets.
- Tout accès passe désormais par une URL signée à expiration courte
  (`createSignedUrl`, 1h) — jamais d'URL publique permanente.

---

### 1.3 — Éléments de debug/diagnostic exposés en production ✅ Corrigé

**Constat.** Plusieurs artefacts de diagnostic, ajoutés pendant les
sessions de débogage terrain, étaient restés actifs en production :
- Le panneau `DebugLogPanel` était forcé visible (`forceVisible`) sur
  l'écran de saisie, montrant les logs internes GPS à tout utilisateur.
- Un badge "build \<sha\>" flottant sur chaque écran, et dans le pied de
  page public (login/register), révélait le commit git déployé.
- Un endpoint `/api/debug-env` (non authentifié) révélait le nom d'hôte
  du projet Supabase configuré.
- Le sync engine et les fonctions GPS écrivaient en permanence dans la
  console du navigateur (`console.log`), visible par n'importe quel
  utilisateur ouvrant les DevTools.

**Correctif** :
- `DebugLogPanel` : suppression du bypass `forceVisible` — ne s'affiche
  plus que si `import.meta.env.DEV`, sans exception possible.
- `debug-log.ts` (`debugLog`/`debugWarn`/`debugError`) : no-op complet
  hors développement (ni `console.*`, ni buffer) — les ~15 points d'appel
  `[GPS DEBUG]` dans l'écran de saisie restent dans le code (utiles pour
  un futur diagnostic terrain) mais sont désormais inertes en prod.
- Suppression du badge de build (`__root.tsx`, `PublicFooter.tsx`) et de
  toute la mécanique `__BUILD_SHA__`/`__BUILD_TIME__`
  (`vite.config.ts`, `src/build-info.d.ts` supprimé).
- `/api/debug-env` supprimé ; `/health` conservé (utile pour un
  monitoring d'uptime) mais réduit à `{status:"ok"}`, sans détail
  d'infrastructure.
- `use-sync-engine.ts` : les traces `console.log` permanentes passent par
  un helper `devLog()` gatée en dev ; les vrais `console.error`/`warn`
  (échecs réels) restent actifs — ce ne sont pas des indicateurs de
  debug mais de la visibilité d'erreur légitime.

---

## 2. Schéma & migrations

### 2.1 — Tables sans historique de migration versionné 🔴 À corriger (documenté)

**Constat.** 11 des 13 tables métier existantes en production
(`cooperatives`, `parcelles`, `producers`, `user_roles`, `organizations`,
`audit_log`, `modification_requests`, etc.) n'ont **jamais** été
committées comme migrations `supabase/migrations/`. Le schéma réel du
projet ne vit que dans la base Supabase elle-même et dans
`src/integrations/supabase/types.ts` (généré, pas une source de vérité
fiable pour reconstituer du DDL). Conséquences concrètes :
- Impossible de recréer l'environnement depuis zéro (`supabase db reset`
  ne donnerait qu'un schéma partiel).
- Toute nouvelle migration doit être écrite "à l'aveugle", en supposant la
  structure réelle plutôt qu'en la lisant depuis l'historique — risque
  d'erreur si la production a dérivé sans que quiconque le documente.
- Les migrations les plus récentes de ce projet (RLS `documents`,
  `audit_log`, buckets Storage) ont dû inclure des `CREATE TABLE IF NOT
  EXISTS` défensifs et une documentation explicite de cette dérive,
  précisément pour rester applicables sans savoir avec certitude ce qui
  existe déjà.

**Pourquoi ce n'est toujours pas corrigé.** La reconstruction (Phase 1)
nécessite un `supabase db dump --schema-only` (ou équivalent) exécuté
avec les identifiants du projet réel, converti en migrations organisées.
Aucun environnement de développement de ce projet n'a jamais eu d'accès
réseau sortant vers les domaines Supabase (`*.supabase.co`,
`api.supabase.com`) ni de `DATABASE_URL` — confirmé à plusieurs reprises
(403 systématique). Ce travail ne peut être fait que par quelqu'un ayant
un accès direct au projet Supabase (dashboard, ou CLI avec
`SUPABASE_ACCESS_TOKEN`/`DATABASE_URL`).

**Voir** `supabase/migrations/README.md` pour la liste exacte des tables
concernées et la procédure de reconstruction recommandée.

**Recommandation prioritaire** pour la prochaine personne avec accès
direct à la base : lancer le dump, committer le schéma réel comme
migration baseline (une seule grosse migration "snapshot", horodatée
avant toutes les migrations différentielles déjà écrites), puis confirmer
que `supabase db reset` + rejouer les migrations différentielles
reproduit fidèlement l'état actuel.

---

### 2.2 — Journal d'audit (`audit_log`) ✅ Corrigé

**Constat.** `audit_log` existe déjà en production (schéma différent d'un
journal "générique" classique — colonnes `actor_id`/`entity_type`/
`entity_id`/`old_value`/`new_value`/`organization_id`, pas
`user_id`/`table_name`/`record_id`). Il était alimenté **manuellement**
par endroits (`createParcelle`, `validateDocument`, `attestEudrCompliance`,
...) mais avec des trous silencieux : les créations de coopérative et de
producteur "à la volée" (par nom libre, à l'intérieur de `createParcelle`)
n'étaient journalisées nulle part — découvert en écrivant ce correctif,
pas dans la demande initiale.

**Correctif** (`supabase/migrations/20260714150000_17c5babc-...sql`) :
- Réutilise le schéma existant (pas de table parallèle).
- Trigger générique `audit_log_trigger()` (`SECURITY DEFINER`), attaché
  **uniquement** là où rien n'est déjà journalisé manuellement, pour ne
  jamais dupliquer une entrée : `cooperatives` (UPDATE/DELETE),
  `parcelles` (DELETE), `producers` (DELETE), `documents` (INSERT — couvre
  aussi la création via synchronisation offline, qui insère directement
  avec le client authentifié).
- RLS : lecture réservée aux superviseurs/admins de la même organisation.
- Immuabilité réelle : `REVOKE UPDATE, DELETE` au niveau **GRANT** pour
  `authenticated`, `anon` **et `service_role`** — la RLS seule ne suffit
  pas puisque `service_role` la contourne systématiquement.
- Gap découvert et corrigé dans le même changement : ajout de la
  journalisation manuelle (avec `actor_id` correct) pour les créations de
  coopérative/producteur à la volée dans `createParcelle`
  (`src/lib/agro.functions.ts`).
- Vue superviseur "Journal d'activité" (`listAuditLog`,
  `_authenticated.supervisor.tsx`), filtrable par type d'entité et par
  utilisateur.

**Vérifié par** `supabase/tests/database/audit_log_triggers.test.sql`.

**⚠️ Limite structurelle documentée, pas un bug** : `auth.uid()` (utilisé
par le trigger pour capturer l'auteur) est `NULL` pour toute écriture
faite via `supabaseAdmin` (clé service role — le JWT service role ne
porte pas de claim `sub`), qui est le chemin utilisé pour quasiment
toutes les écritures sur `cooperatives`/`parcelles`/`producers` dans ce
projet. Le trigger reste un filet de sécurité (l'entrée existe toujours,
avec entité/action/horodatage corrects), mais **toute nouvelle fonction
serveur qui écrit sur ces tables via `supabaseAdmin` doit continuer à
journaliser manuellement avec `actor_id: context.userId`**, comme le fait
déjà tout le code existant — ce n'est pas automatique, et rien
n'empêche un futur développeur de l'oublier.

---

## 3. Offline-first & synchronisation

### 3.1 — Capture GPS et calcul de surface : plusieurs bugs ✅ Corrigé

Série de bugs distincts trouvés et corrigés lors du traçage de périmètre
de parcelle (voir `src/lib/geo.ts`, `src/lib/geo-polygon.ts`,
`_authenticated.record.$type.tsx`) :

| Bug | Effet observé | Correctif |
|---|---|---|
| `captureGps()` gardait la position historiquement la plus précise, pas la plus récente | Position figée alors que l'agent s'était déplacé | `latest`/`best` toujours réécrasé, l'accuracy ne sert qu'à sortir plus tôt |
| Abandon immédiat sur toute erreur `watchPosition` | GPS abandonné sur une erreur transitoire (`TIMEOUT`, `POSITION_UNAVAILABLE`) | Abandon immédiat réservé à `PERMISSION_DENIED` uniquement |
| Cache GPS de 5 min appliqué aussi aux points de périmètre | Points de périmètre identiques malgré un déplacement réel → aire nulle | `maximumAgeMs=0` forcé pour chaque point de périmètre |
| `newSurface` jamais renseigné après calcul | Surface calculée mais jamais reportée dans le champ envoyé au serveur | `setNewSurface(formatSurfaceHa(area))` ajouté |
| Affichage `.toFixed(2)` sur petites surfaces | `0.00 ha` indiscernable d'un vrai bug de calcul | `formatSurfaceHa()` (4 décimales si < 0.01 ha) + équivalent m² toujours affiché |
| Seuil anti-doublon de point calé sur l'accuracy GPS | Rejetait quasiment tous les points dès que la précision GPS était mauvaise (ex. ±700 m) | Seuil fixe `DUPLICATE_POINT_THRESHOLD_M = 5` m, indépendant de l'accuracy |
| Détection de doublon calculait `minDist` mais n'empêchait pas l'ajout | Périmètre à points dupliqués → aire dégénérée = 0 | Rejet effectif (`return` avant `setBoundaryPoints`) |

**Vérifié par** `src/lib/geo-polygon.test.ts` (20 tests unitaires,
incluant les cas réels de terrain qui ont révélé ces bugs) + confirmation
terrain explicite de l'utilisateur à chaque étape.

---

### 3.2 — État "GPS capturé" qui fuit entre deux saisies ✅ Corrigé

**Constat.** Le brouillon persistant de l'écran de saisie (IndexedDB,
`recordDraft` — conçu pour survivre à un rechargement de page accidentel)
n'était vidé qu'après un enregistrement réussi. Quitter l'écran sans
enregistrer laissait l'ancien GPS résident, et il resurgissait tel quel à
la saisie suivante — y compris pour une mission sans rapport, car le
brouillon est global, pas scopé par mission.

**Correctif, en deux passes** (la première insuffisante, corrigée après
retour terrain) :
1. D'abord : vidage du brouillon au clic sur le bouton "retour" — ne
   couvrait pas le bouton/geste de retour matériel du téléphone (Android),
   qui ne déclenche pas ce `onClick`.
2. Version retenue : nettoyage au **démontage du composant** (`useEffect`
   cleanup), qui se déclenche pour toute sortie de l'écran quel qu'en soit
   le déclencheur — un vrai rechargement de page, lui, ne déclenche jamais
   ce nettoyage (aucun code React ne s'exécute), donc la reprise après un
   rechargement accidentel reste intacte.

**Confirmé sur le terrain** par l'utilisateur après la seconde passe.

---

### 3.3 — Création de parcelle/producteur impossible hors-ligne ✅ Corrigé (bug critique)

**Constat.** `handleCreateParcelle` appelait `createParcelle` — une
fonction serveur (TanStack Start `createServerFn`), donc un appel réseau
direct — au moment de la soumission. Contrairement aux documents
(`enqueue()` → IndexedDB → sync engine en arrière-plan), la création de
parcelle (mission "Recensement des plantations", y compris coopérative/
producteur créés à la volée par nom libre dans le même appel) n'avait
**aucun** chemin hors-ligne : elle échouait systématiquement sans réseau.

**Correctif** :
- Nouveau store IndexedDB `pendingParcelles`
  (`src/lib/offline-store.ts`, `DB_VERSION` 9) : une création hors-ligne
  est stockée localement avec un id temporaire
  (`LOCAL_PARCELLE_ID_PREFIX + id`) au lieu d'échouer.
- `useSyncEngine` (`src/hooks/use-sync-engine.ts`) traite cette file
  **avant** celle des documents à chaque passe, en rejouant le **même**
  appel `createParcelle` — donc la même détection de doublon et la même
  journalisation `audit_log` que le flux en ligne, pas une version
  dégradée. Une fois synchronisée, l'id temporaire est remappé vers le
  vrai id sur tout document en file qui la référençait (référence
  croisée document ↔ parcelle créée dans la même session).
- Un document dont la parcelle n'est pas encore résolue est mis de côté
  (pas d'échec, pas de tentative consommée) jusqu'à résolution.
- Doublon détecté seulement à la synchronisation (impossible à vérifier
  hors-ligne) : passe en état "conflit", affiché sur la nouvelle page
  `/parcelles` (`PendingParcellesQueue.tsx`) avec la même option "créer
  quand même + justification" que l'écran de saisie en ligne — jamais
  d'auto-décision silencieuse.
- L'écran de saisie affiche "Parcelle enregistrée hors-ligne — en attente
  de synchronisation" ; le lien vers la parcelle est aussi persisté dans
  le brouillon pour survivre à un rechargement pendant la création.
- Complément livré ensuite : les parcelles en attente de synchronisation
  apparaissent aussi dans la liste de sélection des missions "Visite de
  parcelle"/"Suivi de parcelle" (marquées "⏳ en attente de sync"), avec
  le même remapping d'id pour le document de visite qui en découle.

**Nouvelles pages agent** (`_authenticated.parcelles.tsx` et
`.producteurs.tsx`) : accès rapide depuis l'accueil, réutilisent
`listParcelles`/`listProducers` (déjà scopées par organisation, déjà
appelables par n'importe quel agent — pas réservées aux superviseurs).

---

### 3.4 — Idempotence de la synchronisation offline (documents) 🔴 À corriger

**Constat.** Le sync engine (`processOne` dans `use-sync-engine.ts`)
insère la ligne `documents` puis continue le traitement (upload
photos/vidéos, structuration CORE) avant de marquer l'item de la file
`status: "synced"`. Si l'exécution est interrompue **après** l'insertion
Supabase réussie mais **avant** l'appel `updateQueueItem(item.id,
{status:"synced", remoteDocId: ...})` — app fermée, onglet tué, coupure
réseau brutale au mauvais moment — l'item reste dans un état encore
"en cours" (`generating`, potentiellement `uploading`/`transcribing`
selon où l'interruption survient). Le prochain passage du sync engine
(`runPass`) considère cet item comme encore à traiter (le filtre inclut
`status === "generating"` etc.) et rejoue `processOne` **depuis le
début** — y compris un **second** `.insert()` sur `documents`, sans
aucune vérification qu'un document correspondant existe déjà.

**Impact concret** : un document en double en base, avec le même
contenu/transcript, dans les cas (rares mais réels sur le terrain, où les
coupures réseau/redémarrages d'app sont fréquents) où l'interruption tombe
dans cette fenêtre. Aucune alerte, aucune détection automatique
aujourd'hui — l'agent ou un superviseur doit le remarquer visuellement
(deux entrées identiques dans "Documents récents"/le tableau de bord).

**Recommandation** : introduire une clé d'idempotence côté client (ex.
l'`id` local du `QueueItem`, déjà stable et généré une seule fois),
stockée dans une colonne dédiée sur `documents` (ou vérifiée via un
`upsert` avec contrainte d'unicité sur cette clé) avant de considérer
l'insertion comme la source de vérité. Alternative plus légère à court
terme : avant l'`.insert()`, vérifier par une requête si un document avec
ce `client_queue_id` existe déjà pour cet agent, et sauter directement à
l'étape suivante (upload médias) si oui.

**Portée** : ce n'est pas un régression introduite dans cette session —
c'est un gap préexistant, remonté ici parce que le travail sur
`pendingParcelles` (§3.3) a nécessité de lire en détail ce pipeline. Le
correctif `pendingParcelles` lui-même n'a **pas** ce problème pour la
détection de doublon métier (elle est gérée explicitement, voir §3.3),
mais partage une variante plus bénigne du même risque de timing : voir
§3.5.

---

### 3.5 — `pendingParcelles` : entrée bloquée en "syncing" si interrompue 🔴 À corriger (mineur)

**Constat.** Pendant la synchronisation d'une parcelle en attente,
`processParcelle()` marque l'entrée `status: "syncing"` avant l'appel
réseau. Si l'exécution est interrompue à ce moment précis (avant que le
`try`/`catch` ne retombe sur un état final `synced`/`conflict`/`error`),
l'entrée reste bloquée en `"syncing"` indéfiniment : le filtre de
re-traitement (`toSync` dans `processParcelleQueue`) ne considère que les
statuts `"pending"` et `"error"` éligible au retry, jamais `"syncing"`.

**Impact** : plus rare que §3.4 (fenêtre de temps plus courte — un seul
appel réseau, pas plusieurs étapes), et sans risque de duplication (rien
n'est réinséré), mais l'agent voit indéfiniment "Synchronisation…" sur
`/parcelles` sans que rien ne se passe, sans message d'erreur ni option
de réessayer.

**Recommandation** : au démarrage de `processParcelleQueue`, réinclure
dans `toSync` les entrées `"syncing"` dont `updatedAt` dépasse un délai
raisonnable (ex. 2 minutes) — signe qu'un passage précédent a été
interrompu avant de conclure.

---

## 4. Interface & thème

### 4.1 — `.glass-card`/`.gold-border` figés en thème sombre ✅ Corrigé

**Constat.** En mode clair, les cartes `glass-card` (accès rapide,
documents récents, listes parcelles/producteurs, formulaire de saisie,
tableau de bord superviseur) gardaient un fond et une bordure calés sur
les valeurs littérales du thème sombre — ces deux classes CSS codaient en
dur une couleur `oklch(...)` du thème sombre au lieu de référencer les
variables théme-aware `--card`/`--gold` (qui, elles, changeaient déjà
correctement). Résultat : texte illisible en thème clair.

**Correctif** (`src/styles.css`) : nouvelles variables `--glass-bg`,
`--glass-border`, `--gold-border-tint`, définies séparément dans les
blocs `:root` (sombre) et `:root.light` avec la même teinte/transparence
qu'avant — juste dérivées de la bonne couleur de carte/or selon le thème
actif.

**Vérifié visuellement** (Playwright, page publique `/about` qui partage
la même classe) dans les deux thèmes. Non vérifié en conditions réelles
sur les écrans authentifiés (accueil, `/parcelles`, `/producteurs`,
tableau de bord) faute d'accès réseau Supabase dans l'environnement de
développement utilisé pour cette session — mais tous ces écrans
utilisent la même classe partagée sans surcharge de fond, confirmé par
lecture de code.

---

## 5. Récapitulatif

| # | Sujet | Statut |
|---|---|---|
| 1.1 | RLS `documents` modifiable après validation | ✅ Corrigé |
| 1.2 | Buckets Storage publics | ✅ Corrigé |
| 1.3 | Debug/build indicators en production | ✅ Corrigé |
| 2.1 | Tables sans migration versionnée (schema drift) | 🔴 À corriger — bloqué par accès réseau/DB |
| 2.2 | Journal d'audit (`audit_log`) automatique | ✅ Corrigé |
| 2.2 | Limite structurelle `auth.uid()` NULL sous `service_role` | ⚠️ Documenté, convention manuelle requise |
| 3.1 | Bugs GPS/surface (7 bugs distincts) | ✅ Corrigé |
| 3.2 | Fuite d'état "GPS capturé" entre saisies | ✅ Corrigé |
| 3.3 | Création parcelle/producteur impossible hors-ligne | ✅ Corrigé |
| 3.4 | Idempotence sync documents (doublon possible sur interruption) | 🔴 À corriger |
| 3.5 | `pendingParcelles` bloquée en "syncing" si interrompue | 🔴 À corriger (mineur) |
| 4.1 | Thème clair : cartes illisibles | ✅ Corrigé |

---

## 6. Prochaines priorités suggérées

1. **Reconstruction des migrations (§2.1)** — bloquant pour toute
   personne qui voudrait un environnement de dev reproductible ou un
   second environnement (staging propre). Nécessite un accès direct au
   projet Supabase.
2. **Idempotence de la synchronisation (§3.4)** — risque de données
   dupliquées en production, silencieux. À traiter avant d'augmenter le
   volume d'agents terrain sur connexions instables.
3. **`pendingParcelles` bloquée en "syncing" (§3.5)** — correctif simple
   (fenêtre de timeout), à faire en même temps que §3.4 puisque les deux
   touchent le même pipeline.
