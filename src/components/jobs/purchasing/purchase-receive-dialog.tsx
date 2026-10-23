"use client";

import * as React from "react";
import { Ban, Loader2, PackageCheck, PackageOpen } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { setPurchaseReceived, updatePurchaseOrder } from "@/app/actions/purchasing";
import type { PurchaseItem, PurchaseOrderView } from "@/lib/jobs/purchasing-types";
import type { Notify } from "@/components/jobs/detail/toast";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { decimalInput, formatQty, parseDecimal } from "@/components/jobs/detail/detail-helpers";
import { cn } from "@/lib/utils";
import { FULLSCREEN_DIALOG } from "./ui-bits";
import { receiptDraftsFrom, receiptDraftsToInput, validateReceiptDrafts, type ReceiptDraft } from "./purchasing-model";

/**
 * Převzetí zboží od dodavatele po položkách: předvyplněno zbývající množství (stačí potvrdit),
 * u menšího množství jde položku uzavřít s důvodem (zmetky, víc nepřijde). Převzato vše →
 * objednávka Dodána a zakázka se posune podle pravidla „Dodáno k nám".
 */
export function ReceivePurchaseOrderDialog({
  open, onOpenChange, order, items, notify, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Pick<PurchaseOrderView, "id" | "number"> & { supplierName?: string | null };
  items: PurchaseItem[];
  notify: Notify;
  onDone: () => void;
}) {
  const [drafts, setDrafts] = React.useState<ReceiptDraft[]>(() => receiptDraftsFrom(items));
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setDrafts(receiptDraftsFrom(items));
      setNote("");
      setError(null);
    }
  }

  function patch(i: number, p: Partial<ReceiptDraft>) {
    setDrafts((d) => d.map((x, j) => (j === i ? { ...x, ...p } : x)));
    setError(null);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const bad = validateReceiptDrafts(drafts);
    if (bad) return setError(bad);
    setBusy(true);
    setError(null);
    try {
      const res = await setPurchaseReceived(order.id, receiptDraftsToInput(drafts), { note: note.trim() || undefined });
      if (!res.ok) {
        setError(res.error ?? "Převzetí se nepodařilo uložit.");
        return;
      }
      notify("success", res.complete
        ? `Objednávka ${order.number} převzata celá.`
        : `Převzato ${res.done}/${res.total} položek objednávky ${order.number}.`);
      if (res.hint && res.complete) notify("info", res.hint);
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
      <DialogContent aria-describedby={undefined} className={`${FULLSCREEN_DIALOG} sm:max-w-2xl`}>
        <DialogHead
          icon={PackageOpen}
          tone="bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300"
          title={`Převzít zboží — ${order.number}`}
          subtitle={`Zapiš, kolik od ${order.supplierName || "dodavatele"} skutečně přišlo. Předvyplněno je vše, co zbývá.`}
        />
        <form onSubmit={submit} className="space-y-4 p-4 sm:p-5" noValidate>
          <ErrorBox error={error} />
          <ul className="space-y-2">
            {drafts.map((d, i) => {
              const qty = parseDecimal(d.received);
              const short = qty !== null && qty + 1e-9 < d.quantity;
              return (
                <li key={d.itemId} className={cn("rounded-xl border p-3", d.close && "border-amber-300 bg-amber-50/50 dark:border-amber-500/30 dark:bg-amber-500/5")}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {d.drawingNumber && <span className="mr-1.5 font-mono text-blue-700 dark:text-blue-400">{d.drawingNumber}</span>}
                        {d.name || "Položka"}
                      </p>
                      <p className="text-[11px] text-muted-foreground">
                        objednáno {formatQty(d.quantity)} {d.unit}
                        {d.before > 0 ? ` · dosud převzato ${formatQty(d.before)}` : ""}
                      </p>
                    </div>
                    <label className="flex items-center gap-1.5 text-xs">
                      <span className="text-muted-foreground">Převzato celkem</span>
                      <Input
                        inputMode="decimal"
                        value={d.received}
                        onChange={(e) => patch(i, { received: e.target.value, ...(parseDecimal(e.target.value) !== null && (parseDecimal(e.target.value) ?? 0) + 1e-9 >= d.quantity ? { close: false } : {}) })}
                        className="h-10 w-24 text-right tabular-nums"
                        aria-label={`Převzaté množství — ${d.drawingNumber || d.name || `položka ${i + 1}`}`}
                      />
                      <span className="w-6 text-muted-foreground">{d.unit}</span>
                    </label>
                  </div>
                  {short && (
                    <div className="mt-2 space-y-2">
                      <label className="flex min-h-10 items-center gap-2 text-xs">
                        <input
                          type="checkbox"
                          checked={d.close}
                          onChange={(e) => patch(i, { close: e.target.checked })}
                          className="h-4 w-4 accent-amber-600"
                        />
                        Víc nepřijde — uzavřít s menším množstvím
                      </label>
                      {d.close && (
                        <Input
                          value={d.reason}
                          onChange={(e) => patch(i, { reason: e.target.value })}
                          placeholder="Důvod (např. 2 ks zmetky, dodavatel víc nemá)"
                          aria-label="Důvod uzavření s menším množstvím"
                          className="h-10"
                        />
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">Poznámka (nepovinná)</span>
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="např. číslo dodacího listu dodavatele" />
          </label>
          <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col-reverse gap-2 border-t bg-popover/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:-mb-5 sm:flex-row sm:justify-end sm:px-5">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Zpět</Button>
            <Button type="submit" variant="success" disabled={busy} className="h-11 sm:h-9">
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <PackageCheck className="h-4 w-4" />} Uložit převzetí
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Nejčastější důvody zrušení objednávky dodavateli — jedním ťuknutím. */
export const PO_CANCEL_REASONS = [
  "Dodavatel nedodá",
  "Objednáno jinde",
  "Zákazník zakázku stornoval",
  "Chyba v objednávce",
  "Duplicitní objednávka",
] as const;

/** Zrušení objednávky dodavateli s důvodem (jedním ťuknutím + volitelná poznámka). */
export function CancelPurchaseOrderDialog({
  open, onOpenChange, order, notify, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  order: Pick<PurchaseOrderView, "id" | "number" | "sentAt">;
  notify: Notify;
  onDone: () => void;
}) {
  const [reason, setReason] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setReason(null);
      setNote("");
      setError(null);
    }
  }
  const text = [reason, note.trim()].filter(Boolean).join(" — ");

  async function confirm() {
    if (!text) return setError("Vyber nebo napiš důvod zrušení.");
    setBusy(true);
    setError(null);
    try {
      const res = await updatePurchaseOrder(order.id, { status: "zrusena", cancelReason: text });
      if (!res.ok) {
        setError(res.error ?? "Objednávku se nepodařilo zrušit.");
        return;
      }
      notify("success", `Objednávka ${order.number} zrušena — do nákladů se už nepočítá.`);
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
          icon={Ban}
          tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
          title={`Zrušit objednávku ${order.number}?`}
          subtitle={`Zrušená se nezapočítává do nákupu — marže a provize se přepočítají.${order.sentAt ? " Dodavateli to dej vědět, objednávka už odešla." : ""}`}
        />
        <div className="space-y-4 p-5">
          <ErrorBox error={error} />
          <div role="radiogroup" aria-label="Důvod zrušení" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {PO_CANCEL_REASONS.map((r) => (
              <button
                key={r}
                type="button"
                role="radio"
                aria-checked={reason === r}
                onClick={() => { setReason(r); setError(null); }}
                className={cn(
                  "min-h-11 rounded-lg border px-3 py-2 text-left text-sm transition",
                  reason === r ? "border-red-500 bg-red-50 font-medium text-red-800 ring-2 ring-red-500/30 dark:bg-red-500/10 dark:text-red-200" : "hover:bg-accent",
                )}
              >
                {r}
              </button>
            ))}
          </div>
          <label className="block space-y-1">
            <span className="text-xs font-medium text-muted-foreground">{reason ? "Poznámka (nepovinná)" : "Jiný důvod"}</span>
            <Textarea rows={2} value={note} onChange={(e) => { setNote(e.target.value); setError(null); }} />
          </label>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Zpět</Button>
            <Button type="button" variant="destructive" onClick={() => void confirm()} disabled={busy || !text} className="h-11 sm:h-9">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Zrušit objednávku
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export { decimalInput };
