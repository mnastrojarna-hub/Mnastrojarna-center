"use client";

import * as React from "react";
import {
  Loader2, ShoppingCart, FileSearch, CheckCircle2, Download, FileText, Send, Factory, RotateCcw, ArrowRight, Info,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { draftPurchaseOrder, issuePurchaseOrder, regeneratePurchaseOrderPdf } from "@/app/actions/purchasing";
import { setJobStage } from "@/app/actions/jobs";
import { REQUIRED_DATE_SOURCE_LABELS } from "@/lib/jobs/purchasing";
import { STAGES } from "@/lib/jobs/stages";
import type { JobStage } from "@/lib/supabase/database.types";
import type { JobDetail } from "@/lib/jobs/types";
import type { RequiredDateSource, SupplierQuoteView } from "@/lib/jobs/purchasing-types";
import { useJobDetail } from "@/components/jobs/detail/detail-context";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { formatMoney, isoToday } from "@/components/jobs/detail/detail-helpers";
import { cn } from "@/lib/utils";
import { PurchaseOrderForm } from "./purchase-order-form";
import { FULLSCREEN_DIALOG, openPdfPreview } from "./ui-bits";
import {
  draftsFromJobItems, purchaseDraftsTotal, purchaseOrderFormFromDraft, purchaseOrderFormToInput, validatePurchaseOrderForm,
  type PurchaseOrderFormState,
} from "./purchasing-model";

type Step = "loading" | "form" | "issuing" | "done";

interface Issued {
  id: string;
  number: string;
  fileId: string | null;
  pdfError?: string;
  hint?: string;
  suggestStage?: JobStage | null;
  total: number;
  supplierName: string;
}

/**
 * „Vystavit objednávku": návrh z vítězné nabídky dodavatele (jinak ze zakázky) →
 * kontrola a úpravy (dodavatel, položky, termín, adresa, podmínky) s živou marží →
 * náhled PDF → vystavení (číslo OV, PDF do dokumentů) → odeslání dodavateli.
 */
export function IssueOrderDialog({
  open, onOpenChange, job, quotes, otherCost, onSend,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobDetail;
  quotes: SupplierQuoteView[];
  /** Σ ostatních aktivních objednávek dodavatelům (pro přepočet marže). */
  otherCost: number;
  /** Otevřít odeslání vystavené objednávky e-mailem. */
  onSend: (order: { id: string; number: string; supplierName: string; fileId: string | null }) => void;
}) {
  const { options, notify, refresh } = useJobDetail();
  const [step, setStep] = React.useState<Step>("loading");
  const [error, setError] = React.useState<string | null>(null);
  const [form, setForm] = React.useState<PurchaseOrderFormState | null>(null);
  const [warnings, setWarnings] = React.useState<string[]>([]);
  const [dateSource, setDateSource] = React.useState<RequiredDateSource>(null);
  const [supplierLabel, setSupplierLabel] = React.useState<string | null>(null);
  const [quoteId, setQuoteId] = React.useState<string | null>(null);
  const [issued, setIssued] = React.useState<Issued | null>(null);
  const [busy, setBusy] = React.useState<null | "preview" | "stage" | "pdf">(null);
  const run = React.useRef(0);

  const winner = quotes.find((q) => q.selected) ?? null;
  const supplierOptions = React.useMemo(() => options.suppliers.map((s) => ({ value: s.id, label: s.name })), [options.suppliers]);

  const load = React.useCallback(async (supplierQuoteId: string | null) => {
    const token = ++run.current;
    setStep("loading");
    setError(null);
    try {
      const res = await draftPurchaseOrder(job.id, supplierQuoteId ? { supplierQuoteId } : {});
      if (token !== run.current) return;
      if (!res.ok || !res.draft) {
        setError(res.error ?? "Návrh objednávky se nepodařilo připravit.");
        setForm({
          supplierId: job.supplier?.id ?? null, supplierName: "", supplierQuoteId, orderDate: isoToday(), requiredDate: "",
          currency: job.currency, deliveryTerms: "", paymentTerms: "", deliveryAddress: "", note: "",
          items: draftsFromJobItems(job.items),
        });
        setSupplierLabel(job.supplier?.name ?? null);
        setWarnings([]);
        setDateSource(null);
      } else {
        const d = res.draft;
        setForm(purchaseOrderFormFromDraft(d));
        setWarnings(d.warnings);
        setDateSource(d.requiredDateSource);
        setSupplierLabel(d.supplier?.name ?? null);
      }
      setStep("form");
    } catch {
      if (token !== run.current) return;
      setError("Spojení se nepovedlo — zkus to znovu.");
      setStep("form");
    }
  }, [job]);

  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setIssued(null);
      setForm(null);
      setQuoteId(winner?.id ?? null);
      setStep("loading");
    }
  }
  const loadRef = React.useRef(load);
  loadRef.current = load;
  const started = React.useRef(false);
  React.useEffect(() => {
    if (!open) {
      started.current = false;
      run.current += 1;
      return;
    }
    if (started.current) return; // StrictMode spouští efekt dvakrát
    started.current = true;
    void loadRef.current(winner?.id ?? null);
  }, [open, winner?.id]);

  function pickQuote(id: string) {
    if (id === quoteId || step !== "form") return;
    setQuoteId(id);
    void load(id);
  }

  async function preview() {
    if (!form) return;
    const bad = validatePurchaseOrderForm(form);
    if (bad) return setError(bad);
    setBusy("preview");
    setError(null);
    const err = await openPdfPreview("/api/pdf/purchase-order/draft", { jobId: job.id, draft: purchaseOrderFormToInput(form) });
    setBusy(null);
    if (err) setError(err);
  }

  async function issue(e: React.FormEvent) {
    e.preventDefault();
    if (!form) return;
    const bad = validatePurchaseOrderForm(form);
    if (bad) return setError(bad);
    setStep("issuing");
    setError(null);
    try {
      const res = await issuePurchaseOrder(job.id, purchaseOrderFormToInput(form));
      if (!res.ok || !res.id || !res.number) {
        setError(res.error ?? "Objednávku se nepodařilo vystavit.");
        setStep("form");
        return;
      }
      const supplierName = (form.supplierId ? options.suppliers.find((s) => s.id === form.supplierId)?.name : null) ?? supplierLabel ?? form.supplierName;
      setIssued({
        id: res.id, number: res.number, fileId: res.fileId ?? null, pdfError: res.pdfError, hint: res.hint,
        suggestStage: res.suggestStage ?? null, total: purchaseDraftsTotal(form.items).total, supplierName: supplierName || "dodavatel",
      });
      setStep("done");
      notify("success", `Objednávka ${res.number} vystavena — marže a provize se přepočítaly.`);
      refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
      setStep("form");
    }
  }

  async function switchStage(stage: JobStage) {
    setBusy("stage");
    try {
      const res = await setJobStage(job.id, stage);
      if (!res.ok) notify("error", res.error ?? "Stav se nepodařilo změnit.");
      else {
        notify("success", `Zakázka je ve stavu ${STAGES[stage].label}.`);
        setIssued((i) => (i ? { ...i, suggestStage: null, hint: undefined } : i));
        refresh();
      }
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  async function regenerate() {
    if (!issued) return;
    setBusy("pdf");
    try {
      const res = await regeneratePurchaseOrderPdf(issued.id);
      if (!res.ok || !res.fileId) notify("error", res.error ?? "PDF se nepodařilo vytvořit.");
      else {
        setIssued({ ...issued, fileId: res.fileId, pdfError: undefined });
        notify("success", "PDF objednávky vytvořeno.");
        refresh();
      }
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  const sourceHint = dateSource ? REQUIRED_DATE_SOURCE_LABELS[dateSource] : null;
  const locked = step === "issuing";

  return (
    <Dialog open={open} onOpenChange={(o) => !locked && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className={`${FULLSCREEN_DIALOG} sm:max-w-5xl`}>
        <DialogHead
          icon={step === "done" ? CheckCircle2 : ShoppingCart}
          tone={step === "done" ? "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300" : "bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300"}
          title={step === "done" && issued ? `Objednávka ${issued.number} vystavena` : "Vystavit objednávku dodavateli"}
          subtitle={step === "done" ? "PDF je v Dokumentech zakázky. Pošli ho dodavateli." : "Vše je předvyplněné z vítězné nabídky a zakázky — zkontroluj a vystav."}
        />

        {step === "loading" && (
          <div className="flex flex-col items-center gap-3 py-16 text-center text-sm text-muted-foreground">
            <Loader2 className="h-7 w-7 animate-spin text-lime-600" />
            Připravuji objednávku z {winner ? `vítězné nabídky ${winner.supplierName}` : "zakázky"}…
          </div>
        )}

        {step === "done" && issued && (
          <div className="space-y-5 p-4 sm:p-6">
            <div className="flex flex-col items-center gap-2 rounded-2xl border border-green-200 bg-gradient-to-br from-green-50 to-card px-4 py-6 text-center dark:border-green-500/30 dark:from-green-500/10">
              <span className="flex h-14 w-14 items-center justify-center rounded-full bg-green-600 text-white shadow-lg shadow-green-600/30">
                <CheckCircle2 className="h-8 w-8" />
              </span>
              <p className="font-mono text-2xl font-bold">{issued.number}</p>
              <p className="text-sm text-muted-foreground">
                <Factory className="mr-1 inline h-3.5 w-3.5 text-orange-600" />
                {issued.supplierName} · <strong className="tabular-nums text-foreground">{formatMoney(issued.total, form?.currency ?? job.currency)}</strong> bez DPH
              </p>
            </div>

            {issued.pdfError && (
              <div className="flex flex-col gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-900 sm:flex-row sm:items-center dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
                <span className="flex-1">PDF se nepodařilo uložit: {issued.pdfError}</span>
                <Button size="sm" variant="outline" onClick={() => void regenerate()} disabled={busy !== null}>
                  {busy === "pdf" ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />} Vytvořit PDF znovu
                </Button>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-3">
              <Button asChild variant="outline" size="lg" className="h-12">
                <a href={`/api/pdf/purchase-order/${issued.id}?download=1`}>
                  <Download className="h-4 w-4" /> Stáhnout PDF
                </a>
              </Button>
              <Button asChild variant="outline" size="lg" className="h-12">
                <a href={issued.fileId ? `/api/jobs/files/${issued.fileId}` : `/api/pdf/purchase-order/${issued.id}`} target="_blank" rel="noopener noreferrer">
                  <FileText className="h-4 w-4" /> Otevřít PDF
                </a>
              </Button>
              <Button
                variant="send"
                size="lg"
                className="h-12"
                onClick={() => {
                  onOpenChange(false);
                  onSend({ id: issued.id, number: issued.number, supplierName: issued.supplierName, fileId: issued.fileId });
                }}
              >
                <Send className="h-4 w-4" /> Poslat dodavateli e-mailem
              </Button>
            </div>

            {(issued.hint || issued.suggestStage) && (
              <div className="flex flex-col gap-2 rounded-xl border border-sky-200 bg-sky-50 px-3 py-3 text-sm text-sky-950 sm:flex-row sm:items-center dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100">
                <Info className="h-4 w-4 shrink-0 text-sky-600" />
                <span className="flex-1">{issued.hint}</span>
                {issued.suggestStage && (
                  <Button size="sm" variant="success" onClick={() => void switchStage(issued.suggestStage as JobStage)} disabled={busy !== null}>
                    {busy === "stage" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowRight className="h-4 w-4" />}
                    Přepnout zakázku do {STAGES[issued.suggestStage].label}
                  </Button>
                )}
              </div>
            )}

            <div className="flex justify-end">
              <Button variant="ghost" onClick={() => onOpenChange(false)}>Hotovo</Button>
            </div>
          </div>
        )}

        {(step === "form" || step === "issuing") && (
          <form onSubmit={issue} className="space-y-5 p-4 sm:p-5" noValidate>
            <ErrorBox error={error} />
            {quotes.length > 1 && (
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">Podklad objednávky</p>
                <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin">
                  {quotes.map((q) => (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => pickQuote(q.id)}
                      aria-pressed={q.id === quoteId}
                      className={cn(
                        "flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                        q.id === quoteId ? "border-lime-500 bg-lime-500 text-white shadow-sm" : "hover:bg-accent",
                      )}
                    >
                      {q.selected && <CheckCircle2 className="h-3.5 w-3.5" />}
                      {q.supplierName || "Dodavatel"}
                      {q.total !== null && <span className="tabular-nums opacity-80">· {formatMoney(q.total, q.currency)}</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {form && (
              <PurchaseOrderForm
                form={form}
                onChange={(f) => {
                  setForm(f);
                  setError(null);
                }}
                supplierOptions={supplierOptions}
                supplierLabel={supplierLabel}
                warnings={warnings}
                requiredDateHint={sourceHint}
                margin={{ revenue: job.value, otherCost }}
                currency={form.currency || job.currency}
              />
            )}
            <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col gap-2 border-t bg-popover/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:-mb-5 sm:flex-row sm:items-center sm:justify-end sm:px-5">
              <span className="mr-auto text-sm text-muted-foreground">
                Celkem bez DPH{" "}
                <strong className="text-base tabular-nums text-foreground">{formatMoney(form ? purchaseDraftsTotal(form.items).total : 0, form?.currency ?? job.currency)}</strong>
              </span>
              <div className="flex flex-col-reverse gap-2 sm:flex-row">
                <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={locked}>Zrušit</Button>
                <Button type="button" variant="outline" onClick={() => void preview()} disabled={locked || busy !== null || !form}>
                  {busy === "preview" ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileSearch className="h-4 w-4" />} Náhled PDF
                </Button>
                <Button type="submit" variant="success" disabled={locked || !form}>
                  {step === "issuing" ? <Loader2 className="h-4 w-4 animate-spin" /> : <ShoppingCart className="h-4 w-4" />}
                  Vystavit objednávku
                </Button>
              </div>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
