"use client";

import * as React from "react";
import { Lock, X } from "lucide-react";

/**
 * Upozornění po přesměrování ze stránky bez oprávnění (/orders?pristup=<funkce>).
 * Zavření ho schová a odstraní parametr z adresy (bez nového načtení).
 */
export function AccessBanner({ label }: { label: string }) {
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
        Na stránku <strong>„{label}“</strong> nemáš oprávnění — požádej super admina.
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
