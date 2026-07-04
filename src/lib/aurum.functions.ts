import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { buildMetierContext } from "./role-context";


const GATEWAY = "https://ai.gateway.lovable.dev/v1/chat/completions";
const MODEL = "google/gemini-2.5-flash";

type GatewayMessage =
  | { role: string; content: string }
  | { role: string; content: Array<
      | { type: "text"; text: string }
      | { type: "input_audio"; input_audio: { data: string; format: string } }
    > };

async function callGatewayRaw(messages: GatewayMessage[], jsonMode = false) {
  const key = process.env.LOVABLE_API_KEY;
  if (!key) throw new Error("LOVABLE_API_KEY missing");
  const res = await fetch(GATEWAY, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
    body: JSON.stringify({
      model: MODEL,
      messages,
      ...(jsonMode ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) throw new Error("Limite de requêtes atteinte, réessayez dans un instant.");
    if (res.status === 402) throw new Error("Crédits IA épuisés. Ajoutez des crédits dans Lovable.");
    throw new Error(`Erreur IA (${res.status}): ${text.slice(0, 200)}`);
  }
  const data = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  return data.choices?.[0]?.message?.content ?? "";
}

function audioFormatFromMime(mime: string): string {
  const m = mime.toLowerCase();
  if (m.includes("webm")) return "webm";
  if (m.includes("ogg")) return "ogg";
  if (m.includes("mp4") || m.includes("m4a") || m.includes("aac")) return "mp4";
  if (m.includes("wav")) return "wav";
  if (m.includes("mpeg") || m.includes("mp3")) return "mp3";
  return "webm";
}

const LangSchema = z.enum(["fr", "en"]).default("fr");

// ============================================================
// Mission type detection (deterministic, keyword-based)
// ============================================================

export type MissionType = "mission_terrain" | "pv" | "recensement" | "enquete";

const MISSION_KEYWORDS: Record<MissionType, RegExp> = {
  recensement: /\b(recensement|census|registration|recensé|recense|dénombrement|denombrement|enrôlement|enrolement)\b/i,
  pv: /\b(procès[- ]?verbal|proces[- ]?verbal|\bpv\b|réunion|reunion|meeting|assemblée|assemblee|comité|comite)\b/i,
  enquete: /\b(enquête|enquete|survey|investigation|sondage|étude\s+terrain|etude\s+terrain)\b/i,
  mission_terrain: /\b(mission|terrain|visite|field|activité|activite|intervention|déploiement|deploiement|tournée|tournee)\b/i,
};

export function detectMissionType(text: string): MissionType {
  if (!text || !text.trim()) return "mission_terrain";
  for (const t of ["recensement", "pv", "enquete"] as const) {
    if (MISSION_KEYWORDS[t].test(text)) return t;
  }
  if (MISSION_KEYWORDS.mission_terrain.test(text)) return "mission_terrain";
  return "mission_terrain";
}

// Map legacy DocType values from older clients/UI to canonical mission type.
function normalizeMissionType(t: string): MissionType {
  switch (t) {
    case "rapport": return "mission_terrain";
    case "mission_terrain":
    case "pv":
    case "recensement":
    case "enquete":
      return t as MissionType;
    default:
      return "mission_terrain";
  }
}

// ============================================================
// Transcription
// ============================================================

export const transcribeAudio = createServerFn({ method: "POST" })
  .inputValidator((d: { audioBase64: string; mimeType: string; lang?: "fr" | "en" }) =>
    z.object({
      audioBase64: z.string().min(1).max(40_000_000),
      mimeType: z.string().min(1).max(100),
      lang: LangSchema.optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const format = audioFormatFromMime(data.mimeType);
    const lang = data.lang ?? "fr";
    const sys = lang === "en"
      ? "You are a professional audio transcriber. Faithfully transcribe the audio content in English, with no commentary, no preamble, no markdown. If audio is inaudible or empty, return an empty string."
      : "Tu es un transcripteur audio professionnel français. Transcris fidèlement le contenu audio en français, sans ajouter de commentaire, sans préambule, sans markdown. Si l'audio est inaudible ou vide, renvoie une chaîne vide.";
    const userText = lang === "en" ? "Transcribe this audio recording in English." : "Transcris cet enregistrement audio en français.";
    const content = await callGatewayRaw([
      { role: "system", content: sys },
      {
        role: "user",
        content: [
          { type: "text", text: userText },
          { type: "input_audio", input_audio: { data: data.audioBase64, format } },
        ],
      },
    ]);
    return { text: content.trim() };
  });

async function callGateway(messages: Array<{ role: string; content: string }>, jsonMode = false) {
  return callGatewayRaw(messages, jsonMode);
}

async function cleanRawTranscript(raw: string, lang: "fr" | "en" = "fr"): Promise<string> {
  const sys = lang === "en"
    ? "You clean raw audio transcriptions. Remove repetitions, duplicates and formulation errors (uh, um, well, etc.), fix broken or unfinished sentences, reformulate cleanly in a clear, professional and natural style, BUT strictly keep the original meaning — invent NO information. Return ONLY the cleaned text, no preamble, no quotes, no markdown."
    : "Tu nettoies cette transcription audio. Supprime les répétitions, les doublons et les erreurs de formulation (euh, ben, du coup, voilà, etc.), corrige les phrases cassées ou inachevées, reformule proprement dans un style clair, professionnel et naturel, mais GARDE rigoureusement le sens original — n'invente AUCUNE information. Renvoie UNIQUEMENT le texte nettoyé, sans préambule, sans guillemets, sans markdown.";
  const cleaned = await callGateway([
    { role: "system", content: sys },
    { role: "user", content: raw },
  ]);
  const out = cleaned.trim();
  return out.length > 0 ? out : raw;
}

export const cleanTranscript = createServerFn({ method: "POST" })
  .inputValidator((d: { text: string; lang?: "fr" | "en" }) =>
    z.object({ text: z.string().min(1).max(50000), lang: LangSchema.optional() }).parse(d),
  )
  .handler(async ({ data }) => ({ text: await cleanRawTranscript(data.text, data.lang ?? "fr") }));

// ============================================================
// Reverse geocoding (server-side; Nominatim requires UA header)
// ============================================================

export const reverseGeocode = createServerFn({ method: "POST" })
  .inputValidator((d: { lat: number; lng: number }) =>
    z.object({
      lat: z.number().min(-90).max(90),
      lng: z.number().min(-180).max(180),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    try {
      const url = `https://nominatim.openstreetmap.org/reverse?format=json&lat=${data.lat}&lon=${data.lng}&zoom=10&accept-language=fr,en`;
      const res = await fetch(url, {
        headers: { "User-Agent": "AURUM-Reporting/1.0 (+https://nyetam.lovable.app)" },
      });
      if (!res.ok) return { city: "", country: "" };
      const json = await res.json() as { address?: Record<string, string> };
      const a = json.address ?? {};
      const city = a.city || a.town || a.village || a.municipality || a.county || "";
      const country = a.country || "";
      return { city, country };
    } catch {
      return { city: "", country: "" };
    }
  });

// ============================================================
// Document generation — 4 fixed templates (STRICT)
// ============================================================

type LocationInput = {
  lat?: number;
  lng?: number;
  city?: string;
  country?: string;
  source?: "gps" | "text" | "none";
};

type GeneratedSections = Record<string, string>;
type GenerateResult = {
  missionType: MissionType;
  autoDetected: boolean;
  title: string;
  sections: GeneratedSections;
  // Mapped to the 5 fixed DB columns for backward compat:
  introduction: string;
  faits: string;
  declarations: string;
  observations: string;
  conclusion: string;
  locationLabel: string;
  cleanedTranscript: string;
};

const TEMPLATES: Record<MissionType, { fr: string[]; en: string[] }> = {
  mission_terrain: {
    fr: ["Contexte", "Objectifs", "Activités réalisées", "Constats clés", "Difficultés", "Recommandations", "Conclusion"],
    en: ["Context", "Objectives", "Activities carried out", "Key findings", "Difficulties", "Recommendations", "Conclusion"],
  },
  pv: {
    fr: ["Participants", "Points discutés", "Décisions prises", "Actions à entreprendre", "Conclusion"],
    en: ["Participants", "Points discussed", "Decisions made", "Actions to take", "Conclusion"],
  },
  recensement: {
    fr: ["Zone / Localisation", "Méthodologie", "Données collectées", "Résultats", "Observations", "Conclusion"],
    en: ["Zone / Location", "Methodology", "Data collected", "Results", "Observations", "Conclusion"],
  },
  enquete: {
    fr: ["Contexte de l'enquête", "Objectif", "Méthodologie", "Résultats", "Analyse", "Conclusion"],
    en: ["Survey context", "Objective", "Methodology", "Results", "Analysis", "Conclusion"],
  },
};

function typeLabel(t: MissionType, lang: "fr" | "en"): string {
  const fr: Record<MissionType, string> = {
    mission_terrain: "RAPPORT DE MISSION TERRAIN",
    pv: "PROCÈS-VERBAL DE RÉUNION",
    recensement: "FICHE DE RECENSEMENT",
    enquete: "RAPPORT D'ENQUÊTE",
  };
  const en: Record<MissionType, string> = {
    mission_terrain: "FIELD MISSION REPORT",
    pv: "MEETING MINUTES",
    recensement: "CENSUS RECORD",
    enquete: "SURVEY REPORT",
  };
  return (lang === "en" ? en : fr)[t];
}

function buildLocationLabel(loc: LocationInput | undefined, lang: "fr" | "en"): string {
  if (!loc) return lang === "en" ? "Location: Not specified" : "Lieu : Non spécifié";
  const parts = [loc.city, loc.country].filter(Boolean).join(", ");
  if (parts && loc.source === "gps" && loc.lat != null && loc.lng != null) {
    return lang === "en"
      ? `Location: ${parts} (GPS)\nCoordinates: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`
      : `Lieu : ${parts} (GPS)\nCoordonnées : ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)}`;
  }
  if (parts) return lang === "en" ? `Location: ${parts}` : `Lieu : ${parts}`;
  if (loc.lat != null && loc.lng != null) {
    return lang === "en"
      ? `Location: ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)} (GPS)`
      : `Lieu : ${loc.lat.toFixed(4)}, ${loc.lng.toFixed(4)} (GPS)`;
  }
  return lang === "en" ? "Location: Not specified" : "Lieu : Non spécifié";
}

// Map free-form generated sections into the 5 fixed DB columns,
// preserving any extra headings inline so nothing is lost.
function mapSectionsToColumns(
  mt: MissionType,
  sections: GeneratedSections,
  lang: "fr" | "en",
): Pick<GenerateResult, "introduction" | "faits" | "declarations" | "observations" | "conclusion"> {
  const labels = TEMPLATES[mt][lang];
  const v = (i: number) => sections[labels[i]] ?? "";
  const join = (...idxs: number[]) =>
    idxs
      .map((i) => {
        const body = v(i)?.trim();
        if (!body) return "";
        return `## ${labels[i]}\n${body}`;
      })
      .filter(Boolean)
      .join("\n\n");

  if (mt === "mission_terrain") {
    // 0 Contexte, 1 Objectifs, 2 Activités, 3 Constats, 4 Difficultés, 5 Recommandations, 6 Conclusion
    return {
      introduction: v(0),
      faits: join(1, 2),
      declarations: v(3),
      observations: join(4, 5),
      conclusion: v(6),
    };
  }
  if (mt === "pv") {
    // 0 Participants, 1 Points, 2 Décisions, 3 Actions, 4 Conclusion
    return {
      introduction: v(0),
      faits: v(1),
      declarations: v(2),
      observations: v(3),
      conclusion: v(4),
    };
  }
  if (mt === "recensement") {
    // 0 Zone, 1 Méthodologie, 2 Données, 3 Résultats, 4 Observations, 5 Conclusion
    return {
      introduction: v(0),
      faits: v(1),
      declarations: v(2),
      observations: join(3, 4),
      conclusion: v(5),
    };
  }
  // enquete: 0 Contexte, 1 Objectif, 2 Méthodologie, 3 Résultats, 4 Analyse, 5 Conclusion
  return {
    introduction: v(0),
    faits: v(1),
    declarations: v(2),
    observations: join(3, 4),
    conclusion: v(5),
  };
}

export const generateDocument = createServerFn({ method: "POST" })
  .inputValidator((d: {
    transcript: string;
    type?: "rapport" | "pv" | "recensement" | "mission_terrain" | "enquete";
    autoDetect?: boolean;
    lang?: "fr" | "en";
    country?: string;
    profession?: string;
    sector?: string;
    role?: string;
    location?: LocationInput;
  }) =>
    z.object({
      transcript: z.string().min(1).max(50000),
      type: z.enum(["rapport", "pv", "recensement", "mission_terrain", "enquete"]).optional(),
      autoDetect: z.boolean().optional(),
      lang: LangSchema.optional(),
      country: z.string().max(80).optional(),
      profession: z.string().max(120).optional(),
      sector: z.string().max(60).optional(),
      role: z.string().max(60).optional(),
      location: z.object({
        lat: z.number().min(-90).max(90).optional(),
        lng: z.number().min(-180).max(180).optional(),
        city: z.string().max(120).optional(),
        country: z.string().max(120).optional(),
        source: z.enum(["gps", "text", "none"]).optional(),
      }).optional(),
    }).parse(d),
  )

  .handler(async ({ data }) => {
    const lang = data.lang ?? "fr";
    const country = data.country ?? "";
    const profession = data.profession ?? "";
    const cleanedTranscript = await cleanRawTranscript(data.transcript, lang);

    // Decide mission type
    const explicit = data.type ? normalizeMissionType(data.type) : null;
    const autoDetected = data.autoDetect === true || !explicit;
    const missionType: MissionType = autoDetected
      ? detectMissionType(cleanedTranscript)
      : (explicit as MissionType);

    const labels = TEMPLATES[missionType][lang];
    const locationLabel = buildLocationLabel(data.location, lang);
    const missingTag = lang === "en"
      ? "Not specified in the provided data"
      : "Non spécifié dans les données fournies";

    const schemaObj = labels.reduce<Record<string, string>>((acc, label) => {
      acc[label] = `String — content for section "${label}". If missing, use exactly: "${missingTag}".`;
      return acc;
    }, {});

    const tLabel = typeLabel(missionType, lang);
    const contextLine = lang === "en"
      ? `Author context — Country: ${country || "n/a"}, Profession: ${profession || "n/a"}.`
      : `Contexte de l'auteur — Pays : ${country || "n/c"}, Fonction : ${profession || "n/c"}.`;

    const strictRules = lang === "en"
      ? [
          "STRICT RULES — VIOLATING THESE INVALIDATES THE OUTPUT:",
          "1. Use ONLY the section headings listed in the JSON schema. Do not add, remove, rename or merge sections.",
          `2. If a section's information is missing from the field data, write EXACTLY: "${missingTag}".`,
          "3. NEVER invent names, places, numbers, dates, beneficiaries or any factual data.",
          "4. Stay factual, neutral, professional. No personal opinions, no narrative storytelling.",
          "5. Plain text only, no markdown, no bullet symbols other than dashes.",
        ].join("\n")
      : [
          "RÈGLES STRICTES — TOUT MANQUEMENT INVALIDE LE DOCUMENT :",
          "1. Utilise UNIQUEMENT les sections listées dans le schéma JSON. N'ajoute, ne supprime, ne renomme ni ne fusionne AUCUNE section.",
          `2. Si une section manque d'information dans les données terrain, écris EXACTEMENT : « ${missingTag} ».`,
          "3. N'INVENTE JAMAIS de noms, lieux, chiffres, dates, bénéficiaires ou faits.",
          "4. Reste factuel, neutre, professionnel. Pas d'opinion personnelle, pas de récit narratif.",
          "5. Texte brut uniquement, pas de markdown, pas de puces autres que des tirets.",
        ].join("\n");

    const locationHint = data.location && (data.location.city || data.location.lat != null)
      ? (lang === "en"
          ? `Detected location: ${locationLabel}. Include it in the relevant context/zone section.`
          : `Lieu détecté : ${locationLabel}. Intègre-le dans la section contexte/zone appropriée.`)
      : (lang === "en"
          ? `No location detected upstream. If the transcript mentions a city/region, use it; otherwise write "${missingTag}".`
          : `Aucun lieu détecté en amont. Si la transcription cite une ville/zone, utilise-la ; sinon écris « ${missingTag} ».`);

    const metierContext = buildMetierContext(data.sector, data.role, lang);

    const system = lang === "en"
      ? `You are an NGO field reporting assistant producing official ${tLabel} documents. ${contextLine}\n\n${metierContext}\n\n${strictRules}\nRespond STRICTLY with a valid JSON object matching the given schema.`
      : `Tu es un assistant de reporting terrain pour ONG produisant des ${tLabel} officiels. ${contextLine}\n\n${metierContext}\n\n${strictRules}\nRéponds STRICTEMENT par un objet JSON valide conforme au schéma fourni.`;


    const user = lang === "en"
      ? `Produce a ${tLabel}.\n\n${locationHint}\n\nReturn EXCLUSIVELY a JSON object with these exact keys (and no others):\n${JSON.stringify(schemaObj, null, 2)}\n\nAlso include a "title" key: short descriptive title (max 80 chars).\n\nFIELD DATA:\n"""\n${cleanedTranscript}\n"""`
      : `Génère un ${tLabel}.\n\n${locationHint}\n\nRetourne EXCLUSIVEMENT un objet JSON avec ces clés exactes (et aucune autre) :\n${JSON.stringify(schemaObj, null, 2)}\n\nInclus aussi une clé "title" : titre court et descriptif (max 80 caractères).\n\nDONNÉES TERRAIN :\n"""\n${cleanedTranscript}\n"""`;

    const content = await callGateway(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      true,
    );

    let parsed: Record<string, string>;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Réponse IA non parseable");
      parsed = JSON.parse(m[0]);
    }

    const sections: GeneratedSections = {};
    for (const label of labels) {
      const val = parsed[label];
      sections[label] = typeof val === "string" && val.trim().length > 0 ? val : missingTag;
    }

    const mapped = mapSectionsToColumns(missionType, sections, lang);
    const titleRaw = String(parsed.title ?? tLabel).slice(0, 200);

    const result: GenerateResult = {
      missionType,
      autoDetected,
      title: titleRaw,
      sections,
      ...mapped,
      locationLabel,
      cleanedTranscript,
    };
    return result;
  });

// ============================================================
// CORE — Structuration IA générique (Phase 3 du ROADMAP)
//
// À la différence de `generateDocument` (pipeline legacy à 4 templates
// fixes, écrit dans les colonnes de `documents`), cette fonction traite
// les saisies `field_entry` de façon générique par `module_type`, et son
// résultat est destiné à la table SÉPARÉE `core_outputs` — jamais à
// `documents`. CORE ne réécrit jamais la source brute.
// ============================================================

const CORE_MODULE_HINTS: Record<string, { fr: string; en: string }> = {
  agro: {
    fr: "Contexte agricole : cultures, parcelles, rendements, coopératives, visites terrain.",
    en: "Agricultural context: crops, plots, yields, cooperatives, field visits.",
  },
  health: {
    fr: "Contexte santé : patients, campagnes, indicateurs sanitaires, structures de soin.",
    en: "Health context: patients, campaigns, health indicators, care facilities.",
  },
  ngo: {
    fr: "Contexte ONG : bénéficiaires, distributions, activités humanitaires.",
    en: "NGO context: beneficiaries, distributions, humanitarian activities.",
  },
  generic: {
    fr: "Contexte générique : capture terrain libre, sans domaine métier spécifique.",
    en: "Generic context: free-form field capture, no specific business domain.",
  },
};

export type CoreStructuredOutput = {
  category: string;
  summary: string;
  indicators: Array<{ label: string; value: string }>;
  tags: string[];
};

export const structureFieldEntry = createServerFn({ method: "POST" })
  .inputValidator((d: {
    transcript: string;
    moduleType?: string;
    lang?: "fr" | "en";
  }) =>
    z.object({
      transcript: z.string().min(1).max(50000),
      moduleType: z.string().max(60).optional(),
      lang: LangSchema.optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const lang = data.lang ?? "fr";
    const moduleType = data.moduleType && CORE_MODULE_HINTS[data.moduleType] ? data.moduleType : "generic";
    const hint = CORE_MODULE_HINTS[moduleType][lang];

    const sys = lang === "en"
      ? `You structure raw field-capture text into exploitable data. ${hint}\nRespond STRICTLY with a JSON object: { "category": string (short, max 4 words), "summary": string (2-4 factual sentences, no invented facts), "indicators": [{ "label": string, "value": string }] (0 to 6 concrete indicators found in the text — numbers, counts, dates; do NOT invent any), "tags": string[] (1 to 5 short lowercase keywords) }. Never invent information not present in the text.`
      : `Tu structures un texte de saisie terrain brut en données exploitables. ${hint}\nRéponds STRICTEMENT par un objet JSON : { "category": string (court, max 4 mots), "summary": string (2 à 4 phrases factuelles, aucune invention), "indicators": [{ "label": string, "value": string }] (0 à 6 indicateurs concrets trouvés dans le texte — chiffres, comptages, dates ; N'INVENTE RIEN), "tags": string[] (1 à 5 mots-clés courts en minuscules) }. N'invente jamais d'information absente du texte.`;

    const content = await callGateway(
      [
        { role: "system", content: sys },
        { role: "user", content: data.transcript },
      ],
      true,
    );

    let parsed: Partial<CoreStructuredOutput>;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      parsed = m ? JSON.parse(m[0]) : {};
    }

    const result: CoreStructuredOutput = {
      category: typeof parsed.category === "string" ? parsed.category.slice(0, 80) : (lang === "en" ? "Uncategorized" : "Non catégorisé"),
      summary: typeof parsed.summary === "string" ? parsed.summary.slice(0, 1000) : "",
      indicators: Array.isArray(parsed.indicators)
        ? parsed.indicators
            .filter((i): i is { label: string; value: string } => !!i && typeof i.label === "string" && typeof i.value === "string")
            .slice(0, 6)
        : [],
      tags: Array.isArray(parsed.tags)
        ? parsed.tags.filter((t): t is string => typeof t === "string").slice(0, 5)
        : [],
    };
    return result;
  });

// ============================================================
// Post-generation suggestions (separate, never modify the doc)
// ============================================================

export const suggestImprovements = createServerFn({ method: "POST" })
  .inputValidator((d: {
    missionType: "mission_terrain" | "pv" | "recensement" | "enquete";
    sections: Record<string, string>;
    lang?: "fr" | "en";
    sector?: string;
    role?: string;
  }) =>
    z.object({
      missionType: z.enum(["mission_terrain", "pv", "recensement", "enquete"]),
      sections: z.record(z.string(), z.string()).refine((r) => Object.keys(r).length <= 20),
      lang: LangSchema.optional(),
      sector: z.string().max(60).optional(),
      role: z.string().max(60).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const lang = data.lang ?? "fr";

    const typeHints: Record<MissionType, { fr: string[]; en: string[] }> = {
      mission_terrain: {
        fr: ["nombre de bénéficiaires", "localisation exacte", "durée de l'intervention", "matériel déployé"],
        en: ["beneficiary count", "exact location", "intervention duration", "deployed resources"],
      },
      pv: {
        fr: ["actions assignées (responsable + délai)", "clarté des décisions prises", "liste complète des participants", "ordre du jour"],
        en: ["assigned actions (owner + deadline)", "decision clarity", "full participant list", "agenda"],
      },
      recensement: {
        fr: ["données quantitatives chiffrées", "méthodologie utilisée", "critères d'inclusion", "périmètre géographique"],
        en: ["quantitative figures", "methodology used", "inclusion criteria", "geographic scope"],
      },
      enquete: {
        fr: ["description de l'échantillonnage", "critères d'analyse", "marge d'erreur / limites", "biais potentiels"],
        en: ["sampling description", "analysis criteria", "limitations / error margin", "potential biases"],
      },
    };
    const hints = typeHints[data.missionType][lang].join(", ");

    const sys = lang === "en"
      ? `You analyse an NGO field report and produce 3 to 5 concrete improvement suggestions. Each suggestion is one short sentence (max 18 words), actionable, focused on what's missing or unclear. NEVER rewrite the report itself. Respond as a JSON object {"suggestions": string[]}.\n\n${buildMetierContext(data.sector, data.role, lang)}`
      : `Tu analyses un rapport terrain ONG et tu produis 3 à 5 suggestions d'amélioration concrètes. Chaque suggestion est une phrase courte (max 18 mots), actionnable, ciblée sur ce qui manque ou ce qui est flou. Ne réécris JAMAIS le rapport. Réponds par un objet JSON {"suggestions": string[]}.\n\n${buildMetierContext(data.sector, data.role, lang)}`;


    const body = Object.entries(data.sections)
      .map(([k, v]) => `### ${k}\n${v}`)
      .join("\n\n");

    const user = lang === "en"
      ? `Report type: ${data.missionType}.\nCommon improvement axes for this type: ${hints}.\n\nReport:\n${body}\n\nReturn JSON: {"suggestions": ["...", "..."]}.`
      : `Type de rapport : ${data.missionType}.\nAxes d'amélioration habituels : ${hints}.\n\nRapport :\n${body}\n\nRetourne JSON : {"suggestions": ["...", "..."]}.`;

    const content = await callGateway(
      [
        { role: "system", content: sys },
        { role: "user", content: user },
      ],
      true,
    );

    try {
      const parsed = JSON.parse(content) as { suggestions?: unknown };
      const arr = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
      const clean = arr
        .filter((s): s is string => typeof s === "string")
        .map((s) => s.trim())
        .filter((s) => s.length > 0)
        .slice(0, 5);
      return { suggestions: clean };
    } catch {
      return { suggestions: [] as string[] };
    }
  });

// ============================================================
// Improve a single section (kept for backward compat)
// ============================================================

export const improveText = createServerFn({ method: "POST" })
  .inputValidator((d: { text: string; section: string; lang?: "fr" | "en" }) =>
    z.object({
      text: z.string().min(1).max(10000),
      section: z.string().min(1).max(50),
      lang: LangSchema.optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const lang = data.lang ?? "fr";
    const sys = lang === "en"
      ? "You improve administrative/legal English texts. Fix grammar, smooth the style, keep meaning and formal tone. Return ONLY the improved text, no preamble."
      : "Tu améliores des textes administratifs/juridiques en français. Tu corriges la grammaire, fluidifies le style, gardes le sens et le ton formel. Renvoie UNIQUEMENT le texte amélioré, sans préambule.";
    const content = await callGateway([
      { role: "system", content: sys },
      { role: "user", content: lang === "en" ? `Improve this "${data.section}" section:\n\n${data.text}` : `Améliore cette section « ${data.section} » :\n\n${data.text}` },
    ]);
    return { text: content.trim() };
  });
