// Liste des parcelles de l'organisation — accessible à tout agent (pas
// réservé aux superviseurs), lecture seule. Réutilise listParcelles(),
// déjà utilisée par le tableau de bord superviseur et déjà scopée par
// organisation côté serveur (getCallerOrg) — aucune nouvelle fonction
// serveur nécessaire.
import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useMemo, useState } from "react";
import { ArrowLeft, MapPin, Search, ChevronRight, Sprout } from "lucide-react";
import { listParcelles } from "@/lib/agro.functions";
import { PendingParcellesQueue } from "@/components/PendingParcellesQueue";

export const Route = createFileRoute("/_authenticated/parcelles")({
  component: ParcellesPage,
  head: () => ({
    meta: [
      { title: "Parcelles — AURUM" },
      { name: "description", content: "Parcelles enregistrées par votre organisation." },
    ],
  }),
});

type ParcelleRow = {
  id: string;
  culture: string;
  surfaceHa: number | null;
  cooperativeName: string | null;
  lat: number;
  lng: number;
  notes: string | null;
  visitCount: number;
};

function ParcellesPage() {
  const fetchParcelles = useServerFn(listParcelles);
  const [rows, setRows] = useState<ParcelleRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchParcelles({ data: undefined as any });
        if (!cancelled) setRows(res.parcelles);
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? "Erreur de chargement");
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
    return rows.filter((r) => `${r.culture} ${r.cooperativeName ?? ""} ${r.notes ?? ""}`.toLowerCase().includes(needle));
  }, [rows, q]);

  return (
    <div className="px-5 pt-8 pb-32">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Accueil
      </Link>

      <header className="mt-6">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Agro</p>
        <h1 className="mt-2 font-display text-3xl flex items-center gap-2">
          <Sprout className="h-7 w-7 text-gold" /> Parcelles
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Toutes les parcelles enregistrées par votre organisation.
        </p>
      </header>

      <div className="mt-6">
        <PendingParcellesQueue />
      </div>

      <div className="mt-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher une culture, une coopérative…"
            className="w-full rounded-lg border border-border bg-input/50 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-gold"
          />
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
            <MapPin className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              {rows.length === 0 ? "Aucune parcelle enregistrée pour l'instant." : "Aucun résultat pour cette recherche."}
            </p>
          </div>
        )}

        <ul className="space-y-2">
          {filtered.map((p) => (
            <li key={p.id} className="glass-card rounded-xl">
              <div className="flex items-center gap-3 px-4 py-3">
                <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-accent">
                  <Sprout className="h-5 w-5 text-gold" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{p.culture}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {p.surfaceHa != null ? `${p.surfaceHa} ha` : "Surface inconnue"}
                    {p.cooperativeName && <> · {p.cooperativeName}</>}
                    {p.visitCount > 0 && <> · {p.visitCount} visite{p.visitCount > 1 ? "s" : ""}</>}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
              </div>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
