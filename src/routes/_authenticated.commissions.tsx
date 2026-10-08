import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { listCooperativeCommissions, createManualCommission, markCommissionPaid } from "@/lib/admin.functions";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/commissions")({
  component: CommissionsPage,
});

function CommissionsPage() {
  const { profile } = useAuth();
  const [rows, setRows] = useState<any[]>([]);
  const [producers, setProducers] = useState<any[]>([]);
  const [amount, setAmount] = useState("");
  const [producerId, setProducerId] = useState("");
  const [note, setNote] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const load = async () => {
    setLoading(true); setError("");
    try {
      const [commissions, prod] = await Promise.all([
        listCooperativeCommissions(),
        supabase.from("producers").select("id, full_name").order("full_name").limit(500),
      ]);
      setRows(commissions.commissions ?? []);
      setProducers(prod.data ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Impossible de charger les commissions.");
    } finally { setLoading(false); }
  };

  useEffect(() => { void load(); }, []);

  const addCommission = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile?.organization_id || !producerId || !amount) return;
    setSaving(true); setError("");
    try {
      await createManualCommission({
        organizationId: profile.organization_id,
        producerId,
        amount: Number(amount),
        currency: "XAF",
        note: note.trim() || undefined,
      });
      setAmount(""); setNote(""); setProducerId("");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors de la saisie.");
    } finally { setSaving(false); }
  };

  const pay = async (id: string) => {
    const ref = window.prompt("Référence du versement (facultatif) :") ?? "";
    try {
      await markCommissionPaid({ commissionId: id, payoutReference: ref || undefined });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur lors du versement.");
    }
  };

  const totalDue = rows.filter(r => r.status !== "paid" && r.status !== "cancelled")
    .reduce((s, r) => s + Number(r.commission_amount || 0), 0);
  const totalPaid = rows.filter(r => r.status === "paid")
    .reduce((s, r) => s + Number(r.commission_amount || 0), 0);

  return (
    <main className="mx-auto w-full max-w-5xl space-y-5 p-4 pb-10">
      <header>
        <p className="text-[10px] uppercase tracking-widest text-gold-soft">AURUM · Transparence</p>
        <h1 className="mt-1 text-2xl font-semibold">Commissions coopérative</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          La coopérative voit les commissions générées par l’utilisation de ses données.
          Le prix payé par l’acheteur reste confidentiel.
        </p>
      </header>

      {error && <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

      <section className="grid grid-cols-2 gap-3">
        <div className="glass-card rounded-2xl p-4"><p className="text-xs text-muted-foreground">À verser</p><p className="mt-1 text-xl font-semibold">{totalDue.toLocaleString("fr-FR")} FCFA</p></div>
        <div className="glass-card rounded-2xl p-4"><p className="text-xs text-muted-foreground">Déjà versé</p><p className="mt-1 text-xl font-semibold">{totalPaid.toLocaleString("fr-FR")} FCFA</p></div>
      </section>

      <section className="glass-card rounded-2xl p-4">
        <h2 className="mb-3 text-sm font-semibold">Saisir une commission</h2>
        <form onSubmit={addCommission} className="space-y-3">
          <select required value={producerId} onChange={e => setProducerId(e.target.value)} className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm">
            <option value="">Choisir le producteur</option>
            {producers.map(p => <option key={p.id} value={p.id}>{p.full_name}</option>)}
          </select>
          <input required type="number" min="0" step="1" value={amount} onChange={e => setAmount(e.target.value)}
            placeholder="Montant de la commission (FCFA)" className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm" />
          <input value={note} onChange={e => setNote(e.target.value)}
            placeholder="Note contractuelle / justificatif (facultatif)" className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm" />
          <button disabled={saving} className="w-full rounded-xl btn-gold px-4 py-2.5 text-sm disabled:opacity-40">
            {saving ? "Enregistrement…" : "Enregistrer la commission"}
          </button>
        </form>
      </section>

      <section className="glass-card rounded-2xl p-4">
        <h2 className="mb-3 text-sm font-semibold">Historique transparent</h2>
        {loading ? <p className="py-6 text-center text-sm text-muted-foreground">Chargement…</p> : rows.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">Aucune commission enregistrée.</p>
        ) : (
          <div className="space-y-2">
            {rows.map(r => (
              <div key={r.id} className="rounded-xl border border-border bg-card/40 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium">{r.producerName}</p>
                    <p className="text-xs text-muted-foreground">{new Date(r.accrued_at).toLocaleDateString("fr-FR")} · {r.status === "paid" ? "Versée" : r.status === "cancelled" ? "Annulée" : "À verser"}</p>
                  </div>
                  <p className="text-sm font-semibold">{Number(r.commission_amount).toLocaleString("fr-FR")} {r.currency}</p>
                </div>
                {r.payment_note && <p className="mt-2 text-xs text-muted-foreground">{r.payment_note}</p>}
                {r.payout_reference && <p className="mt-1 text-[10px] text-muted-foreground">Réf. {r.payout_reference}</p>}
                {r.status !== "paid" && r.status !== "cancelled" && (
                  <button onClick={() => void pay(r.id)} className="mt-2 rounded-lg border border-gold/40 px-3 py-1.5 text-xs text-gold">Marquer comme versée</button>
                )}
              </div>
            ))}
          </div>
        )}
      </section>
    </main>
  );
}
