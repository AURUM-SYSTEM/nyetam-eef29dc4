# DO Fast

**Slogan :** « Tes démarches, faites vite. »

Application web mobile-first de mise en relation entre clients et prestataires vérifiés pour les services du quotidien à Douala, Cameroun.

## Identité
- Nom exact : **DO Fast**
- Vert profond : `#0B6B4B`
- Jaune : `#F5B700`
- Monnaie : FCFA
- Langue : français

## Aperçu local
Ouvrir `index.html` dans un navigateur moderne ou servir le dossier avec un serveur statique.

## Démonstrateur inclus
- Parcours client : catalogue, quartier, choix du mode « Lancer à tous » ou « Choisir moi-même », estimation des frais, création et suivi des demandes.
- Calcul des frais : `MAX(15 % du prix, 300 FCFA)`, modifiable dans les réglages admin.
- Parcours prestataire de démonstration : disponibilité, acceptation atomique simulée dans l'état local, démarrage après confirmation du paiement et envoi d'une photo de preuve.
- Administration de démonstration : validation/suspension des profils, confirmation manuelle des paiements, suivi des reversements, litiges, notes, statistiques, quartiers, commission et numéros de paiement test.
- Données de démonstration persistées dans le navigateur via `localStorage`.

## Comptes / modes de démonstration
- Espace client par défaut.
- Depuis **Compte**, passer à l'espace prestataire ou au tableau de bord admin.
- Les profils et demandes de démonstration sont locaux au navigateur.

## Connexion Supabase — première étape réalisée
- Projet Supabase indépendant : `DO Fast` (région `eu-west-1`).
- Client JavaScript `@supabase/supabase-js` épinglé à `2.119.0` et clé publishable dédiée au projet (aucune clé secrète dans le navigateur).
- Le catalogue des services et des quartiers est maintenant chargé depuis la base DO Fast.
- Schéma initial créé avec profils, prestataires, services, zones, demandes, paiements déclarés, preuves, avis et messages. RLS activé sur toutes les tables.
- Les parcours de création/suivi de mission, paiement et administration restent encore en démonstration locale : ils ne sont pas encore persistés ni exécutés côté serveur.

## Architecture et sécurité — prochaine étape
Ce dossier est volontairement isolé de l'application AURUM existante. Le prototype ne doit pas être considéré comme prêt pour des transactions réelles : il n'intègre pas encore l'authentification SMS/email, la base de données distante, le stockage privé des CNI, les notifications push, le chat temps réel, ni la confirmation de paiement côté serveur.

Avant toute mise en production :
1. Créer un projet/base de données isolé pour DO Fast.
2. Mettre en place les politiques d'accès serveur (RLS) et les rôles client/prestataire/admin.
3. Stocker les CNI dans un bucket privé, accessible uniquement à l'admin autorisé.
4. Garantir l'attribution unique d'une demande par transaction SQL atomique.
5. Déplacer les transitions de paiement et reversement dans des fonctions serveur auditées.
6. Ajouter un adaptateur de paiement (Notch Pay ultérieurement), sans exposer les secrets côté navigateur.
7. Implémenter chat privé, notifications et journal d'audit.
8. Configurer un déploiement statique dédié, sans changer le build/deploy AURUM.

**Important :** aucun numéro Mobile Money réel n'est préconfiguré. Les numéros affichés sont des valeurs de test modifiables depuis l'administration.
