"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { Eye, Lock, Loader2 } from "lucide-react";
import { setSupplierInvoiceVisibility } from "@/app/actions/supplier-invoices";
import type { SupplierInvoiceVisibility } from "@/lib/supplier-invoices/access";
import { cn } from "@/lib/utils";

/**
 * Jediný přepínač viditelnosti faktur dodavatelů (jen super admin): „jen super admin" (výchozí) nebo
 * „všichni vidí faktury" — zaplaceno / nezaplaceno vidí vždy jen super admin, částky jen kdo vidí nákupní ceny.
 */
export function VisibilitySwitch({ value }: { value: SupplierInvoiceVisibility }) {
  const router = useRouter();
  const [mode, setMode] = React.useState(value);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  React.useEffect(() => setMode(value), [value]);
  const pick = async (next: SupplierInvoiceVisibility) => {
    if (next === mode || busy) return;
    setBusy(true);
    setError(null);
    const res = await setSupplierInvoiceVisibility(next);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    setMode(next);
    router.refresh();
  };
  const opts: { key: SupplierInvoiceVisibility; title: string; desc: string; icon: typeof Lock }[] = [
    { key: "super_admin", title: "Jen super admin", desc: "Ostatní fakturu jen nahrají („Děkujeme, nahráno“).", icon: Lock },
    { key: "all", title: "Všichni vidí faktury", desc: "Zaplaceno / nezaplaceno jen super admin, částky jen kdo vidí nákupní ceny.", icon: Eye },
  ];
  return (
    <section className="rounded-2xl border bg-card p-3 shadow-sm" aria-label="Kdo vidí faktury dodavatelů" data-testid="invoice-visibility">
      <p className="mb-2 flex items-center gap-2 text-sm font-semibold">Kdo vidí faktury dodavatelů {busy && <Loader2 className="h-4 w-4 animate-spin" />}</p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {opts.map((o) => {
          const Icon = o.icon;
          const on = mode === o.key;
          return (
            <button
              key={o.key}
              type="button"
              aria-pressed={on}
              disabled={busy}
              onClick={() => void pick(o.key)}
              className={cn("flex items-start gap-2 rounded-xl border p-2.5 text-left transition", on ? "border-emerald-600 bg-emerald-50 ring-2 ring-emerald-500/30 dark:bg-emerald-500/10" : "hover:bg-accent")}
            >
              <Icon className={cn("mt-0.5 h-4 w-4 shrink-0", on ? "text-emerald-600" : "text-muted-foreground")} />
              <span>
                <span className="block text-sm font-medium">{o.title}</span>
                <span className="block text-xs text-muted-foreground">{o.desc}</span>
              </span>
            </button>
          );
        })}
      </div>
      {error && <p className="mt-2 text-xs text-red-600">{error}</p>}
    </section>
  );
}
