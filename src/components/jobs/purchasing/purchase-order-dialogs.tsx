"use client";

import * as React from "react";
import { Send, Loader2, Paperclip, FileText, ExternalLink, BadgeCheck, CalendarCheck, Hash, Pencil } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { draftPurchaseOrderEmail, sendPurchaseOrder, updatePurchaseOrder } from "@/app/actions/purchasing";
import type { PurchaseOrderView } from "@/lib/jobs/purchasing-types";
import { parseEmailList } from "@/lib/jobs/purchasing";
import type { Notify } from "@/components/jobs/detail/toast";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { MailFields, type MailDraft } from "@/components/flow/document-send-dialog";
import { isoToday } from "@/components/jobs/detail/detail-helpers";
import { PurchaseOrderForm } from "./purchase-order-form";
import { FULLSCREEN_DIALOG, Field } from "./ui-bits";
import {
  purchaseDraftsToInput, purchaseOrderFormFromView, validatePurchaseOrderForm, type PurchaseOrderFormState,
} from "./purchasing-model";
import { PrintButton } from "@/components/print/print-button";

type Step = "preparing" | "form" | "sending";

/**
 * Odeslání objednávky dodavateli: předvyplněný e-mail (komu / kopie / předmět /
 * text — vše jde upravit), PDF objednávky v příloze, po odeslání stav „Odeslána".
 */
