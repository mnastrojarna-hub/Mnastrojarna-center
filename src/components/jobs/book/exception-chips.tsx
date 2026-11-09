"use client";

import { TriangleAlert } from "lucide-react";
import { useBookNav } from "@/components/jobs/book/book-nav";
import { EXCEPTION_FILTERS, type ExceptionFilterKey } from "@/lib/jobs/flow-exceptions";
import { LOST_REASONS, LOST_REASON_ORDER, type LostReason } from "@/lib/jobs/flow-status";
import { cn } from "@/lib/utils";

/**
 * Výjimky v toku v Knize (31. 10.): v Objednávkách „Bez objednávky · Reklamace · Pozastaveno" (+ Nová
 * revize výkresu, Opraveno, když nějaké jsou), v Nerealizovaných & zrušených chipy důvodů. Počty přes celou knihu.
 */
const ALWAYS: ExceptionFilterKey[] = ["bez_po", "reklamace", "pozastaveno"];

const chipCls = (active: boolean, alert = false) => cn(
  "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
  active ? "bg-foreground text-background" : alert ? "border border-rose-300 bg-rose-50 text-rose-800 hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200"
    : "border border-border bg-background text-foreground hover:bg-accent",
);

const ROW_CLS = "-mx-4 flex gap-2 overflow-x-auto px-4 [scrollbar-width:none] sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0";

/**
 * 9. 11.: chip „Prémioví" — jen zakázky prémiových zákazníků (URL premiovi=1). Počet = v aktuálním pohledu
 * (záložka + filtry); bez prémiových zakázek se chip neukáže (kromě zapnutého filtru).
 */
function PremiumChip({ count }: { count: number }) {
  const { params, navigate } = useBookNav();
  const active = params.premium === true;
  if (!active && count === 0) return null;
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid="premium-chip"
      title="Jen zakázky prémiových zákazníků (nastavuje se v kartě zákazníka)"
      className={cn(
        "inline-flex min-h-9 shrink-0 items-center gap-1.5 rounded-full px-3 text-xs font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "bg-red-600 text-white shadow-sm shadow-red-600/30"
          : "border border-red-400 bg-red-50 text-red-800 hover:bg-red-100 dark:border-red-500/50 dark:bg-red-500/10 dark:text-red-200 dark:hover:bg-red-500/20",
      )}
      onClick={() => navigate({ premium: !active })}
    >
      <TriangleAlert className="h-3.5 w-3.5" aria-hidden />
      Prémioví
      <span className="tabular-nums opacity-80">{count}</span>
    </button>
  );
}

export function ExceptionChips({ counts, premium = 0 }: { counts: Record<string, number>; premium?: number }) {
  const { params, navigate } = useBookNav();
  const premiumChip = <PremiumChip count={premium} />;
  const showPremium = premium > 0 || params.premium === true;
  if (params.segment === "nerealizovane") {
    const reasons = LOST_REASON_ORDER.filter((r) => (counts[`duvod.${r}`] ?? 0) > 0 || params.reason === r);
    if (!reasons.length) return showPremium ? <div role="group" aria-label="Zákazníci" className={ROW_CLS}>{premiumChip}</div> : null;
    return (
      <div role="group" aria-label="Důvod" className={ROW_CLS} data-testid="lost-reason-chips">
        {premiumChip}
        {reasons.map((r: LostReason) => {
          const active = params.reason === r;
          return (
            <button key={r} type="button" aria-pressed={active} className={chipCls(active)} onClick={() => navigate({ reason: active ? null : r })}>
              {LOST_REASONS[r].label}
              <span className="tabular-nums opacity-70">{counts[`duvod.${r}`] ?? 0}</span>
            </button>
          );
        })}
      </div>
    );
  }
  const shown = EXCEPTION_FILTERS.filter((x) => (params.segment === "objednavky" && ALWAYS.includes(x.key)) || (counts[x.key] ?? 0) > 0 || params.exception === x.key);
  if (!shown.length) return showPremium ? <div role="group" aria-label="Zákazníci" className={ROW_CLS}>{premiumChip}</div> : null;
  return (
    <div role="group" aria-label="Výjimky" className={ROW_CLS} data-testid="exception-chips">
      {premiumChip}
      {shown.map((x) => {
        const active = params.exception === x.key;
        const n = counts[x.key] ?? 0;
        const Icon = x.icon;
        // revize výkresu a opravy mohou být v kterékoli záložce → filtr přes celou knihu
        const segment = x.key === "vykres" || x.key === "opraveno" ? "vse" : params.segment;
        return (
          <button
            key={x.key}
            type="button"
            aria-pressed={active}
            className={chipCls(active, x.key === "vykres" && n > 0)}
            onClick={() => navigate(active ? { exception: null } : { exception: x.key, ...(segment !== params.segment ? { segment } : {}) })}
          >
            <Icon className="h-3.5 w-3.5" aria-hidden />
            {x.label}
            <span className="tabular-nums opacity-70">{n}</span>
            {x.key === "bez_po" && (counts.chybi_po ?? 0) > 0 && <span className="rounded-full bg-rose-600 px-1.5 text-[10px] text-white" title="Chybí objednávka zákazníka (déle než týden)">{counts.chybi_po} chybí</span>}
          </button>
        );
      })}
    </div>
  );
}
