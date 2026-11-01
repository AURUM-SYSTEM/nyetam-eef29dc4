import { createFileRoute, Link } from "@tanstack/react-router";
import { ShieldCheck } from "lucide-react";
import { AurumLogo, PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/register")({
  component: RegistrationClosedPage,
  head: () => ({ meta: [{ title: "Accès sur invitation — AURUM SYSTEM" }] }),
});

function RegistrationClosedPage() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-white via-gray-50 to-[#eef3ee] font-sans text-gray-900">
      <header className="mx-auto flex w-full max-w-5xl items-center px-6 py-6">
        <Link to="/welcome" className="flex items-center gap-3">
          <AurumLogo />
          <span className="text-sm font-semibold tracking-[0.2em] text-[#1B5E20]">AURUM</span>
        </Link>
      </header>
      <main className="flex flex-1 items-center justify-center px-6 pb-16">
        <section className="w-full max-w-md rounded-2xl border border-gray-100 bg-white p-7 text-center shadow-md shadow-gray-200/60">
          <ShieldCheck className="mx-auto h-10 w-10 text-[#1B5E20]" />
          <h1 className="mt-4 text-2xl font-bold text-gray-900">Accès sur invitation</h1>
          <p className="mt-3 text-sm leading-6 text-gray-600">
            Les comptes AURUM sont créés par l’administrateur de chaque organisation.
            Si vous devez accéder à un espace de travail, contactez votre administrateur
            pour recevoir une invitation officielle.
          </p>
          <Link to="/login" className="mt-6 inline-flex w-full items-center justify-center rounded-xl bg-[#1B5E20] px-4 py-3 text-sm font-semibold text-white hover:bg-[#2E7D32]">
            J’ai déjà un compte — Se connecter
          </Link>
        </section>
      </main>
      <PublicFooter />
    </div>
  );
}
