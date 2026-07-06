import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Loader2, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/i18n";
import { useAuth } from "@/hooks/use-auth";
import { COUNTRIES } from "@/lib/countries";
import { AurumLogo, PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/register")({
  component: RegisterPage,
  head: () => ({ meta: [{ title: "Create an Account — AURUM SYSTEM" }] }),
});

function RegisterPage() {
  const { t, lang, setLang } = useI18n();
  const navigate = useNavigate();
  const { session, loading } = useAuth();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [country, setCountry] = useState("");
  const [profession, setProfession] = useState("");
  const [preferredLang, setPreferredLang] = useState<"fr" | "en">(lang);
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (!loading && session) navigate({ to: "/" }); }, [loading, session, navigate]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    const { error } = await supabase.auth.signUp({
      email, password,
      options: {
        emailRedirectTo: `${window.location.origin}/`,
        data: { full_name: fullName, country, profession, preferred_lang: preferredLang },
      },
    });
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setLang(preferredLang);
    toast.success(t("auth.account_created"));
    navigate({ to: "/" });
  }

  async function google() {
    setBusy(true);
    // OAuth Google natif Supabase (indépendant de l'hébergement Lovable).
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: {
        redirectTo: `${window.location.origin}/login`,
        // La passerelle Supabase (nouvelles clés sb_publishable_…) exige
        // l'apikey sur /auth/v1/authorize ; supabase-js ne l'ajoute pas lui-même.
        queryParams: { apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY as string },
      },
    });
    if (error) { toast.error(error.message); setBusy(false); }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-white via-gray-50 to-[#eef3ee] font-sans text-gray-900">
      <header className="fade-in-soft mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <Link to="/welcome" className="flex items-center gap-3">
          <AurumLogo />
          <span className="text-sm font-semibold tracking-[0.2em] text-[#1B5E20]">AURUM</span>
        </Link>
      </header>

      <main className="flex flex-1 items-start justify-center px-6 pb-16 pt-2">
        <div className="fade-in-soft w-full max-w-md">
          <div className="mb-8 text-center">
            <h1 className="text-3xl font-bold tracking-tight text-gray-900 sm:text-4xl">Create an Account</h1>
            <p className="mt-2 text-sm text-gray-600">Set up your workspace and start collecting in minutes.</p>
          </div>

          <div className="rounded-2xl border border-gray-100 bg-white p-6 shadow-md shadow-gray-200/60 sm:p-8">
            <button
              onClick={google}
              disabled={busy}
              className="flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-4 py-3 text-sm font-medium text-gray-700 transition-colors hover:border-[#D4A017] hover:text-[#1B5E20] disabled:opacity-40"
            >
              <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden><path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.4 29.2 35 24 35c-6.1 0-11-4.9-11-11s4.9-11 11-11c2.8 0 5.3 1 7.3 2.7l5.7-5.7C33.6 7.1 29 5 24 5 12.4 5 3 14.4 3 26s9.4 21 21 21 21-9.4 21-21c0-1.9-.2-3.7-.4-5.5z"/><path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 16.1 19 13 24 13c2.8 0 5.3 1 7.3 2.7l5.7-5.7C33.6 7.1 29 5 24 5 16.3 5 9.5 9.4 6.3 14.7z"/><path fill="#4CAF50" d="M24 47c5.2 0 10-2 13.6-5.3l-6.3-5.3C29.3 38 26.8 39 24 39c-5.2 0-9.6-2.6-11.2-6.7l-6.5 5C9.4 42.5 16.1 47 24 47z"/><path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.1-4 5.4l6.3 5.3C41.2 36 45 30.5 45 26c0-1.9-.2-3.7-.4-5.5z"/></svg>
              Continue with Google
            </button>

            <div className="my-5 flex items-center gap-3 text-[10px] font-medium uppercase tracking-widest text-gray-400">
              <div className="h-px flex-1 bg-gray-200" /> or <div className="h-px flex-1 bg-gray-200" />
            </div>

            <form onSubmit={submit} className="space-y-4">
              <Field label="Full name" value={fullName} onChange={setFullName} required />
              <Field label="Email" type="email" value={email} onChange={setEmail} required />
              <Field label="Password" type="password" value={password} onChange={setPassword} required minLength={6} />

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-gray-700">Country</span>
                <select required value={country} onChange={e => setCountry(e.target.value)}
                  className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 outline-none transition-colors focus:border-[#1B5E20] focus:bg-white">
                  <option value="">—</option>
                  {COUNTRIES.map(c => <option key={c.code} value={c.code}>{lang === "en" ? c.en : c.fr}</option>)}
                </select>
              </label>

              <Field label="Profession" value={profession} onChange={setProfession} required placeholder={t("auth.profession_ph")} />

              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-gray-700">Preferred language</span>
                <div className="grid grid-cols-2 gap-2">
                  {(["fr","en"] as const).map(l => (
                    <button type="button" key={l} onClick={() => setPreferredLang(l)}
                      className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition-colors ${
                        preferredLang===l
                          ? "border-[#1B5E20] bg-[#1B5E20]/5 text-[#1B5E20]"
                          : "border-gray-300 text-gray-500 hover:border-gray-400"
                      }`}>
                      {l === "fr" ? "Français" : "English"}
                    </button>
                  ))}
                </div>
              </label>

              <button type="submit" disabled={busy}
                className="mt-1 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1B5E20] px-4 py-3 text-sm font-semibold text-white shadow-md shadow-[#1B5E20]/20 transition-colors hover:bg-[#2E7D32] disabled:opacity-40">
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />}
                Create an Account
              </button>
            </form>
          </div>

          <p className="mt-5 text-center text-sm text-gray-600">
            Already have an account?{" "}
            <Link to="/login" className="font-semibold text-[#1B5E20] hover:underline">Sign In</Link>
          </p>
        </div>
      </main>

      <PublicFooter />
    </div>
  );
}

function Field({ label, value, onChange, type = "text", required, minLength, placeholder }: {
  label: string; value: string; onChange: (v: string) => void; type?: string; required?: boolean; minLength?: number; placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-gray-700">{label}</span>
      <input type={type} required={required} minLength={minLength} placeholder={placeholder}
        value={value} onChange={e => onChange(e.target.value)}
        className="w-full rounded-xl border border-gray-300 bg-gray-50 px-3.5 py-2.5 text-sm text-gray-900 outline-none transition-colors focus:border-[#1B5E20] focus:bg-white" />
    </label>
  );
}
