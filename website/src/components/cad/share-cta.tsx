"use client";

import { tr } from "@/cad/i18n";
import { cn } from "@/lib/cn";
import { CadIcon } from "./cad-icons";

/**
 * Výrazné tlačítko „Sdílet odkazem“ (titulní lišta CADu a výkres): korporátní červená, pulzující záře, přejíždějící lesk
 * a občasné zavrtění ikony. Animace se vypnou při „omezit pohyb“ v systému (prefers-reduced-motion) a u vypnutého tlačítka.
 */
export function ShareCta({ onClick, disabled, title, compact }: { onClick: () => void; disabled?: boolean; title: string; compact?: boolean }) {
  return (
    <button
      type="button"
      data-share-cta
      onClick={onClick}
      disabled={disabled}
      title={title}
      aria-label={tr("Sdílet odkazem")}
      className={cn(
        "share-cta relative isolate inline-flex shrink-0 items-center gap-1.5 overflow-hidden rounded-full bg-gradient-to-r from-[#E03930] via-[#f0503f] to-[#E03930] font-bold uppercase tracking-wide text-white shadow-[0_6px_18px_-6px_rgba(224,57,48,.9)] ring-1 ring-white/30 transition hover:scale-[1.06] hover:brightness-110 active:scale-95 disabled:pointer-events-none disabled:animate-none disabled:opacity-40",
        compact ? "h-7 px-2.5 text-[11px]" : "h-8 px-3.5 text-[12px]",
      )}
    >
      <span aria-hidden className="share-cta-shine pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 bg-gradient-to-r from-transparent via-white/60 to-transparent" />
      <CadIcon name="share" className="share-cta-icon relative h-4 w-4" />
      <span className={cn("relative", compact && "hidden sm:inline")}>{tr("Sdílet odkazem")}</span>
    </button>
  );
}
