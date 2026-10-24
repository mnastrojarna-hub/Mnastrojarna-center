import * as React from "react";
import { ShieldAlert, ShieldCheck, Undo2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHIP_BASE, CHIP_ICON, type QuoteApprovalFlag as QuoteApprovalFlagData } from "@/lib/jobs/flow-status";

/** Barvy štítku schválení (sdílí i chip „Neschválená“ na tabuli Nabídek). */
export const APPROVAL_TONE: Record<QuoteApprovalFlagData["kind"], string> = {
  pending: "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-400 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-400/50",
  returned: "bg-rose-50 text-rose-800 ring-1 ring-inset ring-rose-400 dark:bg-rose-500/10 dark:text-rose-200 dark:ring-rose-400/50",
  approved: "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-400 dark:bg-emerald-500/10 dark:text-emerald-200 dark:ring-emerald-400/50",
};

const ICON = { pending: ShieldAlert, returned: Undo2, approved: ShieldCheck } as const;

/**
 * Štítek schválení nabídky (#25): „Neschválená — čeká na schválení super admina“ (jantarová),
 * „Vráceno k přepracování: …“ (růžová), „Připravil(a) … · Schválil … · datum“ (zelená).
 * Ikona + text (barva nenese význam sama); pod `sm` krátký text („Neschválená“ / „Vráceno“),
 * celý text v `title`. `short` = vždy krátký (úzké buňky), `wrap` = vždy celý a zalomí se
 * (karta nabídky — na mobilu by krátký text jen opakoval stav nabídky), `iconOnly` = jen ikona
 * s textem pro čtečky (lepicí lišta na mobilu).
 */
export function QuoteApprovalFlag({
  flag, size = "sm", short, wrap, iconOnly, suffix, withNumber, className,
}: {
  flag: QuoteApprovalFlagData | null | undefined;
  size?: "sm" | "xs";
  /** Vždy jen krátký text (karty tabule). */
  short?: boolean;
  /** Vždy celý text, zalomený (i na mobilu). */
  wrap?: boolean;
  /** Jen ikona (text v `title` a pro čtečky). */
  iconOnly?: boolean;
  /** Doplněk za textem (vrácení: „— J. Semorád · 23. 10. 2026“). */
  suffix?: string | null;
  /** Za text i číslo nabídky („Neschválená · NAB-2026-031“) — štítek nahrazuje chip stavu nabídky. */
  withNumber?: boolean;
  className?: string;
}) {
  if (!flag) return null;
  const Icon = ICON[flag.kind];
  const num = withNumber && flag.number ? ` · ${flag.number}` : "";
  const full = `${suffix ? `${flag.label} ${suffix}` : flag.label}${num}`;
  const title = flag.kind === "approved" ? flag.label : `${flag.title}${suffix ? ` ${suffix}` : ""}`;
  const shortText = `${flag.kind === "approved" ? "Schválená" : flag.short}${num}`;
  const wrapped = !short && !iconOnly && (wrap || flag.kind === "approved");
  return (
    <span
      className={cn(
        CHIP_BASE, APPROVAL_TONE[flag.kind], "max-w-full", size === "xs" && "px-1.5 text-[11px]",
        wrapped && "items-start whitespace-normal rounded-2xl [&>svg]:mt-px",
        iconOnly && "px-1",
        className,
      )}
      title={title}
      data-approval={flag.kind}
    >
      <Icon className={CHIP_ICON} aria-hidden />
      {iconOnly ? (
        <span className="sr-only">{title}</span>
      ) : short ? (
        <span className="min-w-0 truncate">{shortText}</span>
      ) : wrapped ? (
        // razítko „Připravil(a) … · Schválil … · datum“ / celý štítek i na mobilu (zalomí se)
        <span className="min-w-0 whitespace-normal">{full}</span>
      ) : (
        <>
          <span className="min-w-0 truncate sm:hidden">{shortText}</span>
          <span className="hidden min-w-0 truncate sm:inline">{full}</span>
        </>
      )}
    </span>
  );
}
