// Central normalization for DB `documents.type`. The DB check constraint
// only allows: rapport | pv | recensement | enquete. Always pass any
// candidate string through normalizeDocumentType() before insert/update.

export const DOCUMENT_TYPES = {
  rapport: "rapport",
  pv: "pv",
  recensement: "recensement",
  enquete: "enquete",
} as const;

export type DocumentType = (typeof DOCUMENT_TYPES)[keyof typeof DOCUMENT_TYPES];

export function normalizeDocumentType(value: string | null | undefined): DocumentType {
  const v = (value ?? "").toLowerCase().trim();
  if (!v) return "rapport";
  if (v === "rapport" || v === "pv" || v === "recensement" || v === "enquete") return v;
  // Mission type aliases coming from aurum.functions
  if (v === "mission_terrain") return "rapport";
  // Fuzzy match on labels / free text
  if (v.includes("recensement")) return "recensement";
  if (v.includes("enquête") || v.includes("enquete") || v.includes("survey")) return "enquete";
  if (v.includes("pv") || v.includes("procès") || v.includes("proces") || v.includes("réunion") || v.includes("reunion") || v.includes("compte rendu") || v.includes("compte-rendu")) return "pv";
  return "rapport";
}

export const MISSION_LABEL: Record<DocumentType, string> = {
  rapport: "Mission terrain",
  pv: "Procès-verbal",
  recensement: "Recensement",
  enquete: "Enquête",
};

export function resolveMissionType(d: { type?: string | null; mission_type?: string | null }): DocumentType {
  return normalizeDocumentType(d.mission_type || d.type || "");
}
