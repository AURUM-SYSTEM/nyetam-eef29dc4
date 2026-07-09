export type AurumProfile = {
  name: string;
  role: string;
  defaultLocation: string;
  signature: string;
};

const KEY = "aurum.profile";

const DEFAULT: AurumProfile = { name: "", role: "", defaultLocation: "", signature: "" };

export function getProfile(): AurumProfile {
  if (typeof window === "undefined") return DEFAULT;
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT;
    return { ...DEFAULT, ...JSON.parse(raw) };
  } catch {
    return DEFAULT;
  }
}

export function saveProfile(p: AurumProfile) {
  try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {}
}

export function generateReference(prefix = "AURUM"): string {
  const d = new Date();
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  const rnd = Math.random().toString(36).slice(2, 8).toUpperCase();
  return `${prefix}-${yyyy}${mm}${dd}-${rnd}`;
}

// --- Theme ---
export type Theme = "dark" | "light";
const THEME_KEY = "aurum.theme";

export function getTheme(): Theme {
  if (typeof window === "undefined") return "dark";
  try {
    const v = localStorage.getItem(THEME_KEY);
    return v === "light" ? "light" : "dark";
  } catch { return "dark"; }
}

export function applyTheme(t: Theme) {
  if (typeof document === "undefined") return;
  const root = document.documentElement;
  root.classList.toggle("light", t === "light");
  root.classList.toggle("dark", t === "dark");
}

export function setTheme(t: Theme) {
  try { localStorage.setItem(THEME_KEY, t); } catch {}
  applyTheme(t);
}
