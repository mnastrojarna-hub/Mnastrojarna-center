"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, Plus, Scissors, Sparkles, Trash2, Warehouse } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/jobs/book/native-select";
import { JobPicker } from "@/components/supplier-invoices/job-picker";
import { formatMoney } from "@/components/supplier-invoices/format";
import {
  addDraft, capItems, patchDraft, removeDraft, setRowText, splitDraft, type AllocationDraft, type InvoiceShape,
} from "@/components/supplier-invoices/allocation-model";
import { orderItemsForSupplierInvoice } from "@/app/actions/supplier-invoices";
import { allocatedOf, capacityOf, remainderOf, toCents } from "@/lib/supplier-invoices/money";
import { OVERHEAD_CATEGORIES, type JobRefView, type OverheadCategory, type SupplierInvoiceDetail } from "@/lib/supplier-invoices/types";
import { cn } from "@/lib/utils";

interface EditorProps {
  detail: SupplierInvoiceDetail;
  rows: AllocationDraft[];
  onChange: (rows: AllocationDraft[]) => void;
  disabled?: boolean;
}

/** Položky faktury a pod každou řádky rozdělení (zakázka / režie, částka, rozdělit) + zbytek faktury. */
export function AllocationEditor({ detail, rows, onChange, disabled }: EditorProps) {
  const inv: InvoiceShape = { totalNet: detail.totalNet, items: detail.items.map((i) => ({ id: i.id, amount: i.amount })) };
  const headerCap = capacityOf(null, detail.totalNet, capItems(inv));
  const quick = React.useMemo(() => {
    const m = new Map<string, JobRefView>();
    for (const po of detail.supplierPurchaseOrders) if (po.job) m.set(po.job.id, po.job);
    return [...m.values()];
  }, [detail.supplierPurchaseOrders]);
  const blocks: { itemId: string | null; title: string; sub: string; amount: number }[] = detail.items
    .filter((i) => (i.amount ?? 0) !== 0)
    .map((i) => ({
      itemId: i.id,
      title: `${i.position + 1}. ${i.text || "Položka bez textu"}`,
      sub: [i.code, i.quantity ? `${i.quantity.toLocaleString("cs-CZ")} ${i.unit ?? ""}`.trim() : null,
        i.unitPrice ? `× ${formatMoney(i.unitPrice, detail.currency)}` : null, i.vatRate !== null ? `DPH ${i.vatRate} %` : null].filter(Boolean).join(" · "),
      amount: i.amount ?? 0,
    }));
  if (toCents(headerCap) !== 0) {
    blocks.push({
      itemId: null,
      title: detail.items.length ? "Zbytek faktury mimo položky" : "Celá faktura (bez položek)",
      sub: detail.items.length ? "rozdíl mezi součtem bez DPH a položkami" : "faktura nemá rozepsané položky",
      amount: headerCap,
    });
  }

  return (
    <div className="space-y-3">
      {blocks.map((b) => (
        <ItemBlock
          key={b.itemId ?? "header"}
          block={b}
          rows={rows.filter((r) => (r.itemId ?? null) === b.itemId)}
          allRows={rows}
          inv={inv}
          currency={detail.currency}
          quick={quick}
          detail={detail}
          disabled={disabled}
          onChange={onChange}
        />
      ))}
      {blocks.length === 0 && (
        <p className="rounded-xl border border-dashed p-4 text-center text-sm text-muted-foreground">
          Faktura zatím nemá částku ani položky — doplň součet bez DPH nebo položky (Upravit).
        </p>
      )}
    </div>
  );
}

