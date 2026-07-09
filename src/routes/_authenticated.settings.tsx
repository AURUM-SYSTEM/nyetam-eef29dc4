import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, ChevronRight, User, Info } from "lucide-react";
import { LanguageSwitcher } from "@/components/LanguageSwitcher";
import { ThemeToggle } from "@/components/ThemeToggle";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/settings")({
  component: SettingsPage,
  head: () => ({ meta: [{ title: "Paramètres — AURUM" }] }),
});

function SettingsPage() {
  const { t } = useI18n();
  return (
    <div className="px-5 pt-8 pb-32">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </Link>
      <header className="mt-6">
        <h1 className="font-display text-3xl">{t("settings.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("settings.sub")}</p>
      </header>

      <section className="mt-8 glass-card rounded-2xl p-5">
        <h2 className="mb-3 font-display text-base text-gold">{t("settings.lang_section")}</h2>
        <LanguageSwitcher />
      </section>

      <section className="mt-4 glass-card rounded-2xl p-5">
        <h2 className="mb-3 font-display text-base text-gold">{t("settings.theme_section")}</h2>
        <ThemeToggle />
      </section>

      <nav className="mt-6 space-y-2">
        <Link to="/profile" className="glass-card flex items-center gap-3 rounded-xl px-4 py-3 transition hover:border-gold/40">
          <User className="h-5 w-5 text-gold" />
          <span className="flex-1 text-sm">{t("settings.profile_link")}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
        <Link to="/about" className="glass-card flex items-center gap-3 rounded-xl px-4 py-3 transition hover:border-gold/40">
          <Info className="h-5 w-5 text-gold" />
          <span className="flex-1 text-sm">{t("settings.about_link")}</span>
          <ChevronRight className="h-4 w-4 text-muted-foreground" />
        </Link>
      </nav>
    </div>
  );
}
