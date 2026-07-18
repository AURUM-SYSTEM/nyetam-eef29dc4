// Footer des écrans publics (welcome / login / register) uniquement.
// Palette scopée à ces écrans : vert profond #1B5E20, or #D4A017, neutres clairs.
import { CloudOff, Compass, ShieldCheck } from "lucide-react";

export const PUBLIC_APP_VERSION = "v1.0.0";

export function PublicFooter() {
  return (
    <footer className="border-t border-gray-200 bg-white/60 py-5">
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-center gap-x-6 gap-y-2 px-6 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <ShieldCheck className="h-3.5 w-3.5 text-[#1B5E20]" /> Secure by design
        </span>
        <span className="flex items-center gap-1.5">
          <CloudOff className="h-3.5 w-3.5 text-[#1B5E20]" /> Offline-first architecture
        </span>
        <span className="flex items-center gap-1.5">
          <Compass className="h-3.5 w-3.5 text-[#1B5E20]" /> Built for field operations
        </span>
        <span className="text-gray-400">AURUM SYSTEM · {PUBLIC_APP_VERSION}</span>
      </div>
    </footer>
  );
}

export function AurumLogo({ size = "md" }: { size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-14 w-14 rounded-2xl text-2xl" : "h-10 w-10 rounded-xl text-lg";
  return (
    <div
      className={`${box} flex items-center justify-center bg-gradient-to-br from-[#1B5E20] to-[#2E7D32] font-bold text-[#D4A017] shadow-md shadow-[#1B5E20]/20`}
      aria-hidden
    >
      A
    </div>
  );
}
