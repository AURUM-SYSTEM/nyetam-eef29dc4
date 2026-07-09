// Couche métier — secteurs d'activité figés.
// AUCUNE extension sans demande explicite.

export type SectorKey = "ong_humanitaire" | "sante" | "collecte_recensement" | "autre";

export const SECTORS: { key: SectorKey; fr: string; en: string }[] = [
  { key: "ong_humanitaire",      fr: "ONG humanitaire",           en: "Humanitarian NGO" },
  { key: "sante",                fr: "Santé",                     en: "Health" },
  { key: "collecte_recensement", fr: "Collecte / Recensement",    en: "Data collection / Census" },
  { key: "autre",                fr: "Autre",                     en: "Other" },
];

export const SECTOR_CONTEXT: Record<SectorKey, { fr: string; en: string }> = {
  ong_humanitaire: {
    fr: "Secteur ONG humanitaire. Vocabulaire attendu : bénéficiaires, ménages, kits, distribution, vulnérabilité, redevabilité, protection, partenaires terrain, bailleurs. Mentionner si pertinent : standards humanitaires (Sphère, CHS), groupes vulnérables, accès humanitaire.",
    en: "Humanitarian NGO sector. Expected vocabulary: beneficiaries, households, kits, distribution, vulnerability, accountability, protection, field partners, donors. Mention when relevant: humanitarian standards (Sphere, CHS), vulnerable groups, humanitarian access.",
  },
  sante: {
    fr: "Secteur santé. Vocabulaire attendu : patients, consultations, pathologies, dépistage, vaccination, prise en charge, protocole, équipement médical, indicateurs sanitaires. Rester factuel, jamais de diagnostic inventé.",
    en: "Health sector. Expected vocabulary: patients, consultations, pathologies, screening, vaccination, care management, protocol, medical equipment, health indicators. Stay factual, never invent diagnoses.",
  },
  collecte_recensement: {
    fr: "Secteur collecte de données / recensement. Vocabulaire attendu : enquêtés, ménages, échantillon, zone d'enquête, questionnaire, taux de couverture, données quantitatives, méthodologie de collecte.",
    en: "Data collection / census sector. Expected vocabulary: respondents, households, sample, survey area, questionnaire, coverage rate, quantitative data, collection methodology.",
  },
  autre: {
    fr: "Secteur générique. Adopter un vocabulaire neutre et professionnel adapté au contexte décrit dans la transcription.",
    en: "Generic sector. Use neutral, professional vocabulary aligned with the context described in the transcript.",
  },
};

export function getSectorLabel(key: string | null | undefined, lang: "fr" | "en"): string {
  const s = SECTORS.find((s) => s.key === key);
  if (!s) return lang === "en" ? "Humanitarian NGO" : "ONG humanitaire";
  return lang === "en" ? s.en : s.fr;
}

export function getSectorContext(key: string | null | undefined, lang: "fr" | "en"): string {
  const k = (SECTORS.find((s) => s.key === key)?.key ?? "ong_humanitaire") as SectorKey;
  return SECTOR_CONTEXT[k][lang];
}
