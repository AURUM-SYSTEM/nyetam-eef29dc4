import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, FileText, Gavel, ChevronRight, Users, Sparkles, ClipboardList } from "lucide-react";
import { useI18n } from "@/i18n";
import type { DocType } from "@/lib/offline-store";

export const Route = createFileRoute("/_authenticated/new")({
  component: NewDocPage,
  head: () => ({ meta: [{ title: "Nouveau document — AURUM" }] }),
});

type CardDef = {
  type: Exclude<DocType, "rapport">;
  title: string;
  desc: string;
  icon: React.ComponentType<{ className?: string }>;
  highlight?: boolean;
};

function NewDocPage() {
  const navigate = useNavigate();
  const { t } = useI18n();

  function pick(type: CardDef["type"]) {
    if (type === "recensement") {
      navigate({ to: "/recensement" });
      return;
    }
    navigate({ to: "/record/$type", params: { type } });
  }

  const cards: CardDef[] = [
    {
      type: "auto",
      title: "Détection automatique",
      desc: "AURUM détecte le type de mission depuis ce que vous dites.",
      icon: Sparkles,
      highlight: true,
    },
    {
      type: "mission_terrain",
      title: "Mission terrain",
      desc: "Contexte, objectifs, activités, constats, difficultés, recommandations.",
      icon: FileText,
    },
    {
      type: "pv",
      title: "Procès-verbal de réunion",
      desc: "Participants, points discutés, décisions, actions à entreprendre.",
      icon: Gavel,
    },
    {
      type: "enquete",
      title: "Enquête",
      desc: "Contexte, objectif, méthodologie, résultats, analyse.",
      icon: ClipboardList,
    },
    {
      type: "recensement",
      title: "Recensement ONG",
      desc: "Fiche bénéficiaire avec photos, audio terrain et observations.",
      icon: Users,
    },
  ];

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
        {cards.map((c) => {
          const Icon = c.icon;
          return (
            <button
              key={c.type}
              onClick={() => pick(c.type)}
              className={`glass-card group flex w-full items-center gap-4 rounded-2xl p-5 text-left transition hover:border-gold/40 ${
                c.highlight ? "border-gold/50 bg-gold/5" : ""
              }`}
            >
              <div
                className={`flex h-14 w-14 shrink-0 items-center justify-center rounded-xl ${
                  c.highlight
                    ? "bg-gradient-to-br from-gold to-gold-soft"
                    : "bg-accent gold-border"
                }`}
              >
                <Icon className={`h-7 w-7 ${c.highlight ? "text-background" : "text-gold"}`} />
              </div>
              <div className="flex-1">
                <div className="font-display text-xl">{c.title}</div>
                <div className="text-xs text-muted-foreground">{c.desc}</div>
              </div>
              <ChevronRight className="h-5 w-5 text-muted-foreground transition group-hover:text-gold" />
            </button>
          );
        })}
      </div>
    </div>
  );
}
