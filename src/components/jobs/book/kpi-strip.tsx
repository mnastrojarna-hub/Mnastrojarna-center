"use client";

import {
  AlarmClock, AlertTriangle, Banknote, CalendarClock, MessageSquareQuote, ReceiptText, ShoppingCart, type LucideIcon,
} from "lucide-react";
import { BookLink, useBookNav } from "@/components/jobs/book/book-nav";
import { KPI_PATCHES, isPatchActive, type BookKpis, type BookPatch } from "@/components/jobs/book/book-params";
import { cn, formatCZK } from "@/lib/utils";

/**
 * Barevné dlaždice nad knihou — kliknutí rovnou nastaví filtr.
 * Hodnota objednávek v běhu jen pro role s právem na marže; faktury po
 * splatnosti, když je stránka spočítá.
 */

interface Tile {
  key: string;
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
  patch: BookPatch;
  /** Pozadí dlaždice, kroužek ikony, číslo. */
  tone: { tile: string; icon: string; num: string; active: string };
  muted?: boolean;
}

const TONES = {
  orange: {
    tile: "bg-orange-50/70 hover:bg-orange-50 dark:bg-orange-500/[0.07] dark:hover:bg-orange-500/10",
    icon: "bg-orange-500 text-white", num: "text-orange-700 dark:text-orange-300", active: "ring-orange-500/60",
  },
  red: {
    tile: "bg-red-50/70 hover:bg-red-50 dark:bg-red-500/[0.07] dark:hover:bg-red-500/10",
    icon: "bg-red-600 text-white", num: "text-red-700 dark:text-red-300", active: "ring-red-500/60",
  },
  amber: {
    tile: "bg-amber-50/70 hover:bg-amber-50 dark:bg-amber-500/[0.07] dark:hover:bg-amber-500/10",
    icon: "bg-amber-500 text-white", num: "text-amber-700 dark:text-amber-300", active: "ring-amber-500/60",
  },
  sky: {
    tile: "bg-sky-50/70 hover:bg-sky-50 dark:bg-sky-500/[0.07] dark:hover:bg-sky-500/10",
    icon: "bg-sky-500 text-white", num: "text-sky-700 dark:text-sky-300", active: "ring-sky-500/60",
  },
  pink: {
    tile: "bg-pink-50/70 hover:bg-pink-50 dark:bg-pink-500/[0.07] dark:hover:bg-pink-500/10",
    icon: "bg-pink-600 text-white", num: "text-pink-700 dark:text-pink-300", active: "ring-pink-500/60",
  },
  emerald: {
    tile: "bg-emerald-50/70 hover:bg-emerald-50 dark:bg-emerald-500/[0.07] dark:hover:bg-emerald-500/10",
    icon: "bg-emerald-600 text-white", num: "text-emerald-700 dark:text-emerald-300", active: "ring-emerald-500/60",
  },
  calm: {
    tile: "bg-green-50/70 hover:bg-green-50 dark:bg-green-500/[0.07] dark:hover:bg-green-500/10",
    icon: "bg-green-600 text-white", num: "text-green-700 dark:text-green-300", active: "ring-green-500/60",
  },
} as const;

export function KpiStrip({
  kpis, runningValue, overdueInvoices = null,
}: {
  kpis: BookKpis;
  runningValue: number | null;
  /** Počet nezaplacených faktur po splatnosti (null = nezobrazovat). */
  overdueInvoices?: number | null;
}) {
  const { params } = useBookNav();

  const tiles: Tile[] = [
    {
      key: "orders", label: "Objednávky v běhu", value: String(kpis.ordersRunning),
      hint: kpis.ordersRunning ? "objednávka → dodací list" : "zatím žádná",
      icon: ShoppingCart, patch: KPI_PATCHES.ordersRunning, tone: TONES.orange,
    },
    {
      key: "overdue", label: "Po termínu", value: String(kpis.overdue),
      hint: kpis.overdue ? "hoří — řeš hned" : "vše v termínu",
      icon: AlarmClock, patch: KPI_PATCHES.overdue, tone: kpis.overdue ? TONES.red : TONES.calm,
    },
    {
      key: "soon", label: "Termín do 7 dní", value: String(kpis.dueSoon),
      hint: kpis.dueSoon ? "připrav dodání" : "tento týden klid",
      icon: CalendarClock, patch: KPI_PATCHES.dueSoon, tone: TONES.amber,
    },
    {
      key: "inquiries", label: "Poptávky & nabídky", value: String(kpis.inquiries),
      hint: kpis.inquiries ? "před objednávkou" : "žádné otevřené",
      icon: MessageSquareQuote, patch: KPI_PATCHES.inquiries, tone: TONES.sky,
    },
    {
      key: "problems", label: "Reklamace & pauza", value: String(kpis.problems),
      hint: kpis.problems ? "chce pozornost" : "nic nestojí",
      icon: AlertTriangle, patch: KPI_PATCHES.problems, tone: TONES.pink,
    },
  ];
  if (overdueInvoices !== null) {
    tiles.push({
      key: "overdueInvoices", label: "Po splatnosti", value: String(overdueInvoices),
      hint: overdueInvoices ? "faktury čekají na peníze" : "vše zaplaceno včas",
      icon: ReceiptText, patch: KPI_PATCHES.overdueInvoices, tone: overdueInvoices ? TONES.red : TONES.calm,
    });
  }
  if (runningValue !== null) {
    tiles.push({
      key: "value", label: "Hodnota v běhu", value: formatCZK(runningValue),
      hint: "objednávky bez DL, bez DPH", icon: Banknote, patch: KPI_PATCHES.value, tone: TONES.emerald,
    });
  }

  return (
    <div
      className={cn(
        "-mx-4 flex snap-x gap-2 overflow-x-auto px-4 pb-1 scrollbar-thin sm:mx-0 sm:grid sm:grid-cols-3 sm:overflow-visible sm:px-0 sm:pb-0",
        tiles.length > 6 ? "sm:grid-cols-4 min-[1700px]:grid-cols-7" : tiles.length > 5 ? "min-[1400px]:grid-cols-6" : "xl:grid-cols-5",
      )}
    >
      {tiles.map((t) => {
        const active = isPatchActive(params, t.patch);
        const Icon = t.icon;
        return (
          <BookLink
            key={t.key}
            patch={t.patch}
            aria-current={active ? "true" : undefined}
            className={cn(
              "group flex min-w-[10.5rem] shrink-0 snap-start items-start gap-3 rounded-xl border p-3 transition sm:min-w-0",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
              t.tone.tile,
              active && cn("ring-2", t.tone.active),
            )}
          >
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm transition-transform group-hover:scale-105", t.tone.icon)}>
              <Icon className="h-[18px] w-[18px]" />
            </span>
            <span className="min-w-0">
              <span className={cn("block truncate text-xl font-bold leading-tight tabular-nums", t.tone.num)}>{t.value}</span>
              <span className="block truncate text-xs font-medium text-foreground/80">{t.label}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{t.hint}</span>
            </span>
          </BookLink>
        );
      })}
    </div>
  );
}
