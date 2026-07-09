import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import fr from "./fr.json";
import en from "./en.json";

export type Lang = "fr" | "en";
const DICTS: Record<Lang, any> = { fr, en };

type Ctx = {
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: string) => string;
};

const I18nCtx = createContext<Ctx>({
  lang: "fr",
  setLang: () => {},
  t: (k) => k,
});

function lookup(dict: any, key: string): string {
  const parts = key.split(".");
  let cur: any = dict;
  for (const p of parts) {
    if (cur && typeof cur === "object" && p in cur) cur = cur[p];
    else return key;
  }
  return typeof cur === "string" ? cur : key;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>("fr");

  useEffect(() => {
    try {
      const stored = (typeof window !== "undefined" ? localStorage.getItem("aurum.lang") : null) as Lang | null;
      if (stored === "fr" || stored === "en") setLangState(stored);
      else if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("en")) {
        setLangState("en");
      }
    } catch {}
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    try { localStorage.setItem("aurum.lang", l); } catch {}
    try { document.documentElement.setAttribute("lang", l); } catch {}
  };

  const t = (key: string) => lookup(DICTS[lang], key);

  return <I18nCtx.Provider value={{ lang, setLang, t }}>{children}</I18nCtx.Provider>;
}

export function useI18n() {
  return useContext(I18nCtx);
}

export function getStoredLang(): Lang {
  try {
    const v = localStorage.getItem("aurum.lang");
    if (v === "en" || v === "fr") return v;
  } catch {}
  return "fr";
}