export function SendPurchaseOrderDialog({
  open, onOpenChange, order, notify, onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: { id: string; number: string; supplierName?: string | null; fileId?: string | null } | null;
  notify: Notify;
  onSent: () => void;
}) {
  const [step, setStep] = React.useState<Step>("preparing");
  const [error, setError] = React.useState<string | null>(null);
  const [mail, setMail] = React.useState<MailDraft>({ to: "", cc: "", subject: "", body: "" });
  const [attachment, setAttachment] = React.useState<string | null>(null);
  /** Dodavatel objednávky — jeho kontakty a e-maily podle účelu nahoře v našeptávači. */
  const [supplierId, setSupplierId] = React.useState<string | null>(null);
  const run = React.useRef(0);
  const orderId = order?.id ?? null;

  React.useEffect(() => {
    if (!open || !orderId) {
      run.current += 1;
      return;
    }
    const token = ++run.current;
    setStep("preparing");
    setError(null);
    setAttachment(null);
    setMail({ to: "", cc: "", subject: "", body: "" });
    void (async () => {
      try {
        const res = await draftPurchaseOrderEmail(orderId);
        if (token !== run.current) return;
        if (!res.ok) setError(res.error ?? "Návrh e-mailu se nepodařilo připravit.");
        else {
          setMail({ to: res.to ?? "", cc: res.cc ?? "", subject: res.subject ?? "", body: res.body ?? "", reason: res.to ? res.recipientReason : undefined });
          setSupplierId(res.supplierId ?? null);
          setAttachment(res.attachmentName ?? null);
        }
      } catch {
        if (token === run.current) setError("Spojení se nepovedlo — zkus to znovu.");
      }
      if (token === run.current) setStep("form");
    })();
  }, [open, orderId]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!order) return;
    const to = parseEmailList(mail.to);
    if (!to || !to.length) return setError("Zadej platný e-mail dodavatele.");
    if (!parseEmailList(mail.cc)) return setError("Neplatná adresa v kopii.");
    if (!mail.subject.trim()) return setError("Doplň předmět e-mailu.");
    if (!mail.body.trim()) return setError("Doplň text e-mailu.");
    setStep("sending");
    setError(null);
    try {
      const res = await sendPurchaseOrder(order.id, { to: mail.to, cc: mail.cc || undefined, subject: mail.subject, body: mail.body });
      if (!res.ok) {
        setError(res.error ?? "E-mail se nepodařilo odeslat.");
        setStep("form");
        return;
      }
      notify("success", `Objednávka ${order.number} odeslána na ${to.join(", ")}.`);
      onOpenChange(false);
      onSent();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
      setStep("form");
    }
  }

  const pdfHref = order ? (order.fileId ? `/api/jobs/files/${order.fileId}` : `/api/pdf/purchase-order/${order.id}`) : "#";

  return (
    <Dialog open={open} onOpenChange={(o) => step !== "sending" && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className={`${FULLSCREEN_DIALOG} sm:max-w-2xl`}>
        <DialogHead
          icon={Send}
          tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
          title={`Poslat objednávku ${order?.number ?? ""} dodavateli`}
          subtitle={`E-mail odejde z tvé schránky s PDF v příloze${order?.supplierName ? ` — ${order.supplierName}` : ""}.`}
        />
        <form onSubmit={send} className="space-y-4 p-4 sm:p-5" noValidate>
          <ErrorBox error={error} />
          {step === "preparing" ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-red-500" />
              Připravuji e-mail s objednávkou…
            </div>
          ) : (
            <>
              <div className="flex items-center gap-1.5">
                <a
                  href={pdfHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg border bg-red-50/60 px-3 py-2 text-sm hover:brightness-95 dark:bg-red-500/10"
                >
                  <Paperclip className="h-4 w-4 text-red-600" />
                  <FileText className="h-4 w-4 text-red-600" />
                  <span className="min-w-0 flex-1 truncate font-medium">{attachment ?? `Objednávka ${order?.number ?? ""}.pdf`}</span>
                  <span className="inline-flex items-center gap-1 text-xs text-red-700 dark:text-red-300">Náhled <ExternalLink className="h-3 w-3" /></span>
                </a>
                {order && <PrintButton href={pdfHref} filename={attachment ?? "objednavka.pdf"} label="Tisknout objednávku" variant="outline" className="h-10 w-10 shrink-0" />}
              </div>
              <MailFields mail={mail} onChange={setMail} context={supplierId ? { supplierId } : null} idPrefix="po-mail" />
            </>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={step === "sending"}>Zrušit</Button>
            <Button type="submit" variant="send" disabled={step !== "form"}>
              {step === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Odeslat dodavateli
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Dodavatel potvrdil objednávku: potvrzený termín + číslo potvrzení (termín se propíše do zakázky). */
export function ConfirmPurchaseOrderDialog({
  open, onOpenChange, order, notify, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Pick<PurchaseOrderView, "id" | "number" | "requiredDate" | "confirmedDate" | "supplierReference"> | null;
  notify: Notify;
  onDone: () => void;
}) {
  const [date, setDate] = React.useState("");
  const [ref, setRef] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDate(order?.confirmedDate ?? order?.requiredDate ?? "");
      setRef(order?.supplierReference ?? "");
      setError(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!order) return;
    setBusy(true);
    setError(null);
    try {
      const res = await updatePurchaseOrder(order.id, { status: "potvrzena", confirmedDate: date, supplierReference: ref });
      if (!res.ok) {
        setError(res.error ?? "Potvrzení se nepodařilo uložit.");
        return;
      }
      notify("success", `Objednávka ${order.number} potvrzena${date ? ` — dodání ${date.split("-").reverse().map(Number).join(". ")}` : ""}.`);
      if (res.hint) notify("info", res.hint);
      onOpenChange(false);
      onDone();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className="w-[calc(100%-1.5rem)] sm:max-w-md">
        <DialogHead
          icon={BadgeCheck}
          tone="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
          title={`Dodavatel potvrdil ${order?.number ?? ""}`}
          subtitle="Potvrzený termín se zapíše do zakázky jako slib dodavatele."
        />
        <form onSubmit={submit} className="space-y-4 p-5" noValidate>
          <ErrorBox error={error} />
          <Field label="Potvrzený termín dodání" icon={CalendarCheck} iconClass="text-indigo-500">
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} min={isoToday().slice(0, 4) + "-01-01"} autoFocus />
          </Field>
          <Field label="Číslo potvrzení u dodavatele (nepovinné)" icon={Hash} iconClass="text-indigo-500">
            <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder="např. AB-2026-118" />
          </Field>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Zpět</Button>
            <Button type="submit" variant="success" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Uložit potvrzení
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Úprava objednávky, dokud neodešla (položky, termíny, podmínky). PDF se přegeneruje samo. */
export function EditPurchaseOrderDialog({
  open, onOpenChange, order, notify, onDone, margin,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: PurchaseOrderView | null;
  notify: Notify;
  onDone: () => void;
  margin?: { revenue: number | null; otherCost: number } | null;
}) {
  const [form, setForm] = React.useState<PurchaseOrderFormState | null>(order ? purchaseOrderFormFromView(order) : null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open && order) {
      setForm(purchaseOrderFormFromView(order));
      setError(null);
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!order || !form) return;
    const bad = validatePurchaseOrderForm(form);
    if (bad) return setError(bad);
    setBusy(true);
    setError(null);
    try {
      const res = await updatePurchaseOrder(order.id, {
        items: purchaseDraftsToInput(form.items),
        orderDate: form.orderDate,
        requiredDate: form.requiredDate,
        deliveryTerms: form.deliveryTerms,
        paymentTerms: form.paymentTerms,
        deliveryAddress: form.deliveryAddress,
        note: form.note,
      });
      if (!res.ok) {
        setError(res.error ?? "Objednávku se nepodařilo uložit.");
        return;
      }
      notify("success", `Objednávka ${order.number} uložena${res.fileId ? " — PDF přegenerováno" : ""}.`);
      if (res.hint) notify("info", res.hint);
      onOpenChange(false);
      onDone();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className={`${FULLSCREEN_DIALOG} sm:max-w-5xl`}>
        <DialogHead
          icon={Pencil}
          tone="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
          title={`Upravit objednávku ${order?.number ?? ""}`}
          subtitle="Dokud objednávka neodešla, jde měnit všechno kromě dodavatele."
        />
        {form && order && (
          <form onSubmit={submit} className="space-y-5 p-4 sm:p-5" noValidate>
            <ErrorBox error={error} />
            <PurchaseOrderForm
              form={form}
              onChange={(f) => {
                setForm(f);
                setError(null);
              }}
              supplierOptions={[]}
              supplierLocked
              supplierLabel={order.supplier?.name}
              margin={margin}
              currency={order.currency}
            />
            <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col-reverse gap-2 border-t bg-popover/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:-mb-5 sm:flex-row sm:justify-end sm:px-5">
              <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Zrušit</Button>
              <Button type="submit" variant="success" disabled={busy}>
                {busy && <Loader2 className="h-4 w-4 animate-spin" />} Uložit objednávku
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}
