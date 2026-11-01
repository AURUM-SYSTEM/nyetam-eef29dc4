import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { Loader2, Building2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { AurumLogo, PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/register")({
  component: RegisterPage,
  head: () => ({ meta: [{ title: "Créer un espace — AURUM SYSTEM" }] }),
});

const ORG_TYPES = [
  { value: "agriculture", label: "Agriculture / Agro-industrie", module: "agro" },
  { value: "generic", label: "Entreprise / Exportateur", module: "generic" },
  { value: "ngo", label: "ONG / Projet", module: "ngo" },
  { value: "health", label: "Santé", module: "health" },
] as const;

function RegisterPage() {
  const navigate = useNavigate();
  const [name, setName] = useState("");
  const [orgName, setOrgName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [orgType, setOrgType] = useState<(typeof ORG_TYPES)[number]["value"]>("agriculture");
  const [orgKind, setOrgKind] = useState<"independent" | "cooperative" | "union">("independent");
  const [busy, setBusy] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || !orgName.trim()) return toast.error("Renseignez votre nom et celui de l'organisation.");
    setBusy(true);
    const selected = ORG_TYPES.find(x => x.value === orgType)!;
    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        data: {
          full_name: name.trim(),
          organization_name: orgName.trim(),
          organization_type: orgType,
          module_type: selected.module,
          organization_kind: orgKind,
          country: "Cameroun",
          profession: "Administrateur",
          preferred_lang: "fr",
        },
      },
    });
    setBusy(false);
    if (error) return toast.error(error.message);
    if (data.session) {
      toast.success("Votre espace AURUM est créé. Bienvenue !");
      navigate({ to: "/" });
    } else {
      toast.success("Vérifiez votre boîte e-mail pour confirmer votre adresse et activer votre espace AURUM.");
      navigate({ to: "/login" });
    }
  }

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-white via-gray-50 to-[#eef3ee] font-sans text-gray-900">
      <header className="mx-auto flex w-full max-w-5xl items-center px-6 py-6">
        <Link to="/welcome" className="flex items-center gap-3"><AurumLogo /><span className="text-sm font-semibold tracking-[0.2em] text-[#1B5E20]">AURUM</span></Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-5 pb-14">
        <section className="w-full max-w-xl rounded-2xl border border-gray-100 bg-white p-6 shadow-md shadow-gray-200/60 sm:p-8">
          <Building2 className="h-9 w-9 text-[#1B5E20]" />
          <h1 className="mt-3 text-2xl font-bold">Créer votre espace AURUM</h1>
          <p className="mt-2 text-sm leading-6 text-gray-600">Les entreprises, exportateurs, coopératives et organisations peuvent ouvrir immédiatement leur propre espace. La confirmation de votre adresse e-mail sécurise l'activation.</p>
          <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
            <label className="text-sm">Votre nom complet<input required maxLength={160} value={name} onChange={e=>setName(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-3" /></label>
            <label className="text-sm">Nom de l'organisation<input required maxLength={200} value={orgName} onChange={e=>setOrgName(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-3" /></label>
            <label className="text-sm sm:col-span-2">Type d'organisation<select value={orgType} onChange={e=>setOrgType(e.target.value as any)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-3">{ORG_TYPES.map(x=><option key={x.value} value={x.value}>{x.label}</option>)}</select></label>
            {orgType === "agriculture" && <label className="text-sm sm:col-span-2">Structure<select value={orgKind} onChange={e=>setOrgKind(e.target.value as any)} className="mt-1 w-full rounded-xl border border-gray-300 bg-white px-3 py-3"><option value="independent">Entreprise agricole indépendante</option><option value="cooperative">Coopérative</option><option value="union">Union / faitière</option></select></label>}
            <label className="text-sm sm:col-span-2">Adresse e-mail<input type="email" required autoComplete="email" value={email} onChange={e=>setEmail(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-3" /></label>
            <label className="text-sm sm:col-span-2">Mot de passe<input type="password" required minLength={8} autoComplete="new-password" value={password} onChange={e=>setPassword(e.target.value)} className="mt-1 w-full rounded-xl border border-gray-300 bg-gray-50 px-3 py-3" /></label>
            <button disabled={busy} className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl bg-[#1B5E20] px-4 py-3 font-semibold text-white disabled:opacity-50 sm:col-span-2">{busy ? <Loader2 className="h-4 w-4 animate-spin"/> : null}Créer mon espace</button>
          </form>
          <p className="mt-5 text-center text-sm text-gray-500">Vous avez déjà un compte ? <Link to="/login" className="font-semibold text-[#1B5E20]">Se connecter</Link></p>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
