export type Country = { code: string; fr: string; en: string; lang: "fr" | "en" };

// Curated list, francophone + anglophone focused.
export const COUNTRIES: Country[] = [
  { code: "CM", fr: "Cameroun", en: "Cameroon", lang: "fr" },
  { code: "FR", fr: "France", en: "France", lang: "fr" },
  { code: "BE", fr: "Belgique", en: "Belgium", lang: "fr" },
  { code: "CH", fr: "Suisse", en: "Switzerland", lang: "fr" },
  { code: "CA", fr: "Canada", en: "Canada", lang: "fr" },
  { code: "SN", fr: "Sénégal", en: "Senegal", lang: "fr" },
  { code: "CI", fr: "Côte d'Ivoire", en: "Ivory Coast", lang: "fr" },
  { code: "BJ", fr: "Bénin", en: "Benin", lang: "fr" },
  { code: "TG", fr: "Togo", en: "Togo", lang: "fr" },
  { code: "BF", fr: "Burkina Faso", en: "Burkina Faso", lang: "fr" },
  { code: "ML", fr: "Mali", en: "Mali", lang: "fr" },
  { code: "GA", fr: "Gabon", en: "Gabon", lang: "fr" },
  { code: "CD", fr: "RD Congo", en: "DR Congo", lang: "fr" },
  { code: "CG", fr: "Congo-Brazzaville", en: "Congo-Brazzaville", lang: "fr" },
  { code: "MA", fr: "Maroc", en: "Morocco", lang: "fr" },
  { code: "TN", fr: "Tunisie", en: "Tunisia", lang: "fr" },
  { code: "DZ", fr: "Algérie", en: "Algeria", lang: "fr" },
  { code: "MG", fr: "Madagascar", en: "Madagascar", lang: "fr" },
  { code: "HT", fr: "Haïti", en: "Haiti", lang: "fr" },
  { code: "US", fr: "États-Unis", en: "United States", lang: "en" },
  { code: "GB", fr: "Royaume-Uni", en: "United Kingdom", lang: "en" },
  { code: "IE", fr: "Irlande", en: "Ireland", lang: "en" },
  { code: "AU", fr: "Australie", en: "Australia", lang: "en" },
  { code: "NZ", fr: "Nouvelle-Zélande", en: "New Zealand", lang: "en" },
  { code: "NG", fr: "Nigeria", en: "Nigeria", lang: "en" },
  { code: "GH", fr: "Ghana", en: "Ghana", lang: "en" },
  { code: "KE", fr: "Kenya", en: "Kenya", lang: "en" },
  { code: "ZA", fr: "Afrique du Sud", en: "South Africa", lang: "en" },
  { code: "IN", fr: "Inde", en: "India", lang: "en" },
  { code: "OTHER", fr: "Autre", en: "Other", lang: "fr" },
];

export function countryName(code: string, lang: "fr" | "en"): string {
  const c = COUNTRIES.find(x => x.code === code);
  if (!c) return code;
  return lang === "en" ? c.en : c.fr;
}
