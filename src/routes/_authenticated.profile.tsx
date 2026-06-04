import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { ArrowLeft, Save, LogOut, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { getProfile, saveProfile, type AurumProfile } from "@/lib/profile-store";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/use-auth";
import { COUNTRIES } from "@/lib/countries";
import { SECTORS } from "@/lib/sector-context";
import { ROLES } from "@/lib/role-context";


export const Route = createFileRoute("/_authenticated/profile")({
  component: ProfilePage,
  head: () => ({ meta: [{ title: "Profil — AURUM" }] }),
});

function ProfilePage() {
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const { user, profile, updateProfile, signOut, refreshProfile } = useAuth();
  const [local, setLocal] = useState<AurumProfile>({ name: "", role: "", defaultLocation: "", signature: "" });
  const [fullName, setFullName] = useState("");
  const [country, setCountry] = useState("");
  const [profession, setProfession] = useState("");
  const [preferredLang, setPreferredLang] = useState<"fr" | "en">(lang);
  const [secteur, setSecteur] = useState<string>("ong_humanitaire");
  const [roleMetier, setRoleMetier] = useState<string>("agent_terrain");
  const [busy, setBusy] = useState(false);


  useEffect(() => { setLocal(getProfile()); }, []);
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name);
      setCountry(profile.country);
      setProfession(profile.profession);
      setPreferredLang(profile.preferred_lang);
      setSecteur(profile.secteur_activite || "ong_humanitaire");
      setRoleMetier(profile.role_metier || "agent_terrain");
    }
  }, [profile]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const updated = await updateProfile({
      full_name: fullName, country, profession, preferred_lang: preferredLang,
      secteur_activite: secteur, role_metier: roleMetier,
    } as any);

    saveProfile(local);
    setBusy(false);
    if (!updated) { toast.error("Erreur lors de l'enregistrement"); return; }
    setLang(preferredLang);
    toast.success(t("doc.saved_ok"));
    await refreshProfile();
  }

  async function logout() {
    await signOut();
    toast.success(t("auth.signed_out"));
    navigate({ to: "/login" });
  }

  return (
    <div className="px-5 pt-8 pb-32">
      <Link to="/" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="h-4 w-4" /> {t("common.back")}
      </Link>
      <header className="mt-6">
        <h1 className="font-display text-3xl">{t("profile.title")}</h1>
        <p className="mt-2 text-sm text-muted-foreground">{t("profile.sub")}</p>
      </header>

      <section className="mt-6 glass-card rounded-2xl p-4">
        <h2 className="text-xs uppercase tracking-widest text-gold-soft">{t("profile.account")}</h2>
        <p className="mt-2 text-sm">{user?.email}</p>
        <button onClick={logout} className="mt-3 inline-flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2 text-sm text-muted-foreground hover:text-destructive">
          <LogOut className="h-4 w-4" /> {t("profile.logout")}
        </button>
      </section>

      <form onSubmit={submit} className="mt-6 space-y-4">
        <Field label={t("profile.name")} value={fullName} onChange={setFullName} />

        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{t("profile.country")}</span>
          <select value={country} onChange={e => setCountry(e.target.value)}
            className="w-full rounded-xl border border-border bg-input/50 px-4 py-3 text-sm outline-none focus:border-gold">
            <option value="">—</option>
            {COUNTRIES.map(c => <option key={c.code} value={c.code}>{lang === "en" ? c.en : c.fr}</option>)}
          </select>
        </label>

        <Field label={t("profile.role")} value={profession} onChange={setProfession} />

        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
            {lang === "en" ? "Sector of activity" : "Secteur d'activité"}
          </span>
          <select value={secteur} onChange={e => setSecteur(e.target.value)}
            className="w-full rounded-xl border border-border bg-input/50 px-4 py-3 text-sm outline-none focus:border-gold">
            {SECTORS.map(s => (
              <option key={s.key} value={s.key}>{lang === "en" ? s.en : s.fr}</option>
            ))}
          </select>
        </label>

        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">
            {lang === "en" ? "Field role" : "Rôle métier"}
          </span>
          <select value={roleMetier} onChange={e => setRoleMetier(e.target.value)}
            className="w-full rounded-xl border border-border bg-input/50 px-4 py-3 text-sm outline-none focus:border-gold">
            {ROLES.map(r => (
              <option key={r.key} value={r.key}>{lang === "en" ? r.en : r.fr}</option>
            ))}
          </select>
        </label>


        <label className="block">
          <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{t("profile.preferred_lang")}</span>
          <div className="grid grid-cols-2 gap-2">
            {(["fr","en"] as const).map(l => (
              <button type="button" key={l} onClick={() => setPreferredLang(l)}
                className={`rounded-lg border px-3 py-2 text-sm ${preferredLang===l?"border-gold bg-gold/10 text-gold":"border-border text-muted-foreground"}`}>
                {l === "fr" ? "Français" : "English"}
              </button>
            ))}
          </div>
        </label>

        <Field label={t("profile.default_location")} value={local.defaultLocation} onChange={v => setLocal({ ...local, defaultLocation: v })} />
        <Field label={t("profile.signature")} value={local.signature} onChange={v => setLocal({ ...local, signature: v })} />

        <button type="submit" disabled={busy} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl btn-gold px-6 py-4 disabled:opacity-40">
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} {t("profile.save")}
        </button>
      </form>
    </div>
  );
}

function Field({ label, value, onChange }: { label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs uppercase tracking-widest text-muted-foreground">{label}</span>
      <input value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-xl border border-border bg-input/50 px-4 py-3 text-sm outline-none focus:border-gold" />
    </label>
  );
}