function ItemBlock({ block, rows, allRows, inv, currency, quick, detail, disabled, onChange }: {
  block: { itemId: string | null; title: string; sub: string; amount: number };
  rows: AllocationDraft[];
  allRows: AllocationDraft[];
  inv: InvoiceShape;
  currency: string;
  quick: JobRefView[];
  detail: SupplierInvoiceDetail;
  disabled?: boolean;
  onChange: (rows: AllocationDraft[]) => void;
}) {
  const left = remainderOf(block.itemId, inv.totalNet, capItems(inv), allRows);
  const used = allocatedOf(block.itemId, allRows);
  const over = toCents(left) !== 0 && Math.sign(left) !== Math.sign(block.amount);
  const done = toCents(left) === 0;
  const pct = block.amount ? Math.min(100, Math.max(0, Math.round((used / block.amount) * 100))) : 0;
  return (
    <section className="rounded-2xl border bg-card shadow-sm" data-testid="invoice-item" data-item-id={block.itemId ?? "header"}>
      <div className="flex items-start gap-2 p-3 pb-2">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold leading-snug">{block.title}</p>
          {block.sub && <p className="text-xs text-muted-foreground">{block.sub}</p>}
        </div>
        <p className="shrink-0 text-right text-sm font-semibold tabular-nums">{formatMoney(block.amount, currency)}</p>
      </div>
      <div className="px-3">
        <div className="h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
          <span className={cn("block h-full transition-all", over ? "bg-red-500" : done ? "bg-emerald-500" : "bg-amber-400")} style={{ width: `${over ? 100 : pct}%` }} />
        </div>
        <p className={cn("mt-1 flex items-center gap-1 text-xs font-medium", over ? "text-red-700 dark:text-red-300" : done ? "text-emerald-700 dark:text-emerald-300" : "text-amber-800 dark:text-amber-300")} data-testid="item-remainder">
          {over ? <AlertTriangle className="h-3.5 w-3.5" /> : done ? <CheckCircle2 className="h-3.5 w-3.5" /> : null}
          {over ? `rozděleno o ${formatMoney(Math.abs(left), currency)} víc` : done ? "rozděleno celé" : `zbývá rozdělit ${formatMoney(left, currency)}`}
        </p>
      </div>
      <ul className="space-y-2 p-3 pt-2">
        {rows.map((r) => (
          <AllocationRow key={r.key} row={r} allRows={allRows} inv={inv} quick={quick} detail={detail} disabled={disabled} onChange={onChange} />
        ))}
      </ul>
      {!disabled && (
        <div className="flex flex-wrap gap-2 border-t px-3 py-2">
          <Button type="button" size="sm" variant="outline" className="h-9" onClick={() => onChange(rows.length ? splitDraft(allRows, block.itemId, inv) : addDraft(allRows, block.itemId, inv, "job"))} data-testid="item-split">
            {rows.length ? <><Scissors className="h-4 w-4" /> Rozdělit</> : <><Plus className="h-4 w-4" /> Na zakázku</>}
          </Button>
          <Button type="button" size="sm" variant="ghost" className="h-9" onClick={() => onChange(addDraft(allRows, block.itemId, inv, "rezie"))} data-testid="item-overhead">
            <Warehouse className="h-4 w-4" /> Režie
          </Button>
        </div>
      )}
    </section>
  );
}

