"use client";

import * as React from "react";
import { BookOpen, Lock, X } from "lucide-react";

/**
 * Upozornění po přesměrování ze stránky bez oprávnění (/orders?pristup=<funkce>).
 * Zavření ho schová a odstraní parametr z adresy (bez nového načtení). `hint` = vysvětlení,
 * proč a co dělat místo toho (FEATURE_HINTS, např. Nacenění jen super admin).
 */
export function AccessBanner({ label, hint }: { label: string; hint?: string | null }) {
  const [open, setOpen] = React.useState(true);
  if (!open) return null;

  function dismiss() {
    setOpen(false);
    try {
      const url = new URL(window.location.href);
      url.searchParams.delete("pristup");
      window.history.replaceState(window.history.state, "", url.pathname + (url.search ? url.search : "") + url.hash);
    } catch {
      // jen kosmetika adresy
    }
  }

  return (
    <div
      role="status"
      className="flex items-start gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-amber-500 text-white">
        <Lock className="h-4 w-4" />
      </span>
      <p className="flex-1 self-center">
        {hint ? hint : <>Na stránku <strong>„{label}“</strong> nemáš oprávnění — požádej super admina.</>}
      </p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Zavřít upozornění"
        className="rounded-md p-1 text-amber-700 hover:bg-amber-100 dark:text-amber-300 dark:hover:bg-amber-500/20"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}

const BOOK_HINT_KEY = "kniha-hint-skryt";
export const BOOK_HINT_TEXT =
  "Kniha zakázek = všechny zakázky, které opravdu běží — vidí je každý. Svoje poptávky, nabídky a doklady z pošty máš v Obchodním toku.";

/**
 * Nápověda Knihy zakázek (#25, pravidlo 7): Kniha vs. Obchodní tok. Jde zavřít — volba se pamatuje
 * v prohlížeči (localStorage; bez něj se jen schová do dalšího načtení).
 */
export function BookHint() {
  // null = ještě nevíme (server / první vykreslení) → nic, ať zavřená nápověda při načtení neproblikne
  const [hidden, setHidden] = React.useState<boolean | null>(null);
  React.useEffect(() => {
    let skip = false;
    try {
      skip = window.localStorage.getItem(BOOK_HINT_KEY) === "1";
    } catch {
      // bez úložiště se nápověda ukáže vždy
    }
    setHidden(skip);
  }, []);
  if (hidden !== false) return null;

  function dismiss() {
    setHidden(true);
    try {
      window.localStorage.setItem(BOOK_HINT_KEY, "1");
    } catch {
      // jen do dalšího načtení
    }
  }

  return (
    <div data-book-hint className="flex items-start gap-2.5 rounded-xl border border-sky-200/70 bg-sky-50/70 px-3 py-2.5 text-sm text-sky-950 dark:border-sky-500/20 dark:bg-sky-500/10 dark:text-sky-100">
      <BookOpen className="mt-0.5 h-4 w-4 shrink-0 text-sky-600 dark:text-sky-400" aria-hidden />
      <p className="min-w-0 flex-1 leading-relaxed">{BOOK_HINT_TEXT}</p>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Skrýt nápovědu"
        className="-m-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-sky-700 hover:bg-sky-100 dark:text-sky-300 dark:hover:bg-sky-500/20"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
