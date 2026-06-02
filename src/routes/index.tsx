import { createFileRoute, Link } from "@tanstack/react-router";
import { Mic, FileText, Shield, Globe, ArrowRight } from "lucide-react";
import { PilotSection } from "@/components/PilotSection";

export const Route = createFileRoute("/")({
  component: LandingPage,
  head: () => ({
    meta: [
      { title: "AURUM SYSTEM — Programme pilote" },
      { name: "description", content: "Rejoignez le programme pilote AURUM SYSTEM. Transformez vos notes terrain en rapports structurés automatiquement." },
      { property: "og:title", content: "AURUM SYSTEM — Programme pilote" },
      { property: "og:description", content: "Rejoignez le programme pilote AURUM SYSTEM. Transformez vos notes terrain en rapports structurés automatiquement." },
    ],
  }),
});

function FeatureCard({
  icon: Icon,
  title,
  description,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
}) {
  return (
    <div className="glass-card rounded-xl p-5">
      <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent">
        <Icon className="h-5 w-5 text-gold" />
      </div>
      <h3 className="mt-3 text-sm font-semibold">{title}</h3>
      <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{description}</p>
    </div>
  );
}

function LandingPage() {
  return (
    <div className="px-5 pt-8 pb-32">
      {/* Hero */}
      <header className="mb-8 text-center">
        <div className="mx-auto flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-gold to-gold-soft shadow-[var(--shadow-gold)]">
          <span className="font-display text-3xl text-background">A</span>
        </div>
        <h1 className="mt-5 font-display text-4xl gold-text">AURUM SYSTEM</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Transformez vos notes terrain en rapports intelligents.
        </p>
      </header>

      {/* Pilot programme */}
      <PilotSection />

      {/* Features */}
      <section className="mt-8 grid grid-cols-2 gap-3">
        <FeatureCard
          icon={Mic}
          title="Dictée vocale"
          description="Parlez, l'IA structure automatiquement."
        />
        <FeatureCard
          icon={FileText}
          title="Rapports auto"
          description="Génération de documents professionnels."
        />
        <FeatureCard
          icon={Shield}
          title="Hors ligne"
          description="Fonctionne sans réseau, sync. automatique."
        />
        <FeatureCard
          icon={Globe}
          title="Multi-langues"
          description="Français et anglais natifs."
        />
      </section>

      {/* App access */}
      <div className="mt-8 space-y-3">
        <Link
          to="/login"
          className="flex w-full items-center justify-center gap-2 rounded-2xl btn-gold px-5 py-4 text-sm font-semibold"
        >
          <ArrowRight className="h-4 w-4" />
          Accéder à l'application
        </Link>
        <Link
          to="/about"
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-border bg-card px-5 py-3 text-sm font-medium hover:border-gold/40"
        >
          À propos de AURUM SYSTEM
        </Link>
      </div>

      <p className="mt-10 text-center text-[11px] uppercase tracking-[0.25em] text-muted-foreground">
        © {new Date().getFullYear()} AURUM SYSTEM
      </p>
    </div>
  );
}