function AllocationRow({ row, allRows, inv, quick, detail, disabled, onChange }: {
  row: AllocationDraft;
  allRows: AllocationDraft[];
  inv: InvoiceShape;
  quick: JobRefView[];
  detail: SupplierInvoiceDetail;
  disabled?: boolean;
  onChange: (rows: AllocationDraft[]) => void;
}) {
  const [items, setItems] = React.useState<{ id: string; label: string }[] | null>(null);
  const jobId = row.job?.id ?? null;
  const pos = detail.supplierPurchaseOrders.filter((p) => p.job?.id === jobId);
  React.useEffect(() => { setItems(null); }, [jobId]);
  const loadItems = async () => {
    if (!jobId || items) return;
    const res = await orderItemsForSupplierInvoice(jobId);
    setItems(res.ok ? res.items : []);
  };
  const patch = (p: Partial<AllocationDraft>) => onChange(patchDraft(allRows, row.key, { ...p, confirmed: false }));
  const idBase = `alloc-${row.key}`;
  return (
    <li className={cn("rounded-xl border p-2", row.aiSuggested && !row.confirmed ? "border-fuchsia-300 bg-fuchsia-50/50 dark:border-fuchsia-500/40 dark:bg-fuchsia-500/10" : "bg-background")} data-testid="allocation-row">
      <div className="grid grid-cols-[auto_minmax(0,1fr)] items-center gap-2 sm:grid-cols-[auto_minmax(0,1fr)_9rem_auto]">
        <div className="inline-flex rounded-lg border p-0.5 text-xs" role="group" aria-label="Kam">
          {(["job", "rezie"] as const).map((t) => (
            <button
              key={t}
              type="button"
              disabled={disabled}
              aria-pressed={row.target === t}
              onClick={() => patch(t === "rezie" ? { target: t, job: null, purchaseOrderId: null, purchaseOrderItemId: null, orderItemId: null, category: row.category ?? "ostatni" } : { target: t, category: null })}
              className={cn("rounded-md px-2 py-1.5 font-medium", row.target === t ? "bg-foreground text-background" : "text-muted-foreground hover:bg-accent")}
            >
              {t === "job" ? "Zakázka" : "Režie"}
            </button>
          ))}
        </div>
        <div className="min-w-0">
          {row.target === "job" ? (
            disabled ? (
              <p className="truncate text-sm"><span className="font-mono font-semibold">{row.job?.number ?? "—"}</span> {row.job?.customerName ?? ""}</p>
            ) : (
              <JobPicker id={`${idBase}-job`} value={row.job} quick={quick} onChange={(job) => patch({ job, purchaseOrderId: null, purchaseOrderItemId: null, orderItemId: null, orderItemLabel: null })} />
            )
          ) : (
            <NativeSelect id={`${idBase}-cat`} disabled={disabled} value={row.category ?? "ostatni"} onChange={(e) => patch({ category: e.target.value as OverheadCategory })} className="h-10" aria-label="Druh režie">
              {OVERHEAD_CATEGORIES.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
            </NativeSelect>
          )}
        </div>
        <div className="col-span-2 flex items-center gap-1.5 sm:col-span-1">
          <Input
            id={`${idBase}-amount`}
            inputMode="decimal"
            disabled={disabled}
            value={row.text}
            onChange={(e) => onChange(setRowText(allRows, row.key, e.target.value, inv).map((r) => (r.key === row.key ? { ...r, confirmed: false } : r)))}
            className={cn("h-10 text-right text-base tabular-nums sm:text-sm", row.auto && "border-dashed")}
            aria-label="Částka (nebo %)"
            data-testid="allocation-amount"
          />
          {!disabled && (
            <button type="button" aria-label="Smazat řádek" onClick={() => onChange(removeDraft(allRows, row.key))} className="rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-red-600 sm:hidden">
              <Trash2 className="h-4 w-4" />
            </button>
          )}
        </div>
        {!disabled && (
          <button type="button" aria-label="Smazat řádek" onClick={() => onChange(removeDraft(allRows, row.key))} className="hidden rounded-md p-2 text-muted-foreground hover:bg-accent hover:text-red-600 sm:block">
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        {row.aiSuggested && (
          <span className={cn("inline-flex items-center gap-1", !row.confirmed && "font-medium text-fuchsia-700 dark:text-fuchsia-300")} data-testid="allocation-ai">
            <Sparkles className="h-3 w-3" /> {row.confirmed ? "AI" : "návrh AI"}{row.aiReason ? ` — ${row.aiReason}` : ""}
          </span>
        )}
        {row.confirmed && !row.aiSuggested && <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" /> potvrzeno</span>}
        {row.confirmed && row.aiSuggested && <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3 w-3" /> potvrzeno</span>}
        {row.target === "job" && jobId && (pos.length > 0 || row.purchaseOrderId) && (
          <label className="inline-flex items-center gap-1">
            objednávka
            <select
              disabled={disabled}
              value={row.purchaseOrderId ?? ""}
              onChange={(e) => patch({ purchaseOrderId: e.target.value || null, purchaseOrderItemId: null })}
              className="h-7 rounded-md border bg-background px-1 text-xs"
              aria-label="Objednávka dodavateli"
            >
              <option value="">bez objednávky</option>
              {pos.map((p) => <option key={p.id} value={p.id}>{p.number ?? "—"}</option>)}
              {row.purchaseOrderId && !pos.some((p) => p.id === row.purchaseOrderId) && <option value={row.purchaseOrderId}>vybraná</option>}
            </select>
          </label>
        )}
        {row.target === "job" && jobId && (
          <label className="inline-flex items-center gap-1">
            položka
            <select
              disabled={disabled}
              value={row.orderItemId ?? ""}
              onFocus={() => void loadItems()}
              onMouseDown={() => void loadItems()}
              onChange={(e) => patch({ orderItemId: e.target.value || null, orderItemLabel: items?.find((i) => i.id === e.target.value)?.label ?? null })}
              className="h-7 max-w-[12rem] rounded-md border bg-background px-1 text-xs"
              aria-label="Položka zakázky"
            >
              <option value="">celá zakázka</option>
              {row.orderItemId && !items?.some((i) => i.id === row.orderItemId) && <option value={row.orderItemId}>{row.orderItemLabel ?? "vybraná"}</option>}
              {(items ?? []).map((i) => <option key={i.id} value={i.id}>{i.label}</option>)}
            </select>
          </label>
        )}
      </div>
    </li>
  );
}
