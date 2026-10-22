"use client";

import * as React from "react";
import { ShoppingCart, Factory, CalendarDays, CalendarClock, CalendarCheck, Send, AlertTriangle, Hash } from "lucide-react";
import type { PurchaseOrderView } from "@/lib/jobs/purchasing-types";
import { PURCHASE_ORDER_STATUS_META } from "@/lib/jobs/purchasing";
import type { Notify } from "@/components/jobs/detail/toast";
import { formatMoney, formatQty, longDate } from "@/components/jobs/detail/detail-helpers";
import { cn, relativeTime } from "@/lib/utils";
import { PurchaseOrderActions } from "./purchase-order-actions";
import { ActorStamp, PurchaseOrderStatusBadge } from "./ui-bits";
import { isPurchaseOrderLate, type PurchaseAct } from "./purchasing-model";

/** Objednávka dodavateli v záložce zakázky: stav, termíny, položky, akce. */
export function PurchaseOrderCard({
  order, today, notify, onChanged, onEdit, acts = [],
}: {
  order: PurchaseOrderView;
  today: string;
  notify: Notify;
  onChanged: () => void;
  onEdit: () => void;
  /** Kdo co s objednávkou udělal (z historie zakázky). */
  acts?: PurchaseAct[];
}) {
  const m = PURCHASE_ORDER_STATUS_META[order.status];
  const late = isPurchaseOrderLate(order, today);
  const cancelled = order.status === "zrusena";

  return (
    <article className={cn("relative overflow-hidden rounded-xl border bg-card shadow-sm", cancelled && "opacity-70")}>
      <span className={cn("absolute inset-y-0 left-0 w-1.5", m.dot)} aria-hidden />
      <div className="space-y-3 p-4 pl-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <ShoppingCart className="h-4 w-4 text-lime-600" />
              <span className={cn("font-mono text-sm font-bold", cancelled && "line-through")}>{order.number}</span>
              <PurchaseOrderStatusBadge status={order.status} />
              {late && (
                <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-xs font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
                  <AlertTriangle className="h-3 w-3" /> po termínu
                </span>
              )}
            </div>
            <p className="flex items-center gap-1 truncate text-sm font-medium">
              <Factory className="h-3.5 w-3.5 shrink-0 text-orange-600" /> {order.supplier?.name ?? "Dodavatel"}
            </p>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums">{formatMoney(order.total, order.currency)}</div>
            <div className="text-[11px] text-muted-foreground">bez DPH</div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-xs sm:grid-cols-4">
          <div>
            <dt className="flex items-center gap-1 text-muted-foreground"><CalendarDays className="h-3 w-3 text-lime-600" /> Objednáno</dt>
            <dd className="font-medium">{longDate(order.orderDate) ?? "—"}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-muted-foreground"><CalendarClock className="h-3 w-3 text-red-500" /> Požadováno</dt>
            <dd className={cn("font-medium", late && !order.confirmedDate && "text-red-600 dark:text-red-400")}>{longDate(order.requiredDate) ?? "—"}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-muted-foreground"><CalendarCheck className="h-3 w-3 text-indigo-500" /> Potvrzeno</dt>
            <dd className={cn("font-medium", order.confirmedDate && "text-indigo-700 dark:text-indigo-300", late && order.confirmedDate && "text-red-600 dark:text-red-400")}>
              {longDate(order.confirmedDate) ?? "—"}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-muted-foreground"><Send className="h-3 w-3 text-red-500" /> Odesláno</dt>
            <dd className="font-medium" suppressHydrationWarning>{order.sentAt ? relativeTime(order.sentAt) : "—"}</dd>
          </div>
        </dl>

        {(order.supplierReference || order.supplierQuote?.number) && (
          <p className="flex flex-wrap gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
            {order.supplierQuote?.number && <span>dle nabídky <span className="font-mono text-foreground">{order.supplierQuote.number}</span></span>}
            {order.supplierReference && <span className="inline-flex items-center gap-1"><Hash className="h-3 w-3" /> potvrzení <span className="font-mono text-foreground">{order.supplierReference}</span></span>}
          </p>
        )}

        {order.items.length > 0 && (
          <ul className="flex flex-wrap gap-1.5">
            {order.items.slice(0, 6).map((it, i) => (
              <li key={it.id ?? i} className="inline-flex max-w-full items-center gap-1 rounded-full border bg-muted/30 px-2 py-0.5 text-[11px]">
                {it.drawingNumber && <span className="font-mono font-medium text-blue-700 dark:text-blue-400">{it.drawingNumber}</span>}
                <span className="truncate">{it.name}</span>
                <span className="tabular-nums text-muted-foreground">· {formatQty(it.quantity)} {it.unit}</span>
              </li>
            ))}
            {order.items.length > 6 && <li className="px-1 text-[11px] text-muted-foreground">+{order.items.length - 6}</li>}
          </ul>
        )}

        {acts.length > 0 && <ActsLine acts={acts} />}

        <PurchaseOrderActions order={order} notify={notify} onChanged={onChanged} onEdit={onEdit} />
      </div>
    </article>
  );
}

/** Řádek „Vystavil X · 22. 10. 14:05 → Odeslal dodavateli Y · …" (nejnovější vpravo). */
export function ActsLine({ acts, className }: { acts: PurchaseAct[]; className?: string }) {
  const shown = acts.slice(-4);
  return (
    <ol className={cn("flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t pt-2", className)} aria-label="Kdo s objednávkou pracoval">
      {acts.length > shown.length && <li className="text-[11px] text-muted-foreground">…</li>}
      {shown.map((a, i) => (
        <li key={`${a.kind}-${a.at}-${i}`} className="flex min-w-0 items-center gap-2">
          {i > 0 && <span className="text-muted-foreground/60" aria-hidden>→</span>}
          <ActorStamp verb={a.verb} by={a.by} at={a.at} />
        </li>
      ))}
    </ol>
  );
}
