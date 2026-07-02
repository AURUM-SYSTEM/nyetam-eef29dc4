import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { ArrowLeft, Users, Search, ChevronRight, FileText } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useOnline } from "@/hooks/use-online";
import { useAuth } from "@/hooks/use-auth";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/recensements")({
  component: MyRecordsPage,
  head: () => ({
    meta: [
      { title: "Mes saisies — AURUM" },
      { name: "description", content: "Vos saisies terrain récentes." },
    ],
  }),
});

type Row = {
  id: string;
  type: string;
  mission_type: string | null;
  title: string;
  status: string;
  created_at: string;
  reference: string | null;
  location: string | null;
};

async function fetchMyRecords(userId: string): Promise<Row[]> {
  const { data, error } = await supabase
    .from("documents")
    .select("id,type,mission_type,title,status,created_at,reference,location")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as Row[];
}

const TYPE_LABEL: Record<string, string> = {
  field_entry: "Saisie",
  rapport: "Mission",
  mission_terrain: "Mission",
  pv: "PV",
  enquete: "Enquête",
  recensement: "Recensement",
};


function MyRecordsPage() {
  const online = useOnline();
  const { user } = useAuth();
  const { lang } = useI18n();
  const [q, setQ] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["my-records", user?.id],
    queryFn: () => fetchMyRecords(user!.id),
    enabled: online && !!user?.id,
    staleTime: 10_000,
    retry: false,
  });

  const filtered = useMemo(() => {
    if (!data) return [];
    const needle = q.trim().toLowerCase();
    if (!needle) return data;
    return data.filter((r) => {
      const hay = `${r.title} ${r.reference ?? ""} ${r.location ?? ""}`.toLowerCase();
      return hay.includes(needle);
    });
  }, [data, q]);

  return (
    <div className="px-5 pt-8 pb-32">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> Accueil
      </Link>

      <header className="mt-6">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Mes saisies</p>
        <h1 className="mt-2 font-display text-3xl flex items-center gap-2">
          <Users className="h-7 w-7 text-gold" /> Historique
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Toutes vos saisies terrain récentes.
        </p>
      </header>


      <div className="mt-6">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Rechercher dans mes saisies…"
            className="w-full rounded-lg border border-border bg-input/50 pl-9 pr-3 py-2.5 text-sm outline-none focus:border-gold"
          />
        </div>
      </div>

      <section className="mt-6">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-lg">Résultats</h2>
          {data && (
            <span className="text-xs text-muted-foreground">
              {filtered.length} / {data.length}
            </span>
          )}
        </div>

        {isLoading && (
          <div className="space-y-2">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-20 animate-pulse rounded-xl bg-card" />
            ))}
          </div>
        )}

        {!isLoading && filtered.length === 0 && (
          <div className="glass-card rounded-2xl p-8 text-center">
            <FileText className="mx-auto h-10 w-10 text-muted-foreground" />
            <p className="mt-3 text-sm text-muted-foreground">
              Aucune fiche pour l'instant.
            </p>
            <Link
              to="/recensement"
              className="mt-4 inline-flex items-center gap-1.5 rounded-lg btn-gold px-4 py-2 text-xs"
            >
              <Users className="h-3.5 w-3.5" /> Nouvelle fiche
            </Link>
          </div>
        )}

        <ul className="space-y-2">
          {filtered.map((r) => (
            <li key={r.id} className="glass-card group flex items-center rounded-xl">
              <Link
                to="/document/$id"
                params={{ id: r.id }}
                className="flex flex-1 items-center gap-3 px-4 py-3"
              >
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
                  <Users className="h-5 w-5 text-gold" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="rounded bg-accent px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-gold-soft">
                      Recensement
                    </span>
                    {r.status === "draft" && (
                      <span className="text-[10px] uppercase text-muted-foreground">Brouillon</span>
                    )}
                  </div>
                  <div className="mt-0.5 truncate text-sm font-medium">{r.title}</div>
                  <div className="truncate text-[11px] text-muted-foreground">
                    {new Date(r.created_at).toLocaleString(lang === "en" ? "en-GB" : "fr-FR", {
                      day: "2-digit",
                      month: "short",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {r.location && <> · {r.location}</>}
                    {r.reference && <> · {r.reference}</>}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-muted-foreground" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
