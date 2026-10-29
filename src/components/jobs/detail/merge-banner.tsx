"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Combine, History, X } from "lucide-react";
import type { MergeConflict } from "@/lib/jobs/job-merge-types";

/**
 * Banner na cílové zakázce po sloučení (#24): „Zakázka Z-… byla sloučena do této zakázky" —
 * hned po sloučení i po otevření starého odkazu na zdroj (přesměrování). Upozornění k výsledku
 * (např. nabídka čeká na schválení, nabídka jen jako PDF) jsou tu vidět i po zavření dialogu.
 */
export function MergeBanner({ sourceNumber, sourceId, byName, at, summary, redirected, warnings = [] }: {
  sourceNumber: string;
  sourceId?: string | null;
  byName: string | null;
  at: string;
  summary: string;
  redirected: boolean;
  warnings?: MergeConflict[];
}) {
  const [open, setOpen] = React.useState(true);
  if (!open) return null;
  const when = formatWhen(at);
  return (
    <div
      role="status"
      data-testid="merge-banner"
      className="mb-3 flex items-start gap-3 rounded-xl border border-indigo-200 bg-indigo-50 px-4 py-3 text-sm text-indigo-950 shadow-sm dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100"
    >
      <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-indigo-100 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
        <Combine className="h-4 w-4" />
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {redirected
            ? <>Zakázka <Num>{sourceNumber}</Num> byla sloučena sem — otevřela se zakázka, která zůstala.</>
            : <>Zakázka <Num>{sourceNumber}</Num> je sloučená do této zakázky.</>}
        </p>
        <p className="mt-0.5 text-xs text-indigo-900/80 dark:text-indigo-200/80">
          Převzato: {summary}.{byName ? ` Sloučil(a) ${byName}` : ""}{when ? `${byName ? "," : " Sloučeno"} ${when}` : ""}.
          {sourceId && (
            <>
              {" "}
              <Link href={`/orders/${sourceId}?historie=1`} className="inline-flex items-center gap-0.5 font-medium underline underline-offset-2 hover:no-underline">
                <History className="h-3 w-3" aria-hidden /> Zobrazit původní zakázku
              </Link>
            </>
          )}
        </p>
        {warnings.length > 0 && (
          <ul className="mt-2 space-y-1" data-testid="merge-banner-warnings">
            {warnings.map((w, i) => (
              <li key={`${w.code}-${i}`} className="flex items-start gap-1.5 rounded-md border border-amber-300/70 bg-amber-50 px-2 py-1 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
                <span>{w.message}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        type="button"
        onClick={() => setOpen(false)}
        aria-label="Zavřít oznámení"
        className="-mr-1 -mt-1 flex h-8 w-8 shrink-0 items-center justify-center rounded-full opacity-70 transition hover:bg-indigo-100 hover:opacity-100 dark:hover:bg-indigo-500/20"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

/**
 * Původní (sloučená) zakázka otevřená jen kvůli historii (?historie=1): jen pro čtení — změny
 * odmítne DB (MERGED) a pozdní zápisy (doklady, komentáře) skončí u cíle.
 */
export function MergedSourceBanner({ number, targetId, targetNumber, byName, at }: {
  number: string;
  targetId: string;
  targetNumber: string;
  byName: string | null;
  at: string | null;
}) {
  const when = at ? formatWhen(at) : "";
  return (
    <div
      role="status"
      data-testid="merged-source-banner"
      className="mb-3 flex flex-col gap-2 rounded-xl border border-slate-300 bg-slate-50 px-4 py-3 text-sm text-slate-900 shadow-sm sm:flex-row sm:items-center dark:border-slate-600 dark:bg-slate-800/60 dark:text-slate-100"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-200">
          <History className="h-4 w-4" />
        </span>
        <div className="min-w-0">
          <p className="font-medium">
            Původní zakázka <Num>{number}</Num> — sloučená do <Num>{targetNumber}</Num>. Jen pro čtení.
          </p>
          <p className="mt-0.5 text-xs text-slate-600 dark:text-slate-300">
            {byName ? `Sloučil(a) ${byName}` : "Sloučeno"}{when ? `, ${when}` : ""}. Doklady, nabídky a historie jsou teď v <Num>{targetNumber}</Num>; změny dělej tam.
          </p>
        </div>
      </div>
      <Link
        href={`/orders/${targetId}`}
        className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-lg border border-slate-300 bg-background px-3 text-sm font-medium transition hover:bg-accent dark:border-slate-600"
      >
        Otevřít <Num>{targetNumber}</Num> <ArrowRight className="h-4 w-4" aria-hidden />
      </Link>
    </div>
  );
}

function Num({ children }: { children: React.ReactNode }) {
  return <span className="whitespace-nowrap font-mono">{children}</span>;
}

function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return new Intl.DateTimeFormat("cs-CZ", { timeZone: "Europe/Prague", day: "numeric", month: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(d);
}
