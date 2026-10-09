// Liste des producteurs de l'organisation — accessible à tout agent (pas
// réservé aux superviseurs), lecture seule. Réutilise listProducers(),
// déjà utilisée par le tableau de bord superviseur et déjà scopée par
// organisation côté serveur (getCallerOrg) — aucune nouvelle fonction
// serveur nécessaire.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, Users, Search, ChevronRight, Phone, Mail, CreditCard, Loader2 } from "lucide-react";
import { listProducers } from "@/lib/agro.functions";
import { getProducerCardsFeatureStatus, issueProducerCard, markProducerCardPrinted } from "@/lib/producer-card.functions";

export const Route = createFileRoute("/_authenticated/producteurs")({
  component: ProducteursPage,
  head: () => ({
    meta: [
      { title: "Producteurs — AURUM" },
      { name: "description", content: "Producteurs enregistrés par votre organisation." },
    ],
  }),
});

type ProducerRow = {
  id: string;
  fullName: string;
  cooperativeName: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  parcelleCount: number;
};

function ProducteursPage() {
  const fetchProducers = useServerFn(listProducers);
  const fetchCardFeature = useServerFn(getProducerCardsFeatureStatus);
  const issueCard = useServerFn(issueProducerCard);
  const markPrinted = useServerFn(markProducerCardPrinted);
  const [rows, setRows] = useState<ProducerRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [cardsEnabled, setCardsEnabled] = useState(false);
  const [cardFeatureMessage, setCardFeatureMessage] = useState("Vérification de la fonctionnalité Cartes producteurs…");
  const [cardLoadingId, setCardLoadingId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [res, feature] = await Promise.all([
          fetchProducers({ data: undefined as any }),
          fetchCardFeature({ data: undefined as any }),
        ]);
        if (!cancelled) {
          setRows(res.producers);
          setCardsEnabled(feature.enabled);
          setCardFeatureMessage(feature.enabled
            ? "Les cartes producteurs sont activées."
            : "Les cartes producteurs ne sont pas activées pour cette organisation ou votre compte ne dispose pas des droits nécessaires. Vérifiez Administration → Cartes producteurs.");
        }
      } catch (e: any) {
        if (!cancelled) {
          setError(e?.message ?? "Erreur de chargement");
          setCardFeatureMessage("Impossible de vérifier l’accès aux cartes producteurs. Rechargez la page ou vérifiez la configuration.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return rows;
    return rows.filter((r) => `${r.fullName} ${r.cooperativeName ?? ""}`.toLowerCase().includes(needle));
  }, [rows, q]);

  async function openProducerCard(producerId: string) {
    setCardLoadingId(producerId);
    try {
      const res = await issueCard({ data: { producerId } });
      const token = (res.card as any)?.public_token;
      const cardId = (res.card as any)?.id;
      if (!token) throw new Error("Carte générée sans lien public.");
      if (cardId) void markPrinted({ data: { cardId } });
      window.open(`/p/${token}`, "_blank", "noopener,noreferrer");
    } catch (e: any) {
      setError(e?.message ?? "Impossible de produire la carte.");
    } finally {
      setCardLoadingId(null);
    }
  }

  return (
    <div className="px-5 pt-8 pb-32">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Accueil
      </Link>

      <header className="mt-6">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Agro</p>
        <h1 className="mt-2 font-display text-3xl flex items-center gap-2">
          <Users className="h-7 w-7 text-gold" /> Producteurs
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Tous les producteurs enregistrés par votre organisation.
        </p>
      </header>

      <div className="mt-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher un nom, une coopérative…"
            className="w-full rounded-lg border border-border bg-input/50 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-gold"
          />
        </div>
      </div>

      <div className={`mt-4 rounded-xl border p-3 text-sm ${cardsEnabled ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700" : "border-amber-500/30 bg-amber-500/5 text-amber-700"}`} role="status">
        <div className="flex items-start gap-2">
          <CreditCard className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            <p className="font-medium">Cartes producteurs</p>
            <p className="mt-1 text-xs">{cardFeatureMessage}</p>
          </div>
        </div>
      </div>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg">Résultats</h2>
          {!loading && <span className="text-xs text-muted-foreground">{filtered.length} / {rows.length}</span>}
        </div>

        {loading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-20 animate-pulse rounded-xl bg-card" />)}
          </div>
        )}

        {!loading && error && (
          <div className="glass-card rounded-2xl p-8 text-center">
            <p className="text-sm text-destructive">{error}</p>
          </div>
        )}

        {!loading && !error && filtered.length === 0 && (
          <div className="glass-card rounded-2xl p-8 text-center">
            <Users className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              {rows.length === 0 ? "Aucun producteur enregistré pour l'instant." : "Aucun résultat pour cette recherche."}
            </p>
          </div>
        )}

        <ul className="space-y-2">
          {filtered.map((p) => (
            <li key={p.id} className="glass-card rounded-xl">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
                  <Users className="h-5 w-5 text-gold" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.fullName}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {p.cooperativeName ?? "Sans coopérative"}
                    {p.parcelleCount > 0 && <> · {p.parcelleCount} parcelle{p.parcelleCount > 1 ? "s" : ""}</>}
                  </div>
                  {(p.contactPhone || p.contactEmail) && (
                    <div className="mt-1 flex items-center gap-3 text-[11px] text-muted-foreground">
                      {p.contactPhone && (
                        <span className="flex items-center gap-1"><Phone className="h-3 w-3" /> {p.contactPhone}</span>
                      )}
                      {p.contactEmail && (
                        <span className="flex items-center gap-1"><Mail className="h-3 w-3" /> {p.contactEmail}</span>
                      )}
                    </div>
                  )}
                </div>
                <button
                  type="button"
                  onClick={() => cardsEnabled && void openProducerCard(p.id)}
                  disabled={!cardsEnabled || cardLoadingId === p.id}
                  title={cardsEnabled ? "Créer ou ouvrir la carte du producteur" : "Fonctionnalité non activée ou droits insuffisants"}
                  aria-label={cardsEnabled ? `Créer ou ouvrir la carte de ${p.fullName}` : "Cartes producteurs désactivées"}
                  className={`inline-flex shrink-0 items-center gap-1.5 rounded-lg border px-2.5 py-2 text-xs font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${cardsEnabled ? "border-gold/40 text-gold hover:bg-gold/10" : "border-border text-muted-foreground"}`}
                >
                  {cardLoadingId === p.id
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <CreditCard className="h-4 w-4" />}
                  <span className="hidden sm:inline">{cardsEnabled ? "Carte" : "Cartes off"}</span>
                </button>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
