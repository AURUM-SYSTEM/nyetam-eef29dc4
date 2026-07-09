import { useI18n, type Lang } from "@/i18n";
import { Languages } from "lucide-react";

export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useI18n();
  const opts: { code: Lang; label: string; flag: string }[] = [
    { code: "fr", label: "Français", flag: "🇫🇷" },
    { code: "en", label: "English", flag: "🇬🇧" },
  ];

  if (compact) {
    return (
      <div className="inline-flex items-center gap-1 rounded-full border border-border bg-card/60 px-1 py-1 text-xs">
        {opts.map(o => (
          <button
            key={o.code}
            onClick={() => setLang(o.code)}
            className={`rounded-full px-2 py-0.5 transition ${
              lang === o.code ? "bg-gold text-background font-semibold" : "text-muted-foreground hover:text-foreground"
            }`}
            aria-label={o.label}
          >
            {o.code.toUpperCase()}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-muted-foreground">
        <Languages className="h-3.5 w-3.5" /> {lang === "fr" ? "Langue" : "Language"}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {opts.map(o => (
          <button
            key={o.code}
            onClick={() => setLang(o.code)}
            className={`rounded-xl border px-4 py-3 text-left transition ${
              lang === o.code
                ? "border-gold bg-gold/10 text-foreground"
                : "border-border bg-card/50 text-muted-foreground hover:border-gold/40"
            }`}
          >
            <div className="text-2xl">{o.flag}</div>
            <div className="mt-1 text-sm font-medium">{o.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
