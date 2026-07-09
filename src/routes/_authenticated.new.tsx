import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Mic, ChevronRight, Building2 } from "lucide-react";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/use-auth";
import { labelForOrgType, moduleForOrgType } from "@/lib/organization-context";

export const Route = createFileRoute("/_authenticated/new")({
  component: NewEntryPage,
  head: () => ({ meta: [{ title: "Nouvelle saisie — AURUM" }] }),
});

// Neutral field capture. Collect does NOT interpret what is being captured.
// The `module_type` metadata is inherited from the user's organization
// context (set once in Profile) and forwarded to CORE — the agent never
// picks a sector at capture time.
function NewEntryPage() {
  const navigate = useNavigate();
  const { t, lang } = useI18n();
  const { profile } = useAuth();

  const orgName = profile?.organization_name?.trim() || "";
  const orgType = profile?.organization_type || "generic";
  const orgLabel = labelForOrgType(orgType, lang);
  const moduleType = profile?.module_type || moduleForOrgType(orgType);

  function start() {
    navigate({
      to: "/record/$type",
      params: { type: "field_entry" },
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

      <section className="mt-8 rounded-2xl border border-border bg-card/40 p-4">
        <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-gold-soft">
          <Building2 className="h-3.5 w-3.5" /> Contexte organisation
        </div>
        <div className="mt-2 font-display text-lg">
          {orgName || <span className="text-muted-foreground">Organisation non renseignée</span>}
        </div>
        <div className="mt-1 text-xs text-muted-foreground">
          Domaine : <span className="text-foreground">{orgLabel}</span>
          <span className="mx-2 opacity-40">·</span>
          module : <span className="text-foreground">{moduleType}</span>
        </div>
        <Link
          to="/profile"
          className="mt-3 inline-flex items-center gap-1 text-[11px] text-gold hover:underline"
        >
          Modifier dans le profil <ChevronRight className="h-3 w-3" />
        </Link>
      </section>

      <button
        onClick={start}
        className="group mt-6 flex w-full items-center justify-between gap-4 rounded-2xl btn-gold px-6 py-5 text-left"
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
