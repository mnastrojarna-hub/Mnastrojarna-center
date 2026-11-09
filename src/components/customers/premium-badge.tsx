import { TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Prémiový zákazník (9. 11.) — majitel: „červený, výstražný ‚Pozor, prémiový zákazník‘, aby to bylo hned vidět".
 * Jeden vzhled pro Knihu zakázek (řádek, tabule), kartu zakázky, stránky toku, přehled, hledání i kartu zákazníka.
 * Plný červený štítek s výstražnou ikonou — výraznější než chipy priority, ve světlém i tmavém režimu stejný.
 * Bez stavu (server i klient).
 */

export const PREMIUM_LABEL = "Pozor, prémiový zákazník";
/** Pracovní seznamy toku (Poptávky, Nabídky, Objednávky…): přednostní věc, řeší se hned. */
export const PREMIUM_FLOW_LABEL = "Prémiový zákazník — přednostně";
export const PREMIUM_TITLE = "Pozor, prémiový zákazník — zakázka má přednost, řeš ji pečlivě a včas.";

/** Zvýraznění celého řádku / karty zakázky prémiového zákazníka (červený okraj a jemný podklad). */
export const PREMIUM_ROW = cn(
  "border-red-500/70 bg-red-50/70 ring-1 ring-red-500/30 hover:border-red-500",
  "dark:border-red-500/60 dark:bg-red-950/30 dark:ring-red-500/25",
);

/** Pruh vpravo u řádku (levý pruh drží barvu stavu). */
export const PREMIUM_STRIPE = "absolute inset-y-0 right-0 w-1 bg-red-600 dark:bg-red-500";

export function PremiumBadge({
  label = "responsive",
  size = "sm",
  className,
}: {
  /**
   * full = „Pozor, prémiový zákazník"; short = „Prémiový zákazník"; compact = „Prémiový";
   * responsive = na mobilu „Prémiový", od sm celý text; book = jako responsive, v úzkém sloupci širokého
   * desktopu (xl) „Prémiový zákazník"; flow = seznamy toku: na mobilu „Prémiový", od sm „Prémiový zákazník —
   * přednostně"; icon = jen ikona (text v title a pro čtečky).
   */
  label?: "full" | "short" | "compact" | "responsive" | "book" | "flow" | "icon";
  size?: "xs" | "sm";
  className?: string;
}) {
  return (
    <span
      role="note"
      title={PREMIUM_TITLE}
      aria-label={PREMIUM_LABEL}
      data-testid="premium-badge"
      className={cn(
        "inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full bg-red-600 font-semibold text-white shadow-sm shadow-red-600/30",
        "ring-1 ring-red-700/40 dark:bg-red-600 dark:ring-red-400/40",
        size === "xs" ? "px-1.5 py-px text-[10.5px] leading-4" : "px-2 py-0.5 text-[11px]",
        label === "icon" && "px-1",
        className,
      )}
    >
      <TriangleAlert className={cn("shrink-0", size === "xs" ? "h-3 w-3" : "h-3.5 w-3.5")} aria-hidden />
      {label === "full" && PREMIUM_LABEL}
      {label === "short" && "Prémiový zákazník"}
      {label === "compact" && "Prémiový"}
      {label === "responsive" && (
        <>
          <span className="sm:hidden">Prémiový</span>
          <span className="hidden sm:inline">{PREMIUM_LABEL}</span>
        </>
      )}
      {label === "flow" && (
        <>
          <span className="sm:hidden">Prémiový</span>
          <span className="hidden sm:inline">{PREMIUM_FLOW_LABEL}</span>
        </>
      )}
      {label === "book" && (
        <>
          <span className="sm:hidden">Prémiový</span>
          <span className="hidden sm:inline xl:hidden">{PREMIUM_LABEL}</span>
          <span className="hidden xl:inline">Prémiový zákazník</span>
        </>
      )}
    </span>
  );
}

/** Výrazný pruh v kartě zakázky: „Pozor — prémiový zákazník". */
export function PremiumBanner({ customerName, className }: { customerName?: string | null; className?: string }) {
  return (
    <div
      role="note"
      data-testid="premium-banner"
      className={cn(
        "flex items-start gap-3 rounded-lg border border-red-600 bg-red-600 px-3 py-2.5 text-white shadow-sm shadow-red-600/25",
        "dark:border-red-500 dark:bg-red-600/90",
        className,
      )}
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-white/15">
        <TriangleAlert className="h-5 w-5" aria-hidden />
      </span>
      <div className="min-w-0">
        <p className="text-sm font-bold uppercase tracking-wide">Pozor — prémiový zákazník</p>
        <p className="text-xs text-white/90">
          {customerName ? <>Zakázka pro <strong className="font-semibold">{customerName}</strong> má přednost</> : "Zakázka má přednost"}
          {" "}— řeš ji pečlivě a včas. Nastavuje se v kartě zákazníka.
        </p>
      </div>
    </div>
  );
}
