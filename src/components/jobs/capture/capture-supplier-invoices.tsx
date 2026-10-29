"use client";

import * as React from "react";
import { ArrowRight, Eye, EyeOff, ReceiptText, Sparkles } from "lucide-react";
import { TypeChip } from "@/components/jobs/capture/capture-parts";
import { CapturePages } from "@/components/jobs/capture/capture-pages";
import { viewerPages, type LocalUrls } from "@/components/jobs/capture/capture-sort";
import type { BatchReviewModel, BatchSortModel } from "@/lib/jobs/capture-batch-types";
import { cn } from "@/lib/utils";

function money(n: number | null, currency: string): string {
  if (n === null || !Number.isFinite(n)) return "";
  return n.toLocaleString("cs-CZ", { style: "currency", currency: /^[A-Z]{3}$/.test(currency) ? currency : "CZK", maximumFractionDigits: 2 });
}

/**
 * Kontrola dávky: faktury dodavatelů jdou MIMO zakázky do Faktur dodavatelů. Bez práva na faktury jen
 * „Faktura dodavatele → Faktury dodavatelů" (bez dodavatele a částek); super admin vidí dodavatele, číslo a částku.
 */
export function CaptureSupplierInvoices({ review, batch, local }: { review: BatchReviewModel; batch: BatchSortModel; local: LocalUrls }) {
  const docs = review.supplierInvoices ?? [];
  const [open, setOpen] = React.useState<Set<string>>(new Set());
  if (!docs.length) return null;
  return (
    <section aria-label="Faktury dodavatelů" data-testid="capture-supplier-invoices" className="space-y-2">
      <p className="flex items-center gap-1.5 px-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        <ReceiptText className="h-3.5 w-3.5 text-emerald-600" /> Faktury dodavatelů — mimo zakázky
      </p>
      <ul className="space-y-2 sm:pl-3">
        {docs.map((d) => {
          const shown = open.has(d.docId);
          const pages = viewerPages(batch, d.pageIds, local);
          const det = d.details;
          return (
            <li key={d.docId}>
              <div data-testid="capture-supplier-invoice" data-doc-id={d.docId} className="relative overflow-hidden rounded-2xl border border-emerald-200 bg-emerald-50/60 shadow-sm dark:border-emerald-500/30 dark:bg-emerald-500/10">
                <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-emerald-500" />
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 py-2.5 pl-3.5 pr-3">
                  <TypeChip docType="faktura_dodavatel" label="Faktura dodavatele" />
                  <ArrowRight className="h-4 w-4 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
                  <span className="text-sm font-semibold text-emerald-900 dark:text-emerald-100">Faktury dodavatelů</span>
                  {d.aiUsed && <Sparkles className="h-3.5 w-3.5 text-fuchsia-500" aria-label="přečetla AI" />}
                  {pages.length > 0 && (
                    <button
                      type="button"
                      onClick={() => setOpen((prev) => { const n = new Set(prev); if (n.has(d.docId)) n.delete(d.docId); else n.add(d.docId); return n; })}
                      className="ml-auto inline-flex min-h-9 items-center gap-1.5 rounded-full px-2 text-xs font-medium text-muted-foreground hover:bg-accent hover:text-foreground"
                    >
                      {shown ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />} {shown ? "Skrýt" : "Ukázat"}
                    </button>
                  )}
                </div>
                <p className={cn("px-3.5 pb-2.5 text-xs", det ? "text-foreground" : "text-emerald-900/80 dark:text-emerald-100/80")}>
                  {det ? (
                    <>
                      <strong>{det.supplierName || "Dodavatel nepřečten"}</strong>
                      {det.documentNumber ? <> · č. {det.documentNumber}</> : null}
                      {det.totalNet !== null ? <> · {money(det.totalNet, det.currency)} bez DPH</> : null}
                      {det.items ? <> · {det.items} {det.items === 1 ? "položka" : det.items < 5 ? "položky" : "položek"}</> : null}
                      <span className="block text-muted-foreground">Nezakládá zakázku ani dokument zakázky — rozdělení na zakázky a režii zkontroluješ ve Fakturách dodavatelů.</span>
                    </>
                  ) : (
                    "Uloží se do Faktur dodavatelů — zpracuje ji super admin. K zakázce se nepřikládá."
                  )}
                </p>
                {shown && pages.length > 0 && (
                  <div className="border-t px-3 pb-3 pt-2.5">
                    <CapturePages pages={pages} className="h-[40vh]" />
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
