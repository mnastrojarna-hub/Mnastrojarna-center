"use client";

import * as React from "react";
import { ArrowDown, ArrowUp, Plus, Trash2, PackagePlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { isInvalidDecimal, formatMoney, moveItem } from "@/components/jobs/detail/detail-helpers";
import {
  emptyPurchaseDraft, purchaseDraftLine, purchaseDraftsTotal, type PurchaseItemDraft,
} from "./purchasing-model";

/**
 * Položky nákupu (nabídka dodavatele, objednávka dodavateli): na počítači
 * tabulka, na mobilu karty. Čísla česky („1,5"), neplatné políčko zčervená.
 * Prodejní cena sem nikdy nepatří — jen nákupní cena za MJ.
 */

type Field = keyof Omit<PurchaseItemDraft, "key">;

const cell =
  "h-9 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none transition placeholder:text-muted-foreground/60 hover:border-input focus:border-ring focus:bg-background focus:ring-1 focus:ring-ring md:h-8";
const bad = "!border-red-400 bg-red-50 dark:bg-red-500/10";

function Cell({
  value, onChange, placeholder, numeric, className, label, mono,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  numeric?: boolean;
  className?: string;
  label: string;
  mono?: boolean;
}) {
  return (
    <input
      value={value}
      onChange={(e) => onChange(e.target.value)}
      placeholder={placeholder}
      aria-label={label}
      inputMode={numeric ? "decimal" : undefined}
      className={cn(cell, numeric && "text-right tabular-nums", mono && "font-mono", numeric && isInvalidDecimal(value) && bad, className)}
    />
  );
}

export function PurchaseItemsEditor({
  drafts, onChange, currency = "CZK", emptyHint, onFillFromJob,
}: {
  drafts: PurchaseItemDraft[];
  onChange: (next: PurchaseItemDraft[]) => void;
  currency?: string;
  emptyHint?: string;
  /** Předvyplnit položky ze zakázky (nabídka dodavatele). */
  onFillFromJob?: () => void;
}) {
  const sum = purchaseDraftsTotal(drafts);
  const set = (i: number, field: Field, v: string) => onChange(drafts.map((d, j) => (j === i ? { ...d, [field]: v } : d)));
  const remove = (i: number) => onChange(drafts.filter((_, j) => j !== i));
  const move = (i: number, to: number) => onChange(moveItem(drafts, i, to));
  const add = () => onChange([...drafts, emptyPurchaseDraft()]);

  const actions = (i: number) => (
    <div className="flex items-center justify-end gap-0.5">
      <button type="button" onClick={() => move(i, i - 1)} disabled={i === 0} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" aria-label="Posunout nahoru">
        <ArrowUp className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => move(i, i + 1)} disabled={i === drafts.length - 1} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-30" aria-label="Posunout dolů">
        <ArrowDown className="h-3.5 w-3.5" />
      </button>
      <button type="button" onClick={() => remove(i)} className="rounded p-1 text-muted-foreground hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10" aria-label="Odebrat položku">
        <Trash2 className="h-3.5 w-3.5" />
      </button>
    </div>
  );

  if (!drafts.length) {
    return (
      <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-lime-300/70 bg-lime-50/40 px-4 py-8 text-center dark:border-lime-500/20 dark:bg-lime-500/5">
        <span className="flex h-11 w-11 items-center justify-center rounded-full bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300">
          <PackagePlus className="h-5 w-5" />
        </span>
        <p className="max-w-sm text-sm text-muted-foreground">{emptyHint ?? "Přidej položky — číslo výkresu, název, množství a nákupní cenu."}</p>
        <div className="flex flex-wrap justify-center gap-2">
          {onFillFromJob && (
            <Button type="button" variant="outline" size="sm" onClick={onFillFromJob}>Načíst položky ze zakázky</Button>
          )}
          <Button type="button" variant="success" size="sm" onClick={add}>
            <Plus className="h-4 w-4" /> Přidat položku
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {/* počítač: tabulka */}
      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
              <th className="w-8 text-center">#</th>
              <th className="min-w-[8rem]">Č. výkresu</th>
              <th className="min-w-[12rem]">Název</th>
              <th className="min-w-[7rem]">Materiál</th>
              <th className="w-20 !text-right">Množství</th>
              <th className="w-14">MJ</th>
              <th className="w-28 !text-right">Nákup / MJ</th>
              <th className="w-28 !text-right">Celkem</th>
              <th className="w-20" />
            </tr>
          </thead>
          <tbody>
            {drafts.map((d, i) => {
              const line = purchaseDraftLine(d);
              return (
                <tr key={d.key} className="border-t align-top [&>td]:px-1 [&>td]:py-1">
                  <td className="pt-2.5 text-center text-xs font-semibold text-muted-foreground">{i + 1}</td>
                  <td><Cell label="Číslo výkresu" mono value={d.drawingNumber} onChange={(v) => set(i, "drawingNumber", v)} placeholder="VK-1234" /></td>
                  <td>
                    <Cell label="Název" value={d.name} onChange={(v) => set(i, "name", v)} placeholder="Název dílu" className="font-medium" />
                    <Cell label="Poznámka" value={d.note} onChange={(v) => set(i, "note", v)} placeholder="poznámka pro dodavatele…" className="h-7 text-xs text-muted-foreground md:h-7" />
                  </td>
                  <td><Cell label="Materiál" value={d.material} onChange={(v) => set(i, "material", v)} placeholder="1.2379" /></td>
                  <td><Cell label="Množství" numeric value={d.quantity} onChange={(v) => set(i, "quantity", v)} placeholder="1" /></td>
                  <td><Cell label="Měrná jednotka" value={d.unit} onChange={(v) => set(i, "unit", v)} placeholder="ks" /></td>
                  <td><Cell label="Nákupní cena za MJ" numeric value={d.unitPrice} onChange={(v) => set(i, "unitPrice", v)} placeholder="doplnit" className="text-emerald-700 dark:text-emerald-400" /></td>
                  <td className="pt-2.5 text-right font-semibold tabular-nums">
                    {line === null ? <span className="font-normal text-amber-600">bez ceny</span> : formatMoney(line, currency)}
                  </td>
                  <td className="pt-1">{actions(i)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* mobil: karty */}
      <ul className="space-y-2 md:hidden">
        {drafts.map((d, i) => {
          const line = purchaseDraftLine(d);
          return (
            <li key={d.key} className="space-y-1.5 rounded-xl border bg-card p-2.5 shadow-sm">
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-lime-100 px-2 py-0.5 text-[11px] font-semibold text-lime-800 dark:bg-lime-500/15 dark:text-lime-300">Položka {i + 1}</span>
                {actions(i)}
              </div>
              <div className="grid grid-cols-2 gap-1.5">
                <Cell label="Číslo výkresu" mono value={d.drawingNumber} onChange={(v) => set(i, "drawingNumber", v)} placeholder="Č. výkresu" className="border-input" />
                <Cell label="Materiál" value={d.material} onChange={(v) => set(i, "material", v)} placeholder="Materiál" className="border-input" />
              </div>
              <Cell label="Název" value={d.name} onChange={(v) => set(i, "name", v)} placeholder="Název dílu" className="border-input font-medium" />
              <div className="grid grid-cols-[1fr_4.5rem_1.2fr] gap-1.5">
                <Cell label="Množství" numeric value={d.quantity} onChange={(v) => set(i, "quantity", v)} placeholder="Množství" className="border-input" />
                <Cell label="Měrná jednotka" value={d.unit} onChange={(v) => set(i, "unit", v)} placeholder="ks" className="border-input" />
                <Cell label="Nákupní cena za MJ" numeric value={d.unitPrice} onChange={(v) => set(i, "unitPrice", v)} placeholder="Cena / MJ" className="border-input text-emerald-700 dark:text-emerald-400" />
              </div>
              <div className="flex items-center justify-between text-xs">
                <Cell label="Poznámka" value={d.note} onChange={(v) => set(i, "note", v)} placeholder="poznámka…" className="mr-2 h-8 text-xs" />
                <span className="shrink-0 font-semibold tabular-nums">
                  {line === null ? <span className="font-normal text-amber-600">bez ceny</span> : formatMoney(line, currency)}
                </span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" onClick={add}>
            <Plus className="h-4 w-4" /> Přidat položku
          </Button>
          {onFillFromJob && (
            <Button type="button" variant="ghost" size="sm" onClick={onFillFromJob}>Načíst ze zakázky</Button>
          )}
        </div>
        <div className="text-right text-sm">
          <span className="text-muted-foreground">Celkem bez DPH </span>
          <span className="text-base font-bold tabular-nums">{formatMoney(sum.total, currency)}</span>
          {sum.unpriced > 0 && <span className="block text-[11px] text-amber-600">{sum.unpriced} bez ceny</span>}
        </div>
      </div>
    </div>
  );
}
