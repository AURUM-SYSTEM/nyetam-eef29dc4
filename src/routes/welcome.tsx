// ─────────────────────────────────────────────────────────────────────────
// AURUM — Page publique Landing/Welcome.
// Palette scopée à cet écran (vert profond #1B5E20, or #D4A017, neutres
// clairs) — le reste de l'application conserve son thème noir/or.
// Aucune logique métier ici : page purement présentationnelle.
// ─────────────────────────────────────────────────────────────────────────
import { createFileRoute, Link } from "@tanstack/react-router";
import { ArrowRight, BarChart3, BrainCircuit, LogIn, Mic } from "lucide-react";
import { AurumLogo, PublicFooter } from "@/components/PublicFooter";

export const Route = createFileRoute("/welcome")({
  component: WelcomePage,
  head: () => ({
    meta: [
      { title: "AURUM SYSTEM — Collect. Structure. Decide." },
      {
        name: "description",
        content:
          "Transform field data into structured, reliable and actionable information.",
      },
    ],
  }),
});

const FEATURES = [
  {
    icon: Mic,
    title: "Intelligent Field Collection",
    text: "Capture voice, text, photos and GPS in seconds — even offline. Your teams stay focused on the field, not on forms.",
  },
  {
    icon: BrainCircuit,
    title: "Intelligent Data Core",
    text: "Every entry is transcribed, cleaned and structured by AI into reliable records, categories and indicators — nothing invented, everything traceable.",
  },
  {
    icon: BarChart3,
    title: "Supervision & Reporting",
    text: "Real-time dashboards, activity maps, alerts and governed corrections give supervisors and admins a clear, auditable view of operations.",
  },
];

function WelcomePage() {
  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-b from-white via-gray-50 to-[#eef3ee] font-sans text-gray-900">
      {/* ── En-tête ── */}
      <header className="fade-in-soft mx-auto flex w-full max-w-5xl items-center justify-between px-6 py-6">
        <div className="flex items-center gap-3">
          <AurumLogo />
          <span className="text-sm font-semibold tracking-[0.2em] text-[#1B5E20]">AURUM</span>
        </div>
        <Link
          to="/login"
          className="rounded-full border border-gray-300 bg-white px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:border-[#D4A017] hover:text-[#1B5E20]"
        >
          Sign In
        </Link>
      </header>

      {/* ── Héros ── */}
      <main className="flex-1">
        <section className="fade-in-soft mx-auto max-w-3xl px-6 pb-14 pt-10 text-center sm:pt-16">
          <div className="mx-auto mb-8 flex justify-center">
            <AurumLogo size="lg" />
          </div>
          <h1 className="text-4xl font-bold tracking-tight text-gray-900 sm:text-6xl">
            AURUM <span className="text-[#1B5E20]">SYSTEM</span>
          </h1>
          <p className="mt-4 text-lg font-semibold tracking-wide text-[#D4A017] sm:text-xl">
            Collect. Structure. Decide.
          </p>
          <p className="mx-auto mt-6 max-w-2xl text-base leading-relaxed text-gray-600">
            Transform field data into structured, reliable and actionable information. Create one
            collection that can support operations, reporting and future compliance modules.
          </p>

          <div className="mt-10 flex flex-col items-center justify-center gap-3 sm:flex-row">
            <Link
              to="/register"
              className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#1B5E20] px-7 py-3.5 text-sm font-semibold text-white shadow-lg shadow-[#1B5E20]/25 transition-all hover:bg-[#2E7D32] hover:shadow-xl sm:w-auto"
            >
              Get Started
              <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
            </Link>
            <Link
              to="/login"
              className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-gray-300 bg-white px-7 py-3.5 text-sm font-semibold text-gray-800 shadow-sm transition-colors hover:border-[#D4A017] hover:text-[#1B5E20] sm:w-auto"
            >
              <LogIn className="h-4 w-4" />
              Sign In
            </Link>
          </div>
        </section>

        {/* ── Cartes de fonctionnalités ── */}
        <section className="fade-in-soft-delayed mx-auto max-w-5xl px-6 pb-20">
          <div className="grid gap-5 sm:grid-cols-3">
            {FEATURES.map(({ icon: Icon, title, text }) => (
              <article
                key={title}
                className="rounded-2xl border border-gray-100 bg-white p-6 shadow-sm transition-shadow hover:shadow-md"
              >
                <div className="mb-4 flex h-11 w-11 items-center justify-center rounded-xl bg-[#1B5E20]/10">
                  <Icon className="h-5 w-5 text-[#1B5E20]" />
                </div>
                <h2 className="text-base font-semibold text-gray-900">{title}</h2>
                <p className="mt-2 text-sm leading-relaxed text-gray-600">{text}</p>
              </article>
            ))}
          </div>
        </section>
      </main>

      <PublicFooter />
    </div>
  );
}
