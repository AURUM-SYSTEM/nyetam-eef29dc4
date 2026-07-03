// Organization context — metadata only.
//
// AURUM COLLECT is sector-agnostic. Every user inherits an organization
// context (organization_type) which determines the `module_type` attached
// to every new field entry. CORE (the future processing layer) reads
// `module_type` to route the entry to the appropriate business module.
//
// No business logic in Collect depends on these values — they are pure
// metadata forwarded downstream.

import type { ModuleType } from "@/lib/offline-store";

export type OrganizationType = "agriculture" | "health" | "ngo" | "generic";

export const ORGANIZATION_TYPES: Array<{
  key: OrganizationType;
  fr: string;
  en: string;
  module: ModuleType;
  hint: string;
}> = [
  { key: "generic",     fr: "Générique",   en: "Generic",     module: "generic", hint: "Aucun domaine spécifique" },
  { key: "agriculture", fr: "Agriculture", en: "Agriculture", module: "agro",    hint: "Coopératives, exploitations, filières agricoles" },
  { key: "health",      fr: "Santé",       en: "Health",      module: "health",  hint: "Cliniques, campagnes sanitaires, terrain médical" },
  { key: "ngo",         fr: "ONG",         en: "NGO",         module: "ngo",     hint: "Organisations humanitaires et sociales" },
];

export function moduleForOrgType(t: string | null | undefined): ModuleType {
  const found = ORGANIZATION_TYPES.find((o) => o.key === t);
  return found?.module ?? "generic";
}

export function labelForOrgType(t: string | null | undefined, lang: "fr" | "en" = "fr"): string {
  const found = ORGANIZATION_TYPES.find((o) => o.key === t);
  if (!found) return lang === "en" ? "Generic" : "Générique";
  return lang === "en" ? found.en : found.fr;
}
