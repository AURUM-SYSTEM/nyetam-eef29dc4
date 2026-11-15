# DO Fast

**Slogan :** « Tes démarches, faites vite. »

Application web mobile-first de recherche de prestataires vérifiés pour les services du quotidien à Douala, Cameroun.

## Fonctionnement actuel
- Le client choisit un service et un quartier.
- Il peut aussi rechercher un prestataire par son nom.
- L'application affiche uniquement les prestataires dont l'identité a été approuvée, qui sont vérifiés et disponibles.
- Chaque fiche affiche le nom public, la présentation, la note, les missions terminées, les services, les tarifs et les quartiers couverts.
- Les numéros de téléphone, pièces d'identité et données privées ne sont jamais affichés dans l'annuaire.
- Les services, quartiers et profils sont lus depuis le projet Supabase dédié à DO Fast.

## Identité
- Nom exact : **DO Fast**
- Slogan : **« Tes démarches, faites vite. »**
- Vert : `#0B6B4B`
- Jaune : `#F5B700`
- Monnaie : FCFA
- Langue : français

## Base de données
- Projet Supabase indépendant : `DO Fast`, région `eu-west-1`.
- Le répertoire public utilise la vue `public_provider_directory`.
- La vue ne renvoie que des champs de présentation non sensibles et uniquement les profils approuvés, vérifiés et disponibles.
- Les tables sources conservent RLS. Des autorisations de lecture limitées aux colonnes publiques sont utilisées pour l'annuaire.
- Aucune donnée de prestataire fictive n'est affichée.

## Limite actuelle à connaître
La base ne contient actuellement aucun profil prestataire enregistré. L'annuaire est raccordé et prêt à afficher les profils réels dès qu'ils auront été créés et validés. L'inscription des prestataires, la prise de mission, les paiements, le chat et le tableau d'administration ne font pas partie de cette version simplifiée.

## Fichiers
- `index.html` : interface de recherche.
- `styles.css` : design mobile-first.
- `app.js` : filtres et chargement du répertoire.
- `supabase-config.js` : configuration publique du projet DO Fast.

Le dossier `projects/do-fast/` reste indépendant d'AURUM SYSTEM.
