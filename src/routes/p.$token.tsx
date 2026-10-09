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
      { name: "description", content: "Carte producteur AURUM imprimable avec QR code de vérification." },
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
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=240x240&margin=4&data=${encodeURIComponent(publicUrl)}`;
  const initials = String(p.fullName ?? "P").trim().split(/\\s+/).slice(0, 2).map((part: string) => part[0] ?? "").join("").toUpperCase();

  return (
    <main className="producer-card-page min-h-screen bg-background px-4 py-8">
      <style>{`
        .producer-id-card { width: min(100%, 540px); aspect-ratio: 85.6 / 54; overflow: hidden; position: relative; color: #17382c; background: #fff; border: 1px solid #d8e5dc; border-radius: 16px; box-shadow: 0 18px 45px rgba(0,0,0,.12); }
        .producer-id-header { height: 21%; background: #123f30; color: white; display:flex; align-items:center; justify-content:space-between; padding: 0 5%; }
        .producer-id-body { height: 79%; display:grid; grid-template-columns: 1fr auto; gap: 3%; align-items:center; padding: 3% 5%; }
        .producer-id-label { font-size: clamp(6px, 1.55vw, 9px); text-transform:uppercase; letter-spacing:.12em; color:#63766d; }
        .producer-id-value { font-size: clamp(8px, 2.1vw, 12px); line-height:1.25; overflow-wrap:anywhere; color:#17382c; }
        .producer-id-name { font-size: clamp(13px, 3.8vw, 22px); line-height:1.1; font-weight:800; overflow-wrap:anywhere; }
        .producer-id-code { display:inline-block; border:1px solid #c8dfd0; background:#eff8f1; border-radius:4px; padding:3px 6px; font-size:clamp(7px,1.7vw,10px); font-weight:700; }
        .producer-id-qr { width:clamp(60px, 20vw, 112px); aspect-ratio:1; object-fit:contain; }
        .producer-id-photo { width:clamp(66px, 19vw, 98px); height:clamp(78px, 23vw, 116px); object-fit:cover; border:2px solid #d7e7dc; border-radius:7px; background:#f0f5f1; }
        .producer-id-back { background:linear-gradient(145deg,#ffffff 0%,#f1f7f2 100%); }
        .producer-id-back-content { height:79%; display:flex; flex-direction:column; justify-content:space-between; padding:4% 5%; }
        @media print {
          @page { size: 85.6mm 54mm; margin: 0; }
          html, body { width:85.6mm !important; height:54mm !important; margin:0 !important; padding:0 !important; background:#fff !important; }
          body * { visibility:hidden !important; }
          .producer-id-card, .producer-id-card * { visibility:visible !important; }
          .producer-card-page { width:85.6mm !important; height:54mm !important; min-height:0 !important; padding:0 !important; margin:0 !important; background:#fff !important; }
          .producer-id-card { width:85.6mm !important; height:54mm !important; aspect-ratio:auto !important; page-break-after:always; break-after:page; border:0.3mm solid #d8e5dc !important; border-radius:2mm !important; box-shadow:none !important; print-color-adjust:exact; -webkit-print-color-adjust:exact; }
          .no-print { display:none !important; }
          .producer-id-label { font-size:6pt !important; }
          .producer-id-value { font-size:7.5pt !important; }
          .producer-id-name { font-size:14pt !important; }
          .producer-id-code { font-size:7pt !important; }
          .producer-id-qr { width:21mm !important; height:21mm !important; }
          .producer-id-photo { width:18mm !important; height:22mm !important; border-radius:1mm !important; }
          .producer-id-back-content { height:79% !important; }
        }
      `}</style>

      <div className="no-print mx-auto mb-5 max-w-xl text-center">
        <p className="text-xs uppercase tracking-[0.3em] text-muted-foreground">AURUM AGRO · Carte producteur</p>
        <p className="mt-2 text-sm text-muted-foreground">Carte recto-verso · 85,6 × 54 mm. Imprime les deux pages en recto-verso, retournement sur bord court.</p>
      </div>

      <section className="producer-id-card mx-auto">
        <header className="producer-id-header">
          <div>
            <p style={{ fontSize: "clamp(13px, 3vw, 20px)", fontWeight: 900, letterSpacing: ".12em", lineHeight: 1 }}>AURUM</p>
            <p style={{ fontSize: "clamp(6px, 1.4vw, 8px)", letterSpacing: ".16em", marginTop: 3 }}>AGRO · IDENTITÉ PRODUCTEUR</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 5, fontSize: "clamp(6px, 1.5vw, 9px)" }}>
            <ShieldCheck style={{ width: "clamp(14px, 3vw, 20px)", height: "auto" }} />
            <span>PROFIL VÉRIFIABLE</span>
          </div>
        </header>

        <div className="producer-id-body">
          <div style={{ minWidth: 0, display: "flex", alignItems: "center", gap: "clamp(5px, 1.4vw, 10px)" }}>
            {p.photoUrl ? <img className="producer-id-photo" src={p.photoUrl} alt="Photo du producteur" /> : <div className="producer-id-photo" style={{ display: "flex", alignItems: "center", justifyContent: "center", fontSize: "8px", textAlign: "center", padding: "2px" }}>PHOTO</div>}
            <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: "clamp(4px, 1.3vw, 8px)" }}>
            <div>
              <p className="producer-id-label">Nom du producteur</p>
              <h1 className="producer-id-name mt-1">{p.fullName || "Nom non renseigné"}</h1>
            </div>
            <div>
              <p className="producer-id-label">Identifiant producteur</p>
              <p className="producer-id-code mt-1">{p.producerCode}</p>
            </div>
            <div>
              <p className="producer-id-label">Coopérative</p>
              <p className="producer-id-value mt-1 font-semibold">{p.cooperativeName ?? "Non renseignée"}</p>
            </div>
            <div>
              <p className="producer-id-label">Village / Commune</p>
              <p className="producer-id-value mt-1">{[p.village, p.commune].filter(Boolean).join(" / ") || "Non renseigné"}</p>
            </div>
            <p style={{ fontSize: "clamp(5px, 1.25vw, 7px)", color: "#63766d" }}>Carte de référencement AURUM AGRO · Ne remplace pas une pièce officielle d'identité.</p>
            </div>
          </div>

          <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <img src={qrUrl} alt="QR code de vérification AURUM" className="producer-id-qr" />
            <span style={{ fontSize: "clamp(5px, 1.25vw, 7px)", color: "#63766d", textAlign: "center" }}><QrCode style={{ display: "inline", width: 10, height: 10, verticalAlign: "middle" }} /> VÉRIFIER</span>
          </div>
        </div>
      </section>

      <section className="producer-id-card producer-id-back mx-auto" aria-label="Verso de la carte producteur">
        <header className="producer-id-header">
          <div>
            <p style={{ fontSize: "clamp(13px, 3vw, 20px)", fontWeight: 900, letterSpacing: ".12em", lineHeight: 1 }}>AURUM</p>
            <p style={{ fontSize: "clamp(6px, 1.4vw, 8px)", letterSpacing: ".16em", marginTop: 3 }}>AGRO · TRAÇABILITÉ RESPONSABLE</p>
          </div>
          <span style={{ fontSize: "clamp(6px, 1.5vw, 9px)", letterSpacing: ".12em" }}>VERSO</span>
        </header>
        <div className="producer-id-back-content">
          <div>
            <p className="producer-id-label">Profil producteur</p>
            <p className="producer-id-name" style={{ fontSize: "clamp(11px, 3vw, 18px)", marginTop: 3 }}>{p.fullName || "Producteur AURUM AGRO"}</p>
            <p className="producer-id-value" style={{ marginTop: 5 }}>Code : {p.producerCode}</p>
            <p className="producer-id-value" style={{ marginTop: 3 }}>Zone : {[p.village, p.commune, p.department, p.region].filter(Boolean).join(" · ") || "Non renseignée"}</p>
          </div>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontSize: "clamp(7px, 1.8vw, 10px)", fontWeight: 800, color: "#17432f" }}>Une identité agricole, une traçabilité plus claire.</p>
              <p style={{ fontSize: "clamp(5px, 1.25vw, 7px)", color: "#63766d", marginTop: 4 }}>Cette carte référence le producteur dans AURUM AGRO. Elle ne constitue pas une pièce officielle d'identité.</p>
            </div>
            <img src={qrUrl} alt="QR code de vérification" className="producer-id-qr" />
          </div>
        </div>
      </section>

      <div className="no-print mx-auto mt-5 flex max-w-xl flex-col items-center gap-2">
        <button onClick={() => window.print()} className="rounded-xl btn-gold px-6 py-3 text-sm font-semibold">Imprimer la carte au format identité</button>
        <p className="text-center text-xs text-muted-foreground">Dans la fenêtre d'impression, choisissez « Taille réelle » ou 100 % si l'option est disponible.</p>
      </div>
    </main>
  );
}
