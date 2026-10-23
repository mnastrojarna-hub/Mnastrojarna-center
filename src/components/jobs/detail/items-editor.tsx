"use client";

import * as React from "react";
import { ArrowUp, ArrowDown, Trash2, Plus, PencilRuler } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { DrawingSpecChips } from "@/components/jobs/drawing-spec-chips";
import type { DrawingSpecView } from "@/lib/jobs/drawing-spec";
import {
  draftTotals, emptyItemDraft, isInvalidDecimal, lineTotal, moveItem, formatMoney, formatPercent, formatQty,
  type ItemDraft,
} from "./detail-helpers";

/**
 * Editor položek (zakázka i nabídka): na počítači tabulka, na mobilu karty.
 * Čísla se zadávají česky („1,5"), neplatné políčko zčervená.
 */

export interface ItemsEditorColumns {
  revision?: boolean;
  vat?: boolean;
  purchase?: boolean;
  currency?: string;
}

type Field = keyof Omit<ItemDraft, "key" | "id">;

const cell =
  "h-8 w-full min-w-0 rounded-md border border-transparent bg-transparent px-2 text-sm outline-none transition placeholder:text-muted-foreground/60 hover:border-input focus:border-ring focus:bg-background focus:ring-1 focus:ring-ring";
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

export function ItemsEditor({
  drafts, onChange, columns = {}, emptyHint, specs,
}: {
  drafts: ItemDraft[];
  onChange: (next: ItemDraft[]) => void;
  columns?: ItemsEditorColumns;
  emptyHint?: string;
  /** Štítky z výkresu (materiál, hmotnost, TZ / PÚ) podle klíče konceptu (= id položky). */
  specs?: Record<string, DrawingSpecView | null | undefined>;
}) {
  const currency = columns.currency ?? "CZK";
  const totals = draftTotals(drafts);

  const set = (i: number, field: Field, v: string) => {
    onChange(drafts.map((d, j) => (j === i ? { ...d, [field]: v } : d)));
  };
  const remove = (i: number) => onChange(drafts.filter((_, j) => j !== i));
  const move = (i: number, to: number) => onChange(moveItem(drafts, i, to));
  const add = () => onChange([...drafts, emptyItemDraft()]);

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
      <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-blue-200 bg-blue-50/40 px-4 py-10 text-center dark:border-blue-500/20 dark:bg-blue-500/5">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
          <PencilRuler className="h-6 w-6" />
        </span>
        <div>
          <p className="font-medium">Zatím žádné položky</p>
          <p className="mt-1 max-w-sm text-sm text-muted-foreground">
            {emptyHint ?? "Přidej díly — číslo výkresu, název, materiál a počet kusů. Z položek pak jedním klikem vznikne nabídka."}
          </p>
        </div>
        <Button type="button" variant="success" onClick={add}>
          <Plus className="h-4 w-4" /> Přidat první položku
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {/* počítač: tabulka */}
      <div className="hidden overflow-x-auto rounded-xl border md:block">
        <table className="w-full text-sm">
          <thead className="bg-muted/50 text-xs text-muted-foreground">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:text-left [&>th]:font-medium">
              <th className="w-8 text-center">#</th>
              <th className="min-w-[8rem]">Č. výkresu</th>
              {columns.revision && <th className="w-14">Rev.</th>}
              <th className="min-w-[12rem]">Název / popis</th>
              <th className="min-w-[7rem]">Materiál</th>
              <th className="w-20 !text-right">Množství</th>
              <th className="w-14">MJ</th>
              <th className="w-28 !text-right">Cena / MJ</th>
              {columns.vat && <th className="w-16 !text-right">DPH %</th>}
              <th className="w-28 !text-right">Celkem</th>
              {columns.purchase && <th className="w-28 !text-right">Nákup / MJ</th>}
              <th className="w-24" />
            </tr>
          </thead>
          <tbody>
            {drafts.map((d, i) => {
              const total = lineTotal(d);
              return (
                <tr key={d.key} className="border-t align-top [&>td]:px-1 [&>td]:py-1">
                  <td className="pt-2.5 text-center text-xs font-semibold text-muted-foreground">{i + 1}</td>
                  <td><Cell label="Číslo výkresu" mono value={d.drawingNumber} onChange={(v) => set(i, "drawingNumber", v)} placeholder="VK-1234" /></td>
                  {columns.revision && <td><Cell label="Revize" value={d.revision} onChange={(v) => set(i, "revision", v)} placeholder="A" /></td>}
                  <td>
                    <Cell label="Název" value={d.name} onChange={(v) => set(i, "name", v)} placeholder="Název dílu" className="font-medium" />
                    <Cell label="Popis" value={d.description} onChange={(v) => set(i, "description", v)} placeholder="popis, úprava, tolerance…" className="h-7 text-xs text-muted-foreground" />
                    <DrawingSpecChips spec={specs?.[d.key]} className="px-2 pb-1" testId={`item-spec-${i}`} />
                  </td>
                  <td><Cell label="Materiál" value={d.material} onChange={(v) => set(i, "material", v)} placeholder="1.2379" /></td>
                  <td><Cell label="Množství" numeric value={d.quantity} onChange={(v) => set(i, "quantity", v)} placeholder="1" /></td>
                  <td><Cell label="Měrná jednotka" value={d.unit} onChange={(v) => set(i, "unit", v)} placeholder="ks" /></td>
                  <td><Cell label="Cena za MJ" numeric value={d.unitPrice} onChange={(v) => set(i, "unitPrice", v)} placeholder="doplnit" /></td>
                  {columns.vat && <td><Cell label="DPH %" numeric value={d.vatRate} onChange={(v) => set(i, "vatRate", v)} placeholder="21" /></td>}
                  <td className="pt-2.5 text-right font-semibold tabular-nums">
                    {total === null ? <span className="font-normal text-muted-foreground">—</span> : formatMoney(total, currency)}
                  </td>
                  {columns.purchase && <td><Cell label="Nákupní cena za MJ" numeric value={d.purchaseUnitPrice} onChange={(v) => set(i, "purchaseUnitPrice", v)} placeholder="—" className="text-emerald-700 dark:text-emerald-400" /></td>}
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
          const total = lineTotal(d);
          return (
            <li key={d.key} className="rounded-xl border bg-card p-3 shadow-sm">
              <div className="mb-2 flex items-center justify-between">
                <span className="inline-flex h-6 min-w-[1.5rem] items-center justify-center rounded-full bg-blue-100 px-1.5 text-xs font-bold text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">{i + 1}</span>
                {actions(i)}
              </div>
              <div className="grid grid-cols-2 gap-x-2 gap-y-1.5 text-xs">
                <label className="col-span-2">
                  <span className="text-muted-foreground">Název</span>
                  <Cell label="Název" value={d.name} onChange={(v) => set(i, "name", v)} placeholder="Název dílu" className="border-input font-medium" />
                </label>
                <label>
                  <span className="text-muted-foreground">Č. výkresu</span>
                  <Cell label="Číslo výkresu" mono value={d.drawingNumber} onChange={(v) => set(i, "drawingNumber", v)} placeholder="VK-1234" className="border-input" />
                </label>
                {columns.revision ? (
                  <label>
                    <span className="text-muted-foreground">Revize</span>
                    <Cell label="Revize" value={d.revision} onChange={(v) => set(i, "revision", v)} placeholder="A" className="border-input" />
                  </label>
                ) : (
                  <label>
                    <span className="text-muted-foreground">Materiál</span>
                    <Cell label="Materiál" value={d.material} onChange={(v) => set(i, "material", v)} placeholder="1.2379" className="border-input" />
                  </label>
                )}
                {columns.revision && (
                  <label className="col-span-2">
                    <span className="text-muted-foreground">Materiál</span>
                    <Cell label="Materiál" value={d.material} onChange={(v) => set(i, "material", v)} placeholder="1.2379" className="border-input" />
                  </label>
                )}
                <label className="col-span-2">
                  <span className="text-muted-foreground">Popis</span>
                  <Cell label="Popis" value={d.description} onChange={(v) => set(i, "description", v)} placeholder="úprava, tolerance…" className="border-input" />
                </label>
                {specs?.[d.key] && <DrawingSpecChips spec={specs[d.key]} className="col-span-2" testId={`item-spec-m-${i}`} />}
                <label>
                  <span className="text-muted-foreground">Množství</span>
                  <div className="flex gap-1">
                    <Cell label="Množství" numeric value={d.quantity} onChange={(v) => set(i, "quantity", v)} className="border-input" />
                    <Cell label="MJ" value={d.unit} onChange={(v) => set(i, "unit", v)} className="w-14 shrink-0 border-input" />
                  </div>
                </label>
                <label>
                  <span className="text-muted-foreground">Cena / MJ</span>
                  <Cell label="Cena za MJ" numeric value={d.unitPrice} onChange={(v) => set(i, "unitPrice", v)} placeholder="doplnit" className="border-input" />
                </label>
                {columns.vat && (
                  <label>
                    <span className="text-muted-foreground">DPH %</span>
                    <Cell label="DPH %" numeric value={d.vatRate} onChange={(v) => set(i, "vatRate", v)} className="border-input" />
                  </label>
                )}
                {columns.purchase && (
                  <label>
                    <span className="text-muted-foreground">Nákup / MJ</span>
                    <Cell label="Nákupní cena za MJ" numeric value={d.purchaseUnitPrice} onChange={(v) => set(i, "purchaseUnitPrice", v)} placeholder="—" className="border-input" />
                  </label>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between border-t pt-2 text-sm">
                <span className="text-xs text-muted-foreground">Celkem</span>
                <span className="font-semibold tabular-nums">{total === null ? "—" : formatMoney(total, currency)}</span>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <Button type="button" variant="outline" onClick={add}>
          <Plus className="h-4 w-4 text-blue-600" /> Přidat položku
        </Button>
        <dl className="grid min-w-[16rem] grid-cols-[1fr_auto] gap-x-6 gap-y-1 rounded-xl bg-muted/40 px-4 py-3 text-sm">
          <dt className="text-muted-foreground">Kusů celkem</dt>
          <dd className="text-right tabular-nums">{formatQty(totals.quantity)}</dd>
          <dt className="font-medium">Celkem bez DPH</dt>
          <dd className="text-right font-bold tabular-nums">{formatMoney(totals.net, currency)}</dd>
          {columns.vat && totals.net !== null && (
            <>
              <dt className="text-muted-foreground">DPH</dt>
              <dd className="text-right tabular-nums">{formatMoney(totals.vat, currency)}</dd>
              <dt className="text-muted-foreground">Celkem s DPH</dt>
              <dd className="text-right tabular-nums">{formatMoney(totals.gross, currency)}</dd>
            </>
          )}
          {columns.purchase && totals.purchase !== null && (
            <>
              <dt className="text-emerald-700 dark:text-emerald-400">Nákup celkem</dt>
              <dd className="text-right tabular-nums text-emerald-700 dark:text-emerald-400">{formatMoney(totals.purchase, currency)}</dd>
              <dt className="text-emerald-700 dark:text-emerald-400">Marže</dt>
              <dd className="text-right font-semibold tabular-nums text-emerald-700 dark:text-emerald-400">{formatPercent(totals.margin)}</dd>
            </>
          )}
          {totals.unpriced > 0 && (
            <dd className="col-span-2 mt-1 text-xs text-amber-700 dark:text-amber-400">
              {totals.unpriced === 1 ? "1 položka nemá cenu" : `${totals.unpriced} položek nemá cenu`} — doplň ji před odesláním nabídky.
            </dd>
          )}
        </dl>
      </div>
    </div>
  );
}
