"use client";

import * as React from "react";
import Link from "next/link";
import { Factory, ShoppingCart, FilePlus2, Trophy, ArrowRight, Sparkles, ListChecks } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JobDetail } from "@/lib/jobs/types";
import type { JobPurchasing, PurchaseOrderView, SupplierQuoteView } from "@/lib/jobs/purchasing-types";
import { useJobDetail } from "@/components/jobs/detail/detail-context";
import { formatMoney, isoToday, longDate } from "@/components/jobs/detail/detail-helpers";
import { MarginHeroCard } from "./margin-hero";
import { SupplierQuotesSection } from "./supplier-quotes";
import { SupplierQuoteDialog } from "./supplier-quote-dialog";
import { IssueOrderDialog } from "./issue-order-dialog";
import { PurchaseOrderCard } from "./purchase-orders-section";
import { EditPurchaseOrderDialog, SendPurchaseOrderDialog } from "./purchase-order-dialogs";
import { SectionTitle } from "./ui-bits";
import { ownerAssignedStamp } from "./purchasing-model";
import { JobSupplierInvoices } from "@/components/supplier-invoices/job-supplier-invoices";

type SendTarget = { id: string; number: string; supplierName: string | null; fileId: string | null };

/**
 * Záložka „Nákup & marže" karty zakázky: marže a provize nahoře, nabídky
 * dodavatelů (vítězná), jedním klikem „Vystavit objednávku" (z vítězné nabídky
 * nebo ze zakázky) → PDF → e-mail dodavateli, a přehled objednávek dodavatelům.
 * Jen pro role s právem „margins". Marži i provizi počítá DB.
 */
