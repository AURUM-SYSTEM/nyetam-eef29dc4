import { createFileRoute, Link, useParams, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Download, Save, Trash2, Loader2, Share2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { exportDocumentPdf } from "@/lib/pdf";
import { useI18n } from "@/i18n";

export const Route = createFileRoute("/_authenticated/document/$id")({
  component: DocPage,
  head: () => ({ meta: [{ title: "Document — AURUM" }] }),
});

type Doc = {
  id: string;
  type: "rapport" | "pv" | "recensement";
  title: string;
  transcript: string;
  introduction: string;
  faits: string;
  declarations: string;
  observations: string;
  conclusion: string;
  created_at: string;
  doc_date: string | null;
  doc_time: string | null;
  agent_name: string;
  location: string;
  reference: string;
  signature_name: string;
  lang: string;
  photo_urls: string[] | null;
};

function typeLabel(type: Doc["type"], t: (k: string) => string) {
  if (type === "rapport") return t("doc.type_rapport");
  if (type === "pv") return t("doc.type_pv");
  return "Recensement";
}

function DocPage() {
  const { id } = useParams({ from: "/_authenticated/document/$id" });
  const navigate = useNavigate();
  const { t } = useI18n();
  const [doc, setDoc] = useState<Doc | null>(null);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      const { data, error } = await supabase.from("documents").select("*").eq("id", id).single();
      if (error) { toast.error(error.message); return; }
      setDoc(data as Doc);
    })();
  }, [id]);

  function patch<K extends keyof Doc>(k: K, v: Doc[K]) {
    setDoc(d => d ? { ...d, [k]: v } : d);
    setDirty(true);
  }

  async function save() {
    if (!doc) return;
    setSaving(true);
    const { error } = await supabase
      .from("documents")
      .update({
        title: doc.title,
        introduction: doc.introduction,
        faits: doc.faits,
        declarations: doc.declarations,
        observations: doc.observations,
        conclusion: doc.conclusion,
        agent_name: doc.agent_name,
        location: doc.location,
        reference: doc.reference,
        signature_name: doc.signature_name,
        doc_date: doc.doc_date,
        doc_time: doc.doc_time,
      })
      .eq("id", doc.id);
    setSaving(false);
    if (error) toast.error(error.message);
    else { setDirty(false); toast.success(t("doc.saved_ok")); }
  }

  async function remove() {
    if (!doc) return;
    if (!confirm(t("doc.delete_confirm"))) return;
    const { error } = await supabase.from("documents").delete().eq("id", doc.id);
    if (error) toast.error(error.message);
    else navigate({ to: "/" });
  }

  function download() {
    if (!doc) return;
    exportDocumentPdf(doc);
    toast.success(t("doc.pdf_ok"));
  }

  async function share() {
    if (!doc) return;
    const parts = [
      doc.title,
      `${t("doc.context")}\n${doc.introduction}`,
      `${t("doc.facts")}\n${doc.faits}`,
      `${t("doc.declarations")}\n${doc.declarations}`,
      `${t("doc.observations")}\n${doc.observations}`,
      `${t("doc.conclusion")}\n${doc.conclusion}`,
    ];
    const full = parts.join("\n\n");
    const navAny = navigator as any;
    if (navAny.share) {
      try { await navAny.share({ title: doc.title, text: full }); } catch {}
    } else {
      await navigator.clipboard.writeText(full);
      toast.success("Copié");
    }
  }

  if (!doc) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-gold" />
      </div>
    );
  }

  const dateFmt = doc.lang === "en" ? "en-GB" : "fr-FR";
  const dateDisplay = doc.doc_date
    ? new Date(doc.doc_date).toLocaleDateString(dateFmt, { day: "2-digit", month: "long", year: "numeric" })
    : new Date(doc.created_at).toLocaleDateString(dateFmt, { day: "2-digit", month: "long", year: "numeric" });
  const timeDisplay = doc.doc_time
    ? doc.doc_time.slice(0, 5)
    : new Date(doc.created_at).toLocaleTimeString(dateFmt, { hour: "2-digit", minute: "2-digit" });

  const isRecensement = doc.type === "recensement";
  const sections: Array<{ key: keyof Doc; label: string }> = isRecensement
    ? [
        { key: "introduction", label: "Contexte de la mission" },
        { key: "faits", label: "Identification du bénéficiaire" },
        { key: "declarations", label: "Déclarations recueillies" },
        { key: "observations", label: "Observations terrain" },
        { key: "conclusion", label: "Évaluation & suivi recommandé" },
      ]
    : [
        { key: "introduction", label: t("doc.context") },
        { key: "faits", label: t("doc.facts") },
        { key: "declarations", label: t("doc.declarations") },
        { key: "observations", label: t("doc.observations") },
        { key: "conclusion", label: t("doc.conclusion") },
      ];

  return (
    <div className="px-5 pt-8 pb-40">
      <div className="flex items-center justify-between">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-4 w-4" /> {t("common.home")}
        </Link>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setEditing(e => !e)}
            className={`inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 text-xs transition ${
              editing ? "border-gold bg-gold/10 text-gold" : "border-border text-muted-foreground hover:text-foreground"
            }`}
          >
            <Pencil className="h-3.5 w-3.5" /> {t("doc.edit_doc")}
          </button>
          <button onClick={remove} className="p-2 text-muted-foreground hover:text-destructive">
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Header */}
      <header className="mt-6">
        <span className="rounded bg-accent px-2 py-0.5 text-[10px] uppercase tracking-wider text-gold-soft">
          {typeLabel(doc.type, t)}
        </span>
        {editing ? (
          <input
            value={doc.title}
            onChange={e => patch("title", e.target.value)}
            className="mt-3 w-full bg-transparent font-display text-3xl leading-tight outline-none focus:text-gold"
          />
        ) : (
          <h1 className="mt-3 font-display text-3xl leading-tight">{doc.title}</h1>
        )}
        {doc.reference && (
          <div className="mt-1 text-xs text-gold-soft">{t("doc.ref")}: {doc.reference}</div>
        )}
      </header>

      {/* Infos générales */}
      <section className="mt-6 glass-card rounded-2xl p-4">
        <h2 className="mb-3 text-xs uppercase tracking-widest text-gold-soft">{t("doc.info_general")}</h2>
        {editing ? (
          <div className="grid grid-cols-2 gap-3">
            <MetaInput label={t("doc.date")} type="date" value={doc.doc_date ?? ""} onChange={v => patch("doc_date", v as any)} />
            <MetaInput label={t("doc.time")} type="time" value={doc.doc_time ?? ""} onChange={v => patch("doc_time", v as any)} />
            <MetaInput label={t("doc.agent")} value={doc.agent_name} onChange={v => patch("agent_name", v)} full />
            <MetaInput label={t("doc.location")} value={doc.location} onChange={v => patch("location", v)} full />
            <MetaInput label={t("doc.ref")} value={doc.reference} onChange={v => patch("reference", v)} full />
            <MetaInput label={t("doc.signed_by")} value={doc.signature_name} onChange={v => patch("signature_name", v)} full />
          </div>
        ) : (
          <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
            <Row label={t("doc.date")} value={dateDisplay} />
            <Row label={t("doc.time")} value={timeDisplay} />
            <Row label={t("doc.agent")} value={doc.agent_name || "—"} />
            <Row label={t("doc.location")} value={doc.location || "—"} />
            <Row label={t("doc.type")} value={typeLabel(doc.type, t)} />
            <Row label={t("doc.ref")} value={doc.reference || "—"} />
          </dl>
        )}
      </section>

      {/* Sections */}
      <div className="mt-6 space-y-4">
        {sections.map(s => (
          <section key={String(s.key)} className="glass-card rounded-xl p-4">
            <h2 className="mb-2 font-display text-base uppercase tracking-wider text-gold">{s.label}</h2>
            {editing ? (
              <textarea
                value={String(doc[s.key] ?? "")}
                onChange={e => patch(s.key, e.target.value as any)}
                rows={Math.max(4, Math.ceil(String(doc[s.key] ?? "").length / 60))}
                className="w-full resize-y bg-transparent text-sm leading-relaxed outline-none"
              />
            ) : (
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">{String(doc[s.key] ?? "—")}</p>
            )}
          </section>
        ))}

        {doc.transcript && doc.transcript.trim().length > 0 && (
          <section className="glass-card rounded-xl p-4">
            <h2 className="mb-2 font-display text-base uppercase tracking-wider text-gold">
              Transcription audio
            </h2>
            <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/80">
              {doc.transcript}
            </p>
          </section>
        )}

        {doc.photo_urls && doc.photo_urls.length > 0 && (
          <section className="glass-card rounded-xl p-4">
            <h2 className="mb-3 font-display text-base uppercase tracking-wider text-gold">Photos terrain</h2>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
              {doc.photo_urls.map((url, i) => (
                <a key={i} href={url} target="_blank" rel="noreferrer" className="block aspect-square overflow-hidden rounded-lg border border-border">
                  <img src={url} alt={`Photo ${i + 1}`} loading="lazy" className="h-full w-full object-cover transition hover:scale-105" />
                </a>
              ))}
            </div>
          </section>
        )}

        {/* Signature */}
        <section className="glass-card rounded-xl p-4">
          <h2 className="mb-3 font-display text-base uppercase tracking-wider text-gold">{t("doc.signature")}</h2>
          <p className="text-sm text-muted-foreground">{t("doc.signed_by")} : <span className="text-foreground">{doc.signature_name || doc.agent_name || "—"}</span></p>
          <div className="mt-3 h-20 rounded-md border border-dashed border-border/60" />
        </section>
      </div>

      {/* Sticky action bar */}
      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-xl items-center gap-2 px-5 py-3">
          {editing && (
            <button
              onClick={save}
              disabled={!dirty || saving}
              className="flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border bg-card px-3 py-3 text-sm disabled:opacity-40"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              {dirty ? t("common.save") : t("common.saved")}
            </button>
          )}
          <button
            onClick={share}
            className="rounded-lg border border-border bg-card px-3 py-3 text-sm"
            aria-label={t("common.share")}
          >
            <Share2 className="h-4 w-4" />
          </button>
          <button
            onClick={download}
            className="flex flex-[1.4] items-center justify-center gap-1.5 rounded-lg btn-gold px-3 py-3 text-sm"
          >
            <Download className="h-4 w-4" /> {t("doc.export_pdf")}
          </button>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-[10px] uppercase tracking-widest text-muted-foreground">{label}</dt>
      <dd className="text-sm">{value}</dd>
    </>
  );
}

function MetaInput({ label, value, onChange, type = "text", full = false }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; full?: boolean;
}) {
  return (
    <label className={full ? "col-span-2 block" : "block"}>
      <span className="mb-1 block text-[10px] uppercase tracking-widest text-muted-foreground">{label}</span>
      <input
        type={type}
        value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full rounded-lg border border-border bg-input/50 px-3 py-2 text-sm outline-none focus:border-gold"
      />
    </label>
  );
}
