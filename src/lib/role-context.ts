// Couche métier — rôles figés.
// AUCUNE extension sans demande explicite.
import { getSectorContext, getSectorLabel } from "./sector-context";


export type RoleKey = "agent_terrain" | "superviseur" | "enqueteur" | "coordinateur" | "chef_projet";

export const ROLES: { key: RoleKey; fr: string; en: string }[] = [
  { key: "agent_terrain", fr: "Agent terrain",    en: "Field agent" },
  { key: "superviseur",   fr: "Superviseur",      en: "Supervisor" },
  { key: "enqueteur",     fr: "Enquêteur",        en: "Investigator" },
  { key: "coordinateur",  fr: "Coordinateur",     en: "Coordinator" },
  { key: "chef_projet",   fr: "Chef de projet",   en: "Project manager" },
];

export const ROLE_CONTEXT: Record<RoleKey, { fr: string; en: string }> = {
  agent_terrain: {
    fr: "Rôle : agent terrain. Ton attendu : descriptif, factuel, observations directes du terrain. Privilégier les constats concrets, l'environnement immédiat, les actions réalisées.",
    en: "Role: field agent. Expected tone: descriptive, factual, direct field observations. Favour concrete findings, immediate environment, actions carried out.",
  },
  superviseur: {
    fr: "Rôle : superviseur. Ton attendu : synthétique, encadrant, met en avant le suivi des équipes, le respect des procédures et les écarts constatés. Suggestions axées contrôle qualité et appui aux agents.",
    en: "Role: supervisor. Expected tone: synthetic, managerial, highlights team monitoring, procedure compliance and observed gaps. Suggestions focus on quality control and agent support.",
  },
  enqueteur: {
    fr: "Rôle : enquêteur. Ton attendu : méthodique, précis sur la collecte, mentionne l'échantillon, le questionnaire, les conditions d'enquête. Suggestions axées rigueur méthodologique.",
    en: "Role: investigator. Expected tone: methodical, precise on data collection, mentions sample, questionnaire and survey conditions. Suggestions focus on methodological rigour.",
  },
  coordinateur: {
    fr: "Rôle : coordinateur. Ton attendu : transversal, met en relation les acteurs, souligne la coordination inter-équipes, les partenaires et les ressources mobilisées.",
    en: "Role: coordinator. Expected tone: cross-cutting, links stakeholders, highlights inter-team coordination, partners and mobilised resources.",
  },
  chef_projet: {
    fr: "Rôle : chef de projet. Ton attendu : stratégique, orienté objectifs, indicateurs, budget, calendrier, risques, décisions à arbitrer. Suggestions axées pilotage et redevabilité bailleur.",
    en: "Role: project manager. Expected tone: strategic, goal-oriented, indicators, budget, schedule, risks, decisions to arbitrate. Suggestions focus on steering and donor accountability.",
  },
};

export function getRoleLabel(key: string | null | undefined, lang: "fr" | "en"): string {
  const r = ROLES.find((r) => r.key === key);
  if (!r) return lang === "en" ? "Field agent" : "Agent terrain";
  return lang === "en" ? r.en : r.fr;
}

export function getRoleContext(key: string | null | undefined, lang: "fr" | "en"): string {
  const k = (ROLES.find((r) => r.key === key)?.key ?? "agent_terrain") as RoleKey;
  return ROLE_CONTEXT[k][lang];
}

// Couche métier fusionnée — utilisée par l'IA comme contexte supplémentaire.
export function buildMetierContext(
  sector: string | null | undefined,
  role: string | null | undefined,
  lang: "fr" | "en",
): string {
  const header = lang === "en"
    ? `Author business context — Sector: ${getSectorLabel(sector, lang)} | Role: ${getRoleLabel(role, lang)}.`
    : `Contexte métier de l'auteur — Secteur : ${getSectorLabel(sector, lang)} | Rôle : ${getRoleLabel(role, lang)}.`;
  return [
    header,
    getSectorContext(sector, lang),
    getRoleContext(role, lang),
    lang === "en"
      ? "Use this context to adapt vocabulary and tone ONLY. NEVER invent facts. NEVER change the section structure."
      : "Utilise ce contexte pour adapter UNIQUEMENT le vocabulaire et le ton. N'INVENTE JAMAIS de faits. NE MODIFIE JAMAIS la structure des sections.",
  ].join("\n");
}
