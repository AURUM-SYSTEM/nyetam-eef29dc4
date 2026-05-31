import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

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

// ---- Personalization helpers ----

function detectStyle(country: string, profession: string): "fr_admin" | "en_incident" | "ngo_field" | "medical" | "default" {
  const c = (country || "").toUpperCase();
  const p = (profession || "").toLowerCase();
  if (/(ong|ngo|humanit|terrain|field officer|volontaire)/.test(p)) return "ngo_field";
  if (/(médecin|medecin|infirm|docteur|nurse|doctor|clinic|santé|health)/.test(p)) return "medical";
  const francAdmin = ["CM","SN","CI","BJ","TG","BF","ML","GA","CD","CG","MA","TN","DZ","MG","HT","FR","BE","CH"];
  const anglo = ["US","GB","IE","AU","NZ","NG","GH","KE","ZA","IN","CA"];
  if (francAdmin.includes(c) && /(agent|police|gendarm|inspect|fonction|admin|huissier|sécurité|securite)/.test(p)) return "fr_admin";
  if (francAdmin.includes(c)) return "fr_admin";
  if (anglo.includes(c)) return "en_incident";
  return "default";
}

function styleGuidance(style: ReturnType<typeof detectStyle>, lang: "fr" | "en"): string {
  if (lang === "en") {
    switch (style) {
      case "en_incident":
        return "Use a formal INCIDENT REPORT style: chronological facts, witness statements, severity, follow-up. Concise, precise, factual, third person.";
      case "ngo_field":
        return "Use an NGO FIELD REPORT style: context, beneficiaries, observed needs, actions, gaps, recommendations. Neutral humanitarian tone.";
      case "medical":
        return "Use a synthetic CLINICAL/FIELD HEALTH REPORT style: anamnesis, observations, parameters, recommendations. Discreet, factual, medical register.";
      default:
        return "Use a formal English administrative/professional report style. Concise and factual.";
    }
  }
  switch (style) {
    case "fr_admin":
      return "Style PROCÈS-VERBAL / RAPPORT ADMINISTRATIF francophone (gendarmerie, police, fonction publique) : registre formel, soutenu, énumérations factuelles, neutralité, troisième personne. Aucun récit subjectif.";
    case "ngo_field":
      return "Style RAPPORT TERRAIN ONG : contexte, bénéficiaires, besoins observés, actions menées, lacunes, recommandations. Ton humanitaire neutre.";
    case "medical":
      return "Style RAPPORT CLINIQUE / SANTÉ DE TERRAIN synthétique : anamnèse, observations, paramètres, recommandations. Registre médical sobre.";
    default:
      return "Style administratif et professionnel français, formel, factuel et concis.";
  }
}

// ---- Server functions ----

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

type StructuredDoc = {
  title: string;
  introduction: string;
  faits: string;
  declarations: string;
  observations: string;
  conclusion: string;
};

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

