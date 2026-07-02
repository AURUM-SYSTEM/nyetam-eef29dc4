import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { ArrowLeft, Mic, ChevronRight } from "lucide-react";
import { useI18n } from "@/i18n";
import type { ModuleType } from "@/lib/offline-store";

export const Route = createFileRoute("/_authenticated/new")({
  component: NewEntryPage,
  head: () => ({ meta: [{ title: "Nouvelle saisie — AURUM" }] }),
});

// Neutral field capture. Collect does NOT interpret what is being captured
// — the optional `module_type` is metadata only, forwarded to CORE.
const MODULES: Array<{ value: ModuleType; label: string; hint: string }> = [
  { value: "generic", label: "Générique", hint: "Saisie neutre, sans domaine spécifique" },
  { value: "agro", label: "Agro", hint: "Contexte agricole (futur module)" },
  { value: "health", label: "Santé", hint: "Contexte santé (futur module)" },
  { value: "ngo", label: "ONG", hint: "Contexte humanitaire (futur module)" },
];

function NewEntryPage() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [moduleType, setModuleType] = useState<ModuleType | "">("");

  function start() {
    navigate({
      to: "/record/$type",
      params: { type: "field_entry" },
      search: moduleType ? { module: moduleType } : {},
    });
  }

  return (
    <div className="px-5 pt-8 pb-32">
      <Link
        to="/"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </Link>

      <header className="mt-6">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">
          {t("new.step")}
        </p>
        <h1 className="mt-2 font-display text-3xl">Nouvelle saisie</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Capturez des données terrain (audio, texte, photos). Le traitement se fera plus tard.
        </p>
      </header>

      <section className="mt-8">
        <label className="mb-2 block text-xs uppercase tracking-widest text-gold-soft">
          Contexte (optionnel)
        </label>
        <div className="grid grid-cols-2 gap-2">
          {MODULES.map((m) => {
            const selected = moduleType === m.value;
            return (
              <button
                key={m.value}
                type="button"
                onClick={() => setModuleType(selected ? "" : m.value)}
                className={`rounded-xl border p-3 text-left text-sm transition ${
                  selected
                    ? "border-gold bg-gold/10 text-foreground"
                    : "border-border bg-card/50 text-muted-foreground hover:text-foreground"
                }`}
              >
                <div className="font-medium">{m.label}</div>
                <div className="mt-0.5 text-[11px] text-muted-foreground">{m.hint}</div>
              </button>
            );
          })}
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Ce contexte est stocké comme métadonnée. Aucun traitement métier n'est appliqué à ce stade.
        </p>
      </section>

      <button
        onClick={start}
        className="group mt-8 flex w-full items-center justify-between gap-4 rounded-2xl btn-gold px-6 py-5 text-left"
      >
        <div>
          <div className="text-xs font-semibold uppercase tracking-widest opacity-70">
            Commencer
          </div>
          <div className="mt-1 font-display text-2xl">Capturer maintenant</div>
        </div>
        <Mic className="h-10 w-10 opacity-80" />
      </button>

      <div className="mt-8 rounded-xl border border-border bg-card/40 p-4 text-xs text-muted-foreground">
        <div className="mb-1 flex items-center gap-1.5 font-medium text-foreground">
          <ChevronRight className="h-3.5 w-3.5" /> À savoir
        </div>
        Vos anciennes fiches (Mission, PV, Enquête, Recensement) restent accessibles depuis
        l'accueil. Elles ne sont plus créées via ce menu.
      </div>
    </div>
  );
}
