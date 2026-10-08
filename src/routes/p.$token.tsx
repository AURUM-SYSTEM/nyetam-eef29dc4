import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useState } from "react";
import { Loader2, QrCode, ShieldCheck } from "lucide-react";
import { getPublicProducerCard } from "@/lib/producer-card.functions";

export const Route = createFileRoute("/p/$token")({
  component: PublicProducerCardPage,
  head: () => ({
    meta: [
      { title: "Carte producteur — AURUM" },
      { name: "description", content: "Profil public vérifié d'un producteur enregistré dans AURUM." },
    ],
  }),
});

function PublicProducerCardPage() {
  const { token } = Route.useParams();
  const fetchCard = useServerFn(getPublicProducerCard);
  const [data, setData] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      try {
        setData(await fetchCard({ data: { token } }));
      } catch (e: any) {
        setError(e?.message ?? "Carte introuvable.");
      }
    })();
  }, [fetchCard, token]);

  if (error) {
    return <main className="flex min-h-screen items-center justify-center px-6"><div className="glass-card max-w-md rounded-2xl p-8 text-center"><ShieldCheck className="mx-auto h-10 w-10 text-destructive" /><h1 className="mt-4 font-display text-xl">Carte indisponible</h1><p className="mt-2 text-sm text-muted-foreground">{error}</p></div></main>;
  }

  if (!data) {
    return <main className="flex min-h-screen items-center justify-center"><Loader2 className="h-6 w-6 animate-spin text-gold" /></main>;
  }

  const p = data.producer;
  const publicUrl = typeof window !== "undefined" ? window.location.href : "";
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=220x220&margin=8&data=${encodeURIComponent(publicUrl)}`;

  return (
    <main className="min-h-screen bg-background px-4 py-8">
      <style>{`@media print { body { background: white !important; } .no-print { display:none !important; } .producer-card { box-shadow:none !important; border:1px solid #ddd !important; } }`}</style>
      <div className="no-print mx-auto mb-5 max-w-md text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">Profil public AURUM</p>
        <p className="mt-1 text-xs text-muted-foreground">Scannez le QR pour vérifier l'identité publique de la carte.</p>
      </div>

      <section className="producer-card mx-auto max-w-md rounded-3xl border border-gold/30 bg-card p-6 shadow-xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-display text-2xl gold-text">AURUM</p>
            <p className="mt-1 text-[10px] uppercase tracking-[0.25em] text-muted-foreground">Carte producteur</p>
          </div>
          <ShieldCheck className="h-7 w-7 text-gold" />
        </div>

        <div className="mt-7">
          <p className="text-xs uppercase tracking-widest text-muted-foreground">Producteur</p>
          <h1 className="mt-1 font-display text-3xl">{p.fullName}</h1>
          <p className="mt-2 inline-flex rounded-full border border-gold/30 bg-gold/10 px-2.5 py-1 text-xs text-gold">{p.producerCode}</p>
        </div>

        <div className="mt-6 grid grid-cols-2 gap-3 text-sm">
          <div><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Coopérative</p><p className="mt-1">{p.cooperativeName ?? "Non renseignée"}</p></div>
          <div><p className="text-[10px] uppercase tracking-widest text-muted-foreground">Localisation</p><p className="mt-1">{[p.village, p.commune].filter(Boolean).join(", ") || "Non renseignée"}</p></div>
        </div>

        <div className="mt-7 flex items-center gap-5 border-t border-border pt-5">
          <div className="rounded-xl border border-border bg-white p-2">
            <img src={qrUrl} alt="QR code de vérification AURUM" className="h-28 w-28" />
          </div>
          <div className="min-w-0">
            <QrCode className="h-5 w-5 text-gold" />
            <p className="mt-2 text-xs leading-relaxed text-muted-foreground">Cette carte permet d'accéder au profil public AURUM. Les données professionnelles avancées restent protégées.</p>
          </div>
        </div>

        <p className="mt-5 text-center text-[10px] uppercase tracking-widest text-muted-foreground">Identité publique vérifiable · AURUM SYSTEM</p>
      </section>

      <div className="no-print mx-auto mt-5 flex max-w-md justify-center">
        <button onClick={() => window.print()} className="rounded-xl btn-gold px-5 py-2.5 text-sm">Imprimer la carte</button>
      </div>
    </main>
  );
}