export function PurchasingTab({ job, data }: { job: JobDetail; data: JobPurchasing }) {
  const { notify, refresh } = useJobDetail();
  const today = isoToday();
  const [quoteDialog, setQuoteDialog] = React.useState<{ open: boolean; quote: SupplierQuoteView | null }>({ open: false, quote: null });
  const [issueOpen, setIssueOpen] = React.useState(false);
  const [sendTarget, setSendTarget] = React.useState<SendTarget | null>(null);
  const [editOrder, setEditOrder] = React.useState<PurchaseOrderView | null>(null);

  const ownerAssigned = React.useMemo(() => ownerAssignedStamp(job.events), [job.events]);
  const winner = data.supplierQuotes.find((q) => q.selected) ?? null;
  const active = data.purchaseOrders.filter((p) => p.status !== "zrusena");
  const orders = React.useMemo(
    () => [...data.purchaseOrders].sort((a, b) => Number(a.status === "zrusena") - Number(b.status === "zrusena") || b.createdAt.localeCompare(a.createdAt)),
    [data.purchaseOrders],
  );
  const otherCost = (exclude?: string) =>
    active.filter((p) => p.id !== exclude).reduce((s, p) => s + (Number.isFinite(p.total) ? p.total : 0), 0);

  return (
    <div className="space-y-6">
      <MarginHeroCard job={job} data={data} ownerAssigned={ownerAssigned} />

      {/* Další krok: vystavit objednávku */}
      <section className="flex flex-col gap-3 rounded-2xl border border-lime-200/80 bg-gradient-to-r from-lime-50 via-card to-card p-4 shadow-sm sm:flex-row sm:items-center dark:border-lime-500/25 dark:from-lime-500/10">
        <span className="hidden h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-lime-600 text-white shadow-md shadow-lime-600/30 sm:flex">
          <ShoppingCart className="h-6 w-6" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="font-semibold">
            {active.length
              ? active.length === 1 ? "Vystavena 1 objednávka dodavateli"
                : active.length < 5 ? `Vystaveny ${active.length} objednávky dodavatelům` : `Vystaveno ${active.length} objednávek dodavatelům`
              : "Objednávka dodavateli"}
          </p>
          <p className="text-sm text-muted-foreground">
            {winner ? (
              <>
                <Trophy className="mr-1 inline h-3.5 w-3.5 text-green-600" />
                Vítěz <strong className="text-foreground">{winner.supplierName}</strong>
                {winner.total !== null ? <> · {formatMoney(winner.total, winner.currency)}</> : null}
                {winner.deliveryDate ? <> · dodání {longDate(winner.deliveryDate)}</> : null}
                {" — objednávka za Mnástrojárnu se vyplní z vítězné nabídky."}
              </>
            ) : data.supplierQuotes.length ? (
              "Vyber vítěznou nabídku — nebo vystav objednávku rovnou z položek zakázky."
            ) : (
              <>
                <Sparkles className="mr-1 inline h-3.5 w-3.5 text-violet-500" />
                Objednávka se vyplní z položek zakázky (nákupní ceny, termín, naše dodací adresa).
              </>
            )}
          </p>
        </div>
        <Button size="lg" variant={active.length ? "outline" : "success"} className="h-12 shrink-0 text-base shadow-sm" onClick={() => setIssueOpen(true)}>
          <ShoppingCart className="h-5 w-5" /> {active.length ? "Vystavit další objednávku" : "Vystavit objednávku"}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </section>

      {/* Nabídky dodavatelů */}
      <section className="space-y-3">
        <SectionTitle
          icon={Factory}
          tone="bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
          title="Nabídky dodavatelů"
          count={data.supplierQuotes.length}
          subtitle="Vítězná nabídka určí dodavatele, plánovaný nákup a termín."
          actions={
            data.supplierQuotes.length > 0 && (
              <Button size="sm" variant="outline" onClick={() => setQuoteDialog({ open: true, quote: null })}>
                <FilePlus2 className="h-4 w-4" /> Nabídka dodavatele
              </Button>
            )
          }
        />
        <SupplierQuotesSection
          quotes={data.supplierQuotes}
          today={today}
          pendingCaptured={data.pendingCaptured}
          onAdd={() => setQuoteDialog({ open: true, quote: null })}
          onEdit={(quote) => setQuoteDialog({ open: true, quote })}
        />
      </section>

      {/* Objednávky dodavatelům */}
      <section className="space-y-3">
        <SectionTitle
          icon={ListChecks}
          tone="bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300"
          title="Objednávky dodavatelům"
          count={data.purchaseOrders.length}
          subtitle={active.length ? `Nákup celkem ${formatMoney(data.totals.purchaseOrdersTotal, job.currency)} bez DPH (bez zrušených).` : "Naše objednávky za Mnástrojárnu — PDF a odeslání e-mailem."}
          actions={
            <Button asChild size="sm" variant="ghost">
              <Link href="/purchasing">Všechny objednávky <ArrowRight className="h-3.5 w-3.5" /></Link>
            </Button>
          }
        />
        {orders.length === 0 ? (
          <p className="rounded-xl border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
            Zatím žádná objednávka dodavateli — vystav ji tlačítkem výše, vyplní se sama.
          </p>
        ) : (
          <div className="grid gap-3 lg:grid-cols-2">
            {orders.map((po) => (
              <PurchaseOrderCard key={po.id} order={po} today={today} notify={notify} onChanged={refresh} onEdit={() => setEditOrder(po)} />
            ))}
          </div>
        )}
      </section>

      {/* Faktury dodavatelů (jen kdo je vidí — načítá se akcí s kontrolou práv) */}
      <JobSupplierInvoices jobId={job.id} currency={job.currency} refreshKey={data.totals.cost} />

      <SupplierQuoteDialog
        open={quoteDialog.open}
        onOpenChange={(open) => setQuoteDialog((d) => ({ ...d, open }))}
        job={job}
        quote={quoteDialog.quote}
      />
      <IssueOrderDialog
        open={issueOpen}
        onOpenChange={setIssueOpen}
        job={job}
        quotes={data.supplierQuotes}
        otherCost={otherCost()}
        onSend={(o) => setSendTarget(o)}
      />
      <SendPurchaseOrderDialog
        open={Boolean(sendTarget)}
        onOpenChange={(o) => !o && setSendTarget(null)}
        order={sendTarget}
        notify={notify}
        onSent={refresh}
      />
      <EditPurchaseOrderDialog
        open={Boolean(editOrder)}
        onOpenChange={(o) => !o && setEditOrder(null)}
        order={editOrder}
        notify={notify}
        onDone={refresh}
        margin={editOrder ? { revenue: job.value, otherCost: otherCost(editOrder.id) } : null}
      />
    </div>
  );
}
