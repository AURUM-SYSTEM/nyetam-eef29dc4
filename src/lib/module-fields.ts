// ─────────────────────────────────────────────────────────────────────────
// MODULE FIELDS — Champs de saisie spécifiques par contexte métier
//
// Chaque module (agro / santé / ONG) ajoute quelques champs structurés en
// plus de la capture libre (audio/texte/photo/vidéo/GPS). Ces valeurs sont
// saisies directement par l'agent (contrairement à `core_outputs`, qui est
// déduit par l'IA) et stockées telles quelles dans `documents.field_data`
// (colonne JSONB additive — aucune contrainte de schéma côté DB).
//
// Ajouter un module = ajouter une entrée ici, rien d'autre à toucher.
// ─────────────────────────────────────────────────────────────────────────
import type { ModuleType } from "./offline-store";

export type ModuleFieldDef = {
  key: string;
  label: string;
  type: "text" | "number";
  placeholder?: string;
  unit?: string;
};

export const MODULE_FIELDS: Record<ModuleType, ModuleFieldDef[]> = {
  agro: [
    { key: "culture", label: "Culture concernée", type: "text", placeholder: "Ex : maïs, cacao, manioc…" },
    { key: "surface_ha", label: "Surface", type: "number", unit: "ha" },
    { key: "nb_parcelles", label: "Nombre de parcelles", type: "number" },
    { key: "rendement_estime", label: "Rendement estimé", type: "text", placeholder: "Ex : 2,5 t/ha" },
  ],
  health: [
    { key: "nb_patients", label: "Nombre de patients", type: "number" },
    { key: "pathologie", label: "Pathologie / motif", type: "text" },
    { key: "structure_sante", label: "Structure de santé", type: "text", placeholder: "Ex : Centre de santé de…" },
  ],
  ngo: [
    { key: "nb_beneficiaires", label: "Nombre de bénéficiaires", type: "number" },
    { key: "type_aide", label: "Type de distribution / aide", type: "text", placeholder: "Ex : vivres, kits d'hygiène…" },
    { key: "zone_intervention", label: "Zone d'intervention", type: "text" },
  ],
  generic: [],
};

export function fieldsForModule(moduleType: ModuleType | undefined | null): ModuleFieldDef[] {
  return MODULE_FIELDS[moduleType ?? "generic"] ?? [];
}
