import { Lightbulb } from "lucide-react";

export function SuggestionsPanel({ suggestions, lang }: { suggestions: string[] | null | undefined; lang?: string }) {
  if (!suggestions || suggestions.length === 0) return null;
  const title = lang === "en" ? "Improvement suggestions" : "Suggestions d'amélioration";
  const sub = lang === "en"
    ? "These tips do not modify the report — they highlight what could strengthen it."
    : "Ces conseils ne modifient pas le rapport — ils indiquent ce qui pourrait le renforcer.";
  return (
    <section className="mt-6 rounded-2xl border border-gold/30 bg-gold/5 p-4">
      <header className="mb-3 flex items-center gap-2">
        <Lightbulb className="h-4 w-4 text-gold" />
        <h2 className="font-display text-sm uppercase tracking-wider text-gold">{title}</h2>
      </header>
      <p className="mb-3 text-xs text-muted-foreground">{sub}</p>
      <ul className="space-y-2">
        {suggestions.map((s, i) => (
          <li key={i} className="flex gap-2 text-sm leading-relaxed text-foreground/90">
            <span className="mt-1 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-gold" />
            <span>{s}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
