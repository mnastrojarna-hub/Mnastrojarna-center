"use client";

import * as React from "react";
import { FileWarning, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DEVIATION_SOURCE_LABEL, deviationText, type PoDeviation } from "@/lib/jobs/po-deviations";
import { manualDeviation, type PurchaseItemDraft } from "./purchasing-model";

/**
 * Odchylky od výkresu u položek objednávky dodavateli (majitel 2. 11.): předvyplněné ze zakázky (pokyn
 * zákazníka z e-mailu, oprava, nová revize) — zaškrtnuté se vytisknou pod položku v PDF („platí místo
 * výkresu") a krátce do e-mailu. Text jde upravit, odškrtnutá se nepošle, vlastní jde přidat.
 */
export function PoDeviationsEditor({ drafts, onChange }: { drafts: PurchaseItemDraft[]; onChange: (next: PurchaseItemDraft[]) => void }) {
  const rows = drafts.map((d, i) => ({ d, i })).filter(({ d }) => d.deviations !== undefined && (d.drawingNumber.trim() || d.name.trim()));
  if (!rows.length) return null;
  const total = rows.reduce((s, r) => s + (r.d.deviations ?? []).filter((x) => !x.off).length, 0);
  const setList = (i: number, list: PoDeviation[]) => onChange(drafts.map((d, j) => (j === i ? { ...d, deviations: list } : d)));
  const patch = (i: number, k: number, p: Partial<PoDeviation>) => {
    const list = drafts[i].deviations ?? [];
    setList(i, list.map((x, j) => (j === k ? { ...x, ...p } : x)));
  };

  return (
    <section
      className={cn(
        "space-y-2 rounded-xl border p-3",
        total ? "border-rose-300 bg-rose-50/60 dark:border-rose-500/40 dark:bg-rose-500/10" : "bg-muted/30",
      )}
      data-testid="po-deviations"
      aria-label="Odchylky od výkresu"
    >
      <div className="flex flex-wrap items-center gap-2">
        <FileWarning className={cn("h-4 w-4", total ? "text-rose-600" : "text-muted-foreground")} aria-hidden />
        <h3 className="text-sm font-semibold">Odchylky od výkresu</h3>
        <span className="text-xs text-muted-foreground">
          {total ? `${total} — vytisknou se pod položku a do e-mailu jako „platí místo výkresu"` : "Žádné — díly se vyrábí přesně podle výkresu."}
        </span>
      </div>
      <ul className="space-y-2">
        {rows.map(({ d, i }) => {
          const list = d.deviations ?? [];
          const ref = d.drawingNumber.trim() || d.name.trim();
          return (
            <li key={d.key} className="space-y-1" data-testid="po-deviation-item">
              <div className="flex items-center justify-between gap-2">
                <span className="truncate text-xs font-semibold"><span className="font-mono">{ref}</span>{list.length ? "" : <span className="font-normal text-muted-foreground"> · bez odchylek</span>}</span>
                <Button type="button" variant="ghost" size="sm" className="h-8 shrink-0 text-xs" onClick={() => setList(i, [...list, manualDeviation()])}>
                  <Plus className="h-3.5 w-3.5" /> Odchylka
                </Button>
              </div>
              {list.map((x, k) => (
                <div key={x.key} className={cn("flex items-start gap-2 rounded-lg border bg-background/80 px-2 py-1.5", x.off && "opacity-60")}>
                  <input
                    type="checkbox"
                    className="mt-2 h-4 w-4 shrink-0 accent-rose-600"
                    checked={!x.off}
                    onChange={(e) => patch(i, k, { off: !e.target.checked })}
                    aria-label={`Poslat odchylku ${deviationText(x)}`}
                  />
                  <div className="min-w-0 flex-1 space-y-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {x.source === "rucne" ? (
                        <input
                          value={x.label}
                          onChange={(e) => patch(i, k, { label: e.target.value })}
                          aria-label="Co se mění"
                          className="h-7 w-32 rounded-md border bg-transparent px-1.5 text-xs font-medium"
                        />
                      ) : (
                        <span className="text-xs font-medium">{x.source === "revize" ? "Revize výkresu" : x.label}</span>
                      )}
                      <span className="rounded-full bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">{DEVIATION_SOURCE_LABEL[x.source]}</span>
                      {x.drawingValue ? <span className="text-[11px] text-muted-foreground">na výkresu: {x.drawingValue}</span> : null}
                      {!x.drawingValue && x.was ? <span className="text-[11px] text-muted-foreground">dříve: {x.was}</span> : null}
                    </div>
                    <input
                      value={x.value}
                      onChange={(e) => patch(i, k, { value: e.target.value })}
                      aria-label={`Platí místo výkresu — ${ref}`}
                      placeholder="platí místo výkresu…"
                      className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
                    />
                  </div>
                  {x.source === "rucne" && (
                    <button type="button" onClick={() => setList(i, list.filter((_, j) => j !== k))} className="mt-1 rounded p-1 text-muted-foreground hover:text-red-600" aria-label="Odebrat odchylku">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              ))}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
