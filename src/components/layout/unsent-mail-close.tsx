"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Loader2, X } from "lucide-react";
import { dismissUnsentMail } from "@/app/actions/unsent-mail";

/** Křížek lišty neodeslaných: zruší uvedené e-maily natrvalo (už se neposílají, lišta se nevrátí). */
export function UnsentMailClose({ items }: { items: { source: "vykresy" | "posta"; id: string }[] }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <div className="flex shrink-0 flex-col items-end">
      <button
        type="button"
        disabled={busy}
        aria-label="Zavřít — tyto neodeslané e-maily zahodit"
        title="Zavřít natrvalo — tyto e-maily se už nebudou odesílat"
        onClick={async () => {
          setBusy(true);
          setError(null);
          const r = await dismissUnsentMail(items).catch(() => ({ ok: false, error: "Zavření selhalo." }));
          if (!r.ok) { setError(r.error ?? "Zavření selhalo."); setBusy(false); return; }
          router.refresh();
        }}
        className="flex h-8 w-8 items-center justify-center rounded-lg text-rose-800 hover:bg-rose-100 disabled:opacity-60 dark:text-rose-200 dark:hover:bg-rose-500/20"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <X className="h-4 w-4" />}
      </button>
      {error && <span className="text-xs">{error}</span>}
    </div>
  );
}
