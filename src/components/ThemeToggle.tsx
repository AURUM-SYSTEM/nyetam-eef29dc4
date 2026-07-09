import { useEffect, useState } from "react";
import { getTheme, setTheme, applyTheme, type Theme } from "@/lib/profile-store";
import { Moon, Sun } from "lucide-react";
import { useI18n } from "@/i18n";

export function ThemeToggle() {
  const { t } = useI18n();
  const [theme, setT] = useState<Theme>("dark");

  useEffect(() => {
    const cur = getTheme();
    setT(cur);
    applyTheme(cur);
  }, []);

  function pick(v: Theme) {
    setT(v);
    setTheme(v);
  }

  return (
    <div className="space-y-2">
      <div className="text-xs uppercase tracking-widest text-muted-foreground">{t("common.theme")}</div>
      <div className="grid grid-cols-2 gap-2">
        <button
          onClick={() => pick("dark")}
          className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${
            theme === "dark" ? "border-gold bg-gold/10" : "border-border bg-card/50 text-muted-foreground"
          }`}
        >
          <Moon className="h-4 w-4" /> {t("common.dark")}
        </button>
        <button
          onClick={() => pick("light")}
          className={`flex items-center justify-center gap-2 rounded-xl border px-4 py-3 text-sm transition ${
            theme === "light" ? "border-gold bg-gold/10" : "border-border bg-card/50 text-muted-foreground"
          }`}
        >
          <Sun className="h-4 w-4" /> {t("common.light")}
        </button>
      </div>
    </div>
  );
}
