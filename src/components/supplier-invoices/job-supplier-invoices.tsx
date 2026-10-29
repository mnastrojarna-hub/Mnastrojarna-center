"use client";

import * as React from "react";
import Link from "next/link";
import { ArrowRight, Receipt, Sparkles } from "lucide-react";
import { useAccess } from "@/components/access-provider";
import { jobSupplierInvoices } from "@/app/actions/supplier-invoices";
import { formatMoney, dateText } from "@/components/supplier-invoices/format";
import type { JobInvoiceCosts } from "@/lib/supplier-invoices/types";
import type { SupplierInvoiceVisibility } from "@/lib/supplier-invoices/access";
import { cn } from "@/lib/utils";

/**
 * Nákup zakázky → „Faktury dodavatelů": řádky faktur přiřazené k zakázce (skutečný nákup). Jen kdo faktury
 * vidí (zatím super admin) — data se načítají akcí s kontrolou práv, jinak blok vůbec nevznikne.
 */
export function JobSupplierInvoices({ jobId, currency = "CZK", refreshKey }: { jobId: string; currency?: string; refreshKey?: unknown }) {
  const access = useAccess();
  const allowed = access.can("supplier_invoices") && (access.can("supplier_invoices_paid") || access.can("margins"));
  const [data, setData] = React.useState<JobInvoiceCosts | null>(null);
  const [visibility, setVisibility] = React.useState<SupplierInvoiceVisibility>("super_admin");
  const [loaded, setLoaded] = React.useState(false);

  React.useEffect(() => {
    if (!allowed) return;
    let cancel = false;
    void jobSupplierInvoices(jobId).then((res) => {
      if (cancel) return;
      setData(res.ok ? res.data : null);
      if (res.ok) setVisibility(res.visibility);
      setLoaded(true);
    });
    return () => { cancel = true; };
  }, [allowed, jobId, refreshKey]);

  if (!allowed || !loaded || !data) return null;
  const rows = data.allocations;
  return (
    <section className="space-y-3" data-testid="job-supplier-invoices">
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"><Receipt className="h-4 w-4" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="flex items-center gap-2 font-semibold">Faktury dodavatelů <span className="rounded-full bg-muted px-2 text-xs tabular-nums">{rows.length}</span></h3>
          <p className="text-xs text-muted-foreground">
            Skutečný nákup z faktur — objednávka vyfakturovaná celá se počítá fakturou, dílčí faktura částku objednávky nesníží.
            {visibility === "all" ? " Vidí všichni s nákupními cenami, upravuje super admin." : " Vidí jen super admin."}
          </p>
        </div>
        <Link href={`/supplier-invoices?zakazka=${jobId}`} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">Všechny <ArrowRight className="h-3.5 w-3.5" /></Link>
      </div>
      {rows.length === 0 ? (
        <p className="rounded-xl border border-dashed px-4 py-4 text-center text-sm text-muted-foreground">K zakázce zatím není přiřazená žádná faktura dodavatele.</p>
      ) : (
        <ul className="divide-y rounded-2xl border bg-card">
          {rows.map((a) => (
            <li key={a.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm" data-testid="job-invoice-row">
              <div className="min-w-0 flex-1">
                <Link href={`/supplier-invoices/${a.invoiceId}`} className="font-medium hover:underline">
                  {a.supplierName ?? "Dodavatel"} · <span className="font-mono">{a.invoiceNumber ?? "bez čísla"}</span>
                </Link>
                <p className="truncate text-xs text-muted-foreground">
                  {[a.itemText, a.purchaseOrderNumber && `obj. ${a.purchaseOrderNumber}`, a.orderItemLabel && `položka ${a.orderItemLabel}`, a.issueDate && dateText(a.issueDate)].filter(Boolean).join(" · ")}
                </p>
              </div>
              {!a.confirmed && <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia-100 px-2 py-0.5 text-xs font-medium text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300"><Sparkles className="h-3 w-3" /> návrh — nepočítá se</span>}
              <span className={cn("shrink-0 text-right font-semibold tabular-nums", !a.confirmed && "text-muted-foreground line-through decoration-dotted")}>
                {formatMoney(a.amount, a.currency)}
                {a.currency !== "CZK" && (
                  <span className={cn("block text-[11px] font-normal", a.amountCzk === null ? "font-medium text-amber-700 dark:text-amber-300" : "text-muted-foreground")}>
                    {a.amountCzk === null ? "chybí kurz — nepočítá se" : formatMoney(a.amountCzk)}
                  </span>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}
      {rows.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span>Potvrzeno <strong className="text-foreground" data-testid="job-invoices-total">{formatMoney(data.confirmedTotal, currency)}</strong></span>
          {data.pendingTotal ? <span>čeká na potvrzení {formatMoney(data.pendingTotal, currency)}</span> : null}
          {data.invoicedPurchaseOrders.map((p) => (
            <span key={p.id} data-testid="job-invoice-po">
              objednávka {p.number ?? "—"}: {formatMoney(p.poTotal, currency)} · fakturováno {formatMoney(p.invoiced, currency)}
              {p.complete ? " (celá)" : " (dílčí)"} → do nákladu {formatMoney(p.counted, currency)}
            </span>
          ))}
          {data.missingRate && <span className="font-medium text-amber-700 dark:text-amber-300">Faktura v cizí měně bez kurzu — náklad zakázky je neúplný.</span>}
        </div>
      )}
    </section>
  );
}
