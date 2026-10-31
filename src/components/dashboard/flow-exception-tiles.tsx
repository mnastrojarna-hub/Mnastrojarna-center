import Link from "next/link";
import { EXCEPTION_TILE_ICONS } from "@/lib/jobs/flow-exceptions";
import { AWAITING_PO_REMIND_DAYS } from "@/lib/jobs/flow-status";
import { cn } from "@/lib/utils";

/**
 * Přehled výjimek v toku (AI přehled): chybí objednávka zákazníka (déle než týden), vyrábí se bez objednávky,
 * reklamace, pozastaveno, nová revize výkresu, opraveno. Každá dlaždice = filtr v Knize (?vyjimka=…).
 */
export function FlowExceptionTiles({ counts }: { counts: Record<string, number> }) {
  const tiles = [
    { key: "chybi_po", label: "Chybí objednávka zákazníka", hint: `vyrábí se déle než ${AWAITING_PO_REMIND_DAYS} dní bez ní`, href: "/orders?segment=vse&vyjimka=bez_po", alert: true },
    { key: "vykres", label: "Nová revize výkresu", hint: "čeká na „Beru na vědomí“", href: "/orders?segment=vse&vyjimka=vykres", alert: true },
    { key: "reklamace", label: "Reklamace", hint: "řeš přednostně", href: "/orders?vyjimka=reklamace", alert: true },
    { key: "bez_po", label: "Bez objednávky", hint: "objednávka dorazí později", href: "/orders?vyjimka=bez_po", alert: false },
    { key: "pozastaveno", label: "Pozastaveno", hint: "čeká na zákazníka / materiál", href: "/orders?vyjimka=pozastaveno", alert: false },
    { key: "opraveno", label: "Opraveno", hint: "oprava zakázky od zákazníka", href: "/orders?segment=vse&vyjimka=opraveno", alert: false },
  ] as const;
  const shown = tiles.filter((t) => (counts[t.key] ?? 0) > 0);
  if (!shown.length) return null;
  return (
    <section aria-label="Výjimky v toku" className="rounded-2xl border bg-card p-4 shadow-sm" data-testid="flow-exception-tiles">
      <h2 className="mb-3 text-base font-semibold">Výjimky v toku</h2>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        {shown.map((t) => {
          const Icon = EXCEPTION_TILE_ICONS[t.key];
          return (
            <Link key={t.key} href={t.href} className={cn(
              "flex flex-col gap-1 rounded-xl border p-3 transition hover:shadow-md",
              t.alert ? "border-rose-200 bg-rose-50/70 dark:border-rose-500/20 dark:bg-rose-500/10" : "bg-background",
            )}>
              <span className="flex items-center gap-1.5 text-xs font-medium">
                <Icon className={cn("h-4 w-4", t.alert ? "text-rose-600 dark:text-rose-300" : "text-muted-foreground")} aria-hidden /> {t.label}
              </span>
              <span className={cn("text-2xl font-bold leading-none", t.alert && "text-rose-700 dark:text-rose-300")}>{counts[t.key]}</span>
              <span className="text-[11px] text-muted-foreground">{t.hint}</span>
            </Link>
          );
        })}
      </div>
    </section>
  );
}
