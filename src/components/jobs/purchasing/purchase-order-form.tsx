"use client";

import * as React from "react";
import {
  Factory, CalendarDays, Truck, Wallet, MapPin, StickyNote, AlertTriangle, CalendarClock, TrendingUp, TrendingDown,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SearchSelect, type SearchOption } from "@/components/jobs/detail/search-select";
import { formatMoney, formatPercent } from "@/components/jobs/detail/detail-helpers";
import { cn } from "@/lib/utils";
import { PurchaseItemsEditor } from "./purchase-items-editor";
import { Field } from "./ui-bits";
import { purchaseDraftsTotal, type PurchaseOrderFormState } from "./purchasing-model";

/**
 * Formulář objednávky dodavateli (vystavení i úprava): dodavatel, položky,
 * termíny, dodací adresa, podmínky, poznámka a živý přepočet marže.
 * Do objednávky nikdy nejde prodejní cena ani jméno našeho zákazníka.
 */
export function PurchaseOrderForm({
  form, onChange, supplierOptions, supplierLocked, supplierLabel, warnings = [], requiredDateHint, margin, currency,
}: {
  form: PurchaseOrderFormState;
  onChange: (next: PurchaseOrderFormState) => void;
  supplierOptions: SearchOption[];
  /** Dodavatel už nejde změnit (vystavená objednávka). */
  supplierLocked?: boolean;
  supplierLabel?: string | null;
  warnings?: string[];
  requiredDateHint?: string | null;
  /** Živý přepočet: obrat zakázky a náklad ostatních objednávek. */
  margin?: { revenue: number | null; otherCost: number } | null;
  currency: string;
}) {
  const set = <K extends keyof PurchaseOrderFormState>(k: K, v: PurchaseOrderFormState[K]) => onChange({ ...form, [k]: v });
  const sum = purchaseDraftsTotal(form.items);
  const cost = margin ? margin.otherCost + sum.total : null;
  const profit = margin && margin.revenue !== null && cost !== null ? Math.round((margin.revenue - cost) * 100) / 100 : null;
  const share = profit !== null && margin?.revenue ? profit / margin.revenue : null;

  return (
    <div className="space-y-5">
      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {warnings.map((w) => (
            <li key={w} className="flex items-start gap-2">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
              <span>{w}</span>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-lg border px-3 py-2 sm:col-span-2">
          {supplierLocked ? (
            <div>
              <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Factory className="h-3.5 w-3.5 text-orange-600" /> Dodavatel
              </div>
              <div className="truncate text-sm font-medium">{supplierLabel || form.supplierName || "—"}</div>
            </div>
          ) : (
            <SearchSelect
              label="Dodavatel"
              icon={Factory}
              iconClass="text-orange-600"
              value={form.supplierId}
              valueLabel={supplierLabel}
              options={supplierOptions}
              emptyLabel={form.supplierName ? `${form.supplierName} (založí se do adresáře)` : "Vyber dodavatele…"}
              createLabel="Nový dodavatel"
              allowClear={false}
              onSave={async (v) => {
                onChange({ ...form, supplierId: v, supplierName: v ? "" : form.supplierName });
                return null;
              }}
              onCreate={async (name) => {
                onChange({ ...form, supplierId: null, supplierName: name });
                return null;
              }}
            />
          )}
        </div>
        <Field label="Datum objednávky" icon={CalendarDays}>
          <Input type="date" value={form.orderDate} onChange={(e) => set("orderDate", e.target.value)} />
        </Field>
        <Field label="Požadovaný termín dodání" icon={CalendarClock} iconClass="text-red-500" hint={requiredDateHint ?? undefined}>
          <Input type="date" value={form.requiredDate} onChange={(e) => set("requiredDate", e.target.value)} className={cn(!form.requiredDate && "border-amber-400")} />
        </Field>
      </div>

      <PurchaseItemsEditor drafts={form.items} onChange={(items) => set("items", items)} currency={currency} />

      {margin && (
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border px-3 py-2.5 text-sm",
            profit === null ? "bg-muted/40" : profit >= 0
              ? "border-green-200 bg-green-50 dark:border-green-500/30 dark:bg-green-500/10"
              : "border-red-200 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10",
          )}
        >
          {profit !== null && profit < 0 ? <TrendingDown className="h-4 w-4 text-red-600" /> : <TrendingUp className="h-4 w-4 text-green-600" />}
          <span className="text-muted-foreground">Po vystavení:</span>
          <span>obrat <strong className="tabular-nums">{formatMoney(margin.revenue, currency)}</strong></span>
          <span>− nákup <strong className="tabular-nums">{formatMoney(cost, currency)}</strong></span>
          <span>
            = zisk{" "}
            <strong className={cn("tabular-nums", profit === null ? "" : profit >= 0 ? "text-green-700 dark:text-green-400" : "text-red-700 dark:text-red-400")}>
              {formatMoney(profit, currency)}
            </strong>
          </span>
          {share !== null && <span className="rounded-full bg-background/70 px-2 py-0.5 text-xs font-semibold">marže {formatPercent(share)}</span>}
        </div>
      )}

      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Dodací adresa" icon={MapPin}>
          <Textarea rows={3} value={form.deliveryAddress} onChange={(e) => set("deliveryAddress", e.target.value)} />
        </Field>
        <div className="grid gap-3">
          <Field label="Dodací podmínky" icon={Truck}>
            <Input value={form.deliveryTerms} onChange={(e) => set("deliveryTerms", e.target.value)} placeholder="DAP Mnástrojárna" />
          </Field>
          <Field label="Platební podmínky" icon={Wallet}>
            <Input value={form.paymentTerms} onChange={(e) => set("paymentTerms", e.target.value)} placeholder="Splatnost 30 dní" />
          </Field>
        </div>
      </div>
      <Field label="Poznámka na objednávce" icon={StickyNote} hint="Zobrazí se dodavateli na PDF.">
        <Textarea rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} />
      </Field>
    </div>
  );
}
