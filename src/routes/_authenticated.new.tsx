import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, FileText, Gavel, ChevronRight, Users } from "lucide-react";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/new")({
  component: NewDocPage,
  head: () => ({ meta: [{ title: "Nouveau document — AURUM" }] }),
});

function NewDocPage() {
  const navigate = useNavigate();
  const { t } = useI18n();

  function pick(type: "rapport" | "pv") {
    navigate({ to: "/record/$type", params: { type } });
  }

  return (
    <div className="px-5 pt-8 pb-32">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </Link>

      <header className="mt-6">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">{t("new.step")}</p>
        <h1 className="mt-2 font-display text-3xl">{t("new.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("new.subtitle")}</p>
      </header>

      <div className="mt-8 space-y-3">
        <button
          onClick={() => pick("rapport")}
          className="glass-card group flex w-full items-center gap-4 rounded-2xl p-5 text-left transition hover:border-gold/40"
        >
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-gold to-gold-soft">
            <FileText className="h-7 w-7 text-background" />
          </div>
          <div className="flex-1">
            <div className="font-display text-xl">{t("new.rapport")}</div>
            <div className="text-xs text-muted-foreground">{t("new.rapportDesc")}</div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground transition group-hover:text-gold" />
        </button>

        <button
          onClick={() => pick("pv")}
          className="glass-card group flex w-full items-center gap-4 rounded-2xl p-5 text-left transition hover:border-gold/40"
        >
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-accent gold-border">
            <Gavel className="h-7 w-7 text-gold" />
          </div>
          <div className="flex-1">
            <div className="font-display text-xl">{t("new.pv")}</div>
            <div className="text-xs text-muted-foreground">{t("new.pvDesc")}</div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground transition group-hover:text-gold" />
        </button>

        <button
          onClick={() => navigate({ to: "/recensement" })}
          className="glass-card group flex w-full items-center gap-4 rounded-2xl p-5 text-left transition hover:border-gold/40"
        >
          <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-xl bg-accent gold-border">
            <Users className="h-7 w-7 text-gold" />
          </div>
          <div className="flex-1">
            <div className="font-display text-xl">Recensement ONG</div>
            <div className="text-xs text-muted-foreground">
              Fiche bénéficiaire avec photos, audio terrain et observations
            </div>
          </div>
          <ChevronRight className="h-5 w-5 text-muted-foreground transition group-hover:text-gold" />
        </button>
      </div>
    </div>
  );
}
