import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowLeft, Phone, Linkedin, MapPin, User } from "lucide-react";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/about")({
  component: AboutPage,
  head: () => ({
    meta: [
      { title: "À propos — AURUM SYSTEM" },
      { name: "description", content: "AURUM SYSTEM — plateforme intelligente de transformation des prises de parole terrain en documents structurés." },
      { property: "og:title", content: "À propos — AURUM SYSTEM" },
      { property: "og:description", content: "AURUM SYSTEM — plateforme intelligente de transformation des prises de parole terrain en documents structurés." },
    ],
  }),
});

function AboutPage() {
  const { t, lang } = useI18n();
  return (
    <div className="px-5 pt-8 pb-32">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </Link>


      <header className="mt-8 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-gold to-gold-soft shadow-[var(--shadow-gold)]">
          <span className="font-display text-3xl text-background">A</span>
        </div>
        <h1 className="mt-5 font-display text-4xl gold-text">{t("about.app_name")}</h1>
        <p className="mt-2 text-xs uppercase tracking-[0.3em] text-muted-foreground">{t("about.tagline")}</p>
      </header>

      <section className="glass-card mt-8 rounded-2xl p-6">
        <p className="text-sm leading-relaxed text-foreground/90">{t("about.description")}</p>
      </section>

      <section className="mt-6 space-y-3">
        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
              <User className="h-5 w-5 text-gold" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("about.ceo")}</div>
              <div className="text-sm font-medium">NYETAM MALONG MAURICE EMMANUEL</div>
            </div>
          </div>
        </div>

        <div className="glass-card rounded-xl p-4">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
              <MapPin className="h-5 w-5 text-gold" />
            </div>
            <div className="min-w-0 flex-1">
              <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("about.country")}</div>
              <div className="text-sm font-medium">Cameroun 🇨🇲</div>
            </div>
          </div>
        </div>

        <a
          href="https://wa.me/237695599387"
          target="_blank"
          rel="noopener noreferrer"
          className="glass-card flex items-center gap-3 rounded-xl p-4 transition hover:border-gold/40"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <Phone className="h-5 w-5 text-gold" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("about.whatsapp")}</div>
            <div className="text-sm font-medium">+237 695 59 93 87</div>
          </div>
        </a>

        <a
          href="https://www.linkedin.com/search/results/all/?keywords=AURUM%20SYSTEM"
          target="_blank"
          rel="noopener noreferrer"
          className="glass-card flex items-center gap-3 rounded-xl p-4 transition hover:border-gold/40"
        >
          <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
            <Linkedin className="h-5 w-5 text-gold" />
          </div>
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground">{t("about.linkedin")}</div>
            <div className="text-sm font-medium">AURUM SYSTEM</div>
          </div>
        </a>
      </section>

      <p className="mt-10 text-center text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
        © {new Date().getFullYear()} AURUM SYSTEM · {lang === "fr" ? "Tous droits réservés" : "All rights reserved"}
      </p>
    </div>
  );
}