export const generateDocument = createServerFn({ method: "POST" })
  .inputValidator((d: { transcript: string; type: "rapport" | "pv" | "recensement"; lang?: "fr" | "en"; country?: string; profession?: string }) =>
    z.object({
      transcript: z.string().min(1).max(50000),
      type: z.enum(["rapport", "pv", "recensement"]),
      lang: LangSchema.optional(),
      country: z.string().max(80).optional(),
      profession: z.string().max(120).optional(),
    }).parse(d),
  )
  .handler(async ({ data }) => {
    const lang = data.lang ?? "fr";
    const country = data.country ?? "";
    const profession = data.profession ?? "";
    const cleanedTranscript = await cleanRawTranscript(data.transcript, lang);
    const style = detectStyle(country, profession);
    const guidance = data.type === "recensement"
      ? (lang === "en"
          ? "Use a humanitarian FIELD CENSUS / BENEFICIARY REGISTRATION style: neutral, factual, structured, no opinions."
          : "Style RECENSEMENT TERRAIN / FICHE BÉNÉFICIAIRE humanitaire : neutre, factuel, structuré, sans opinion personnelle.")
      : styleGuidance(style, lang);

    const typeLabel = lang === "en"
      ? (data.type === "rapport" ? "REPORT" : data.type === "pv" ? "MINUTES" : "FIELD CENSUS RECORD")
      : (data.type === "rapport" ? "RAPPORT" : data.type === "pv" ? "PROCÈS-VERBAL" : "FICHE DE RECENSEMENT");

    const contextLine = lang === "en"
      ? `Author context — Country: ${country || "n/a"}, Profession: ${profession || "n/a"}.`
      : `Contexte de l'auteur — Pays : ${country || "n/c"}, Fonction : ${profession || "n/c"}.`;

    const system = lang === "en"
      ? `You are an assistant producing official ${typeLabel} documents from field data. ${contextLine} ${guidance} Write in formal, precise, factual English. Strictly synthetic, NON-narrative. Structure rigorously. Respond STRICTLY in valid JSON.`
      : `Tu es un assistant spécialisé dans la rédaction de ${typeLabel} officiels à partir de données terrain. ${contextLine} ${guidance} Tu rédiges en français formel, précis, factuel. Style strictement synthétique, NON-narratif. Tu structures rigoureusement le contenu. Réponds STRICTEMENT en JSON valide.`;

    const schema = data.type === "recensement"
      ? (lang === "en"
          ? `{
  "title": "Short title including subject/ID (max 80 chars)",
  "introduction": "CONTEXT: location, date, mission scope, agent",
  "faits": "IDENTIFICATION: subject name/ID, status, household, key demographics",
  "declarations": "STATEMENTS COLLECTED from the subject or community",
  "observations": "FIELD OBSERVATIONS: living conditions, needs observed, vulnerabilities",
  "conclusion": "ASSESSMENT & RECOMMENDED FOLLOW-UP: priority level, suggested aid, next steps"
}`
          : `{
  "title": "Titre court incluant le nom/ID du sujet (max 80 caractères)",
  "introduction": "CONTEXTE : lieu, date, cadre de la mission, agent",
  "faits": "IDENTIFICATION : nom/ID du sujet, statut, composition du foyer, données démographiques clés",
  "declarations": "DÉCLARATIONS RECUEILLIES auprès du sujet ou de la communauté",
  "observations": "OBSERVATIONS TERRAIN : conditions de vie, besoins constatés, vulnérabilités",
  "conclusion": "ÉVALUATION & SUIVI RECOMMANDÉ : niveau de priorité, aide suggérée, prochaines étapes"
}`)
      : (lang === "en"
          ? `{
  "title": "Short descriptive title (max 80 chars)",
  "introduction": "CONTEXT: presumed date, location, parties involved, scope of the mission",
  "faits": "FACTS OBSERVED: chronological and objective enumeration of facts",
  "declarations": "STATEMENTS COLLECTED: declarations made by the persons mentioned",
  "observations": "OBSERVATIONS: technical or operational remarks, anomalies, points requiring attention",
  "conclusion": "CONCLUSION: synthesis, findings and recommended follow-up"
}`
          : `{
  "title": "Titre court et descriptif (max 80 caractères)",
  "introduction": "CONTEXTE : date présumée, lieu, parties prenantes, objet de la mission",
  "faits": "FAITS CONSTATÉS : énumération chronologique et objective des faits",
  "declarations": "DÉCLARATIONS RECUEILLIES : déclarations des personnes mentionnées",
  "observations": "OBSERVATIONS : remarques techniques ou opérationnelles, anomalies, points d'attention",
  "conclusion": "CONCLUSION : synthèse, constatations et suites recommandées"
}`);

    const user = lang === "en"
      ? `Produce a structured ${typeLabel}.\n\nReturn EXCLUSIVELY a JSON object with these keys:\n${schema}\n\nPlain text only, no markdown. If information is missing, indicate it soberly.\n\nFIELD DATA:\n"""\n${cleanedTranscript}\n"""`
      : `Génère un ${typeLabel} structuré.\n\nRetourne EXCLUSIVEMENT un objet JSON avec ces clés :\n${schema}\n\nTexte brut uniquement, pas de markdown. Si une information manque, indique-le sobrement.\n\nDONNÉES TERRAIN :\n"""\n${cleanedTranscript}\n"""`;

    const content = await callGateway(
      [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      true,
    );

    let parsed: StructuredDoc;
    try {
      parsed = JSON.parse(content);
    } catch {
      const m = content.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Réponse IA non parseable");
      parsed = JSON.parse(m[0]);
    }
    return {
      title: String(parsed.title ?? "Document").slice(0, 200),
      introduction: String(parsed.introduction ?? ""),
      faits: String(parsed.faits ?? ""),
      declarations: String(parsed.declarations ?? ""),
      observations: String(parsed.observations ?? ""),
      conclusion: String(parsed.conclusion ?? ""),
      cleanedTranscript,
    };
  });

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
