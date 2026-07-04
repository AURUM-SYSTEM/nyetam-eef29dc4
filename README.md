# AURUM COLLECT

Application PWA de capture de données terrain, mobile-first, offline-first.

## Documentation

- [Architecture](./docs/ARCHITECTURE.md) — vision d'ensemble, couches, flux
- [Modèle de données](./docs/DATA_MODEL.md) — tables Supabase, extension modules
- [Roadmap](./docs/ROADMAP.md) — évolutions planifiées (CORE, SUPERVISOR…)

## Stack

TanStack Start · React 19 · Tailwind v4 · Supabase · Lovable AI Gateway ·
IndexedDB · Service Worker.

## Développement

```bash
bun install
bun run dev
```

## Principe

COLLECT est un **moteur de capture générique**. Il ne connaît pas les
métiers (agro, santé, ONG…). Chaque saisie hérite d'un `module_type` depuis
le profil de l'agent — ce champ sert de clef de routing pour la future
couche de traitement AURUM CORE.

Voir [ARCHITECTURE.md](./docs/ARCHITECTURE.md) pour le détail.
