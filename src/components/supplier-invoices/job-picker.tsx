"use client";

import * as React from "react";
import { Loader2, Search, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { searchJobsForSupplierInvoice } from "@/app/actions/supplier-invoices";
import type { JobRefView } from "@/lib/supplier-invoices/types";
import { cn } from "@/lib/utils";

type Hit = JobRefView & { hint: string | null };

/**
 * Výběr zakázky pro řádek rozdělení: hledání podle čísla, názvu, zákazníka, č. objednávky zákazníka
 * i čísla výkresu (server). Rychlé volby = zakázky objednávek dodavatele.
 */
export function JobPicker({
  value, onChange, quick = [], id, autoFocus,
}: {
  value: JobRefView | null;
  onChange: (job: JobRefView | null) => void;
  quick?: JobRefView[];
  id?: string;
  autoFocus?: boolean;
}) {
  const [open, setOpen] = React.useState(false);
  const [q, setQ] = React.useState("");
  const [hits, setHits] = React.useState<Hit[]>([]);
  const [busy, setBusy] = React.useState(false);
  const box = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    let cancel = false;
    const t = window.setTimeout(async () => {
      setBusy(true);
      const res = await searchJobsForSupplierInvoice(q);
      if (!cancel) {
        setBusy(false);
        setHits(res.ok ? res.jobs : []);
      }
    }, q ? 250 : 0);
    return () => { cancel = true; window.clearTimeout(t); };
  }, [q, open]);

  React.useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (box.current && !box.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  if (value && !open) {
    return (
      <button
        type="button"
        id={id}
        onClick={() => { setOpen(true); setQ(""); }}
        className="flex h-10 w-full min-w-0 items-center gap-2 rounded-md border bg-background px-2.5 text-left text-sm hover:bg-accent"
        data-testid="job-picker-value"
      >
        <span className="min-w-0 max-w-full truncate font-mono font-semibold">{value.number}</span>
        <span className="min-w-0 flex-1 truncate text-muted-foreground">{[value.customerName, value.title].filter(Boolean).join(" · ")}</span>
      </button>
    );
  }

  const quickShown = quick.filter((j) => !hits.some((h) => h.id === j.id)).slice(0, 4);
  return (
    <div ref={box} className="relative min-w-0">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        id={id}
        autoFocus={autoFocus ?? open}
        value={q}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQ(e.target.value); setOpen(true); }}
        placeholder="Zakázka: číslo, zákazník, výkres…"
        className="h-10 pl-8 pr-8 text-base sm:text-sm"
        aria-label="Vybrat zakázku"
        data-testid="job-picker-input"
      />
      {busy ? <Loader2 className="absolute right-2.5 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
        : value ? (
          <button type="button" aria-label="Zrušit" onClick={() => setOpen(false)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:bg-accent"><X className="h-4 w-4" /></button>
        ) : null}
      {open && (
        <ul className="absolute z-30 mt-1 max-h-72 w-full min-w-[16rem] overflow-auto rounded-xl border bg-popover p-1 shadow-lg" role="listbox">
          {[...quickShown.map((j) => ({ ...j, hint: "objednávka u dodavatele" })), ...hits].map((j) => (
            <li key={j.id}>
              <button
                type="button"
                role="option"
                aria-selected={value?.id === j.id}
                onClick={() => { onChange({ id: j.id, number: j.number, title: j.title, customerName: j.customerName }); setOpen(false); setQ(""); }}
                className={cn("flex w-full flex-col items-start rounded-lg px-2.5 py-2 text-left text-sm hover:bg-accent", value?.id === j.id && "bg-accent")}
                data-testid="job-picker-option"
              >
                <span><span className="font-mono font-semibold">{j.number}</span> <span className="text-muted-foreground">{j.customerName ?? ""}</span></span>
                <span className="w-full truncate text-xs text-muted-foreground">{[j.title, j.hint].filter(Boolean).join(" · ")}</span>
              </button>
            </li>
          ))}
          {!busy && !hits.length && !quickShown.length && <li className="px-2.5 py-2 text-xs text-muted-foreground">{q.length < 2 ? "Napiš číslo zakázky, zákazníka nebo výkres." : "Nic nenalezeno."}</li>}
        </ul>
      )}
    </div>
  );
}
