"use client";

import * as React from "react";
import { Loader2, Factory, Hash, CalendarDays, Clock, Truck, Wallet, StickyNote, CalendarCheck, FilePlus2, Pencil } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { createSupplierQuote, updateSupplierQuote } from "@/app/actions/purchasing";
import type { JobDetail } from "@/lib/jobs/types";
import type { SupplierQuoteView } from "@/lib/jobs/purchasing-types";
import { addDaysIso, formatMoney, isoToday, parseDecimal } from "@/components/jobs/detail/detail-helpers";
import { useJobDetail } from "@/components/jobs/detail/detail-context";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { SearchSelect } from "@/components/jobs/detail/search-select";
import { PurchaseItemsEditor } from "./purchase-items-editor";
import { OPERATION_KINDS, OPERATION_KIND_ORDER } from "@/lib/jobs/operations";
import { cn } from "@/lib/utils";
import { FULLSCREEN_DIALOG, Field } from "./ui-bits";
import {
  draftsFromJobItems, purchaseDraftsTotal, supplierQuoteFormFrom, supplierQuoteFormNew, supplierQuoteFormToInput,
  validateSupplierQuoteForm, type SupplierQuoteFormState,
} from "./purchasing-model";

/**
 * Nová / upravená nabídka dodavatele: dodavatel z adresáře (nebo volný název),
 * číslo, data, dodací lhůta a položky (předvyplněné ze zakázky, ceny doplní člověk).
 * Celková cena = Σ položek, pokud se nezadá jinak.
 */
export function SupplierQuoteDialog({
  open, onOpenChange, job, quote,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: JobDetail;
  /** Úprava existující nabídky; bez ní se zakládá nová. */
  quote?: SupplierQuoteView | null;
}) {
  const { options, notify, refresh } = useJobDetail();
  const initial = React.useCallback(
    () => (quote ? supplierQuoteFormFrom(quote) : supplierQuoteFormNew(job, isoToday())),
    [quote, job],
  );
  const [form, setForm] = React.useState<SupplierQuoteFormState>(initial);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setForm(initial());
      setError(null);
    }
  }
  const set = <K extends keyof SupplierQuoteFormState>(k: K, v: SupplierQuoteFormState[K]) => {
    setForm((f) => ({ ...f, [k]: v }));
    setError(null);
  };

  const supplierOptions = React.useMemo(() => options.suppliers.map((s) => ({ value: s.id, label: s.name })), [options.suppliers]);
  const sum = purchaseDraftsTotal(form.items);
  const explicitTotal = parseDecimal(form.total);
  const lead = parseDecimal(form.leadTimeDays);
  const autoDelivery = !form.deliveryDate && lead !== null && lead > 0 ? addDaysIso(form.quoteDate || isoToday(), Math.round(lead)) : null;
  const editing = Boolean(quote);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const bad = validateSupplierQuoteForm(form);
    if (bad) return setError(bad);
    setBusy(true);
    setError(null);
    try {
      const input = supplierQuoteFormToInput(form);
      const res = quote ? await updateSupplierQuote(quote.id, input) : await createSupplierQuote(job.id, input);
      if (!res.ok) {
        setError(res.error ?? "Nabídku se nepodařilo uložit.");
        return;
      }
      notify("success", editing ? "Nabídka dodavatele uložena." : "Nabídka dodavatele přidána — vyber vítěze a vystav objednávku.");
      onOpenChange(false);
      refresh();
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
          icon={editing ? Pencil : FilePlus2}
          tone="bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300"
          title={editing ? `Upravit nabídku dodavatele${quote?.number ? ` ${quote.number}` : ""}` : "Nabídka dodavatele"}
          subtitle={editing ? "Změna ceny vítězné nabídky se propíše do plánovaného nákupu zakázky." : "Položky jsou předvyplněné ze zakázky — doplň ceny a termín dodání."}
        />
        <form onSubmit={submit} className="space-y-5 p-4 sm:p-5" noValidate>
          <ErrorBox error={error} />
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <div className="rounded-lg border px-3 py-2 sm:col-span-2">
              <SearchSelect
                label="Dodavatel"
                icon={Factory}
                iconClass="text-orange-600"
                value={form.supplierId}
                options={supplierOptions}
                emptyLabel={form.supplierName ? `${form.supplierName} (mimo adresář)` : "Vyber dodavatele…"}
                createLabel="Použít název"
                allowClear={false}
                onSave={async (v) => {
                  setForm((f) => ({ ...f, supplierId: v, supplierName: v ? "" : f.supplierName }));
                  setError(null);
                  return null;
                }}
                onCreate={async (name) => {
                  setForm((f) => ({ ...f, supplierId: null, supplierName: name }));
                  setError(null);
                  return null;
                }}
              />
            </div>
            <Field label="Číslo nabídky dodavatele" icon={Hash}>
              <Input value={form.number} onChange={(e) => set("number", e.target.value)} placeholder="např. NAB-1234" />
            </Field>
            <Field label="Datum nabídky" icon={CalendarDays}>
              <Input type="date" value={form.quoteDate} onChange={(e) => set("quoteDate", e.target.value)} />
            </Field>
            <Field label="Platnost do" icon={CalendarCheck}>
              <Input type="date" value={form.validUntil} onChange={(e) => set("validUntil", e.target.value)} />
            </Field>
            <Field label="Dodací lhůta (dní)" icon={Clock}>
              <Input inputMode="numeric" value={form.leadTimeDays} onChange={(e) => set("leadTimeDays", e.target.value)} placeholder="např. 14" />
            </Field>
            <Field
              label="Termín dodání"
              icon={Truck}
              hint={autoDelivery ? `prázdné = dopočítá se ${autoDelivery.split("-").reverse().map(Number).join(". ")}` : undefined}
            >
              <Input type="date" value={form.deliveryDate} onChange={(e) => set("deliveryDate", e.target.value)} />
            </Field>
            <Field
              label="Celkem bez DPH"
              icon={Wallet}
              hint={explicitTotal === null ? (sum.priced ? `= součet položek ${formatMoney(sum.total)}` : "nebo vyplň ceny položek") : "zadaná částka má přednost před součtem"}
            >
              <Input inputMode="decimal" value={form.total} onChange={(e) => set("total", e.target.value)} placeholder={sum.priced ? formatMoney(sum.total) : "celková cena"} className="text-right tabular-nums" />
            </Field>
          </div>

          {/* na co je nabídka (druhy kroků) — předání do výroby porovná nabídky ke stejnému kroku */}
          <div className="space-y-1.5" data-testid="quote-kinds">
            <p className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
              Na co je nabídka
              {form.operationKindsAi && (
                <span className="inline-flex items-center gap-0.5 rounded-full bg-violet-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-violet-800 dark:bg-violet-500/15 dark:text-violet-300" title="Předvyplnila AI z textu nabídky">
                  ✦ Předvyplnila AI
                </span>
              )}
              <span className="font-normal">· nevyplněno = podle textu nabídky</span>
            </p>
            <div className="flex flex-wrap gap-1.5">
              {OPERATION_KIND_ORDER.map((k) => {
                const m = OPERATION_KINDS[k];
                const on = (form.operationKinds ?? []).includes(k);
                return (
                  <button
                    key={k}
                    type="button"
                    aria-pressed={on}
                    onClick={() => setForm((f) => {
                      const cur = f.operationKinds ?? [];
                      return { ...f, operationKindsAi: false, operationKinds: on ? cur.filter((x) => x !== k) : [...cur, k] };
                    })}
                    className={cn(
                      "inline-flex h-9 items-center gap-1 rounded-full border px-3 text-xs font-medium transition sm:h-8",
                      on ? cn(m.badge, "border-transparent ring-1 ring-foreground/20") : "text-muted-foreground hover:bg-accent",
                    )}
                  >
                    <m.icon className="h-3.5 w-3.5" /> {m.label}
                  </button>
                );
              })}
            </div>
          </div>

          <PurchaseItemsEditor
            drafts={form.items}
            onChange={(items) => set("items", items)}
            currency={job.currency}
            emptyHint="Nabídka může mít jen celkovou cenu — nebo přidej položky z nabídky dodavatele."
            onFillFromJob={job.items.length ? () => set("items", draftsFromJobItems(job.items)) : undefined}
          />

          <Field label="Poznámka" icon={StickyNote}>
            <Textarea rows={2} value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="např. cena platí při odběru celé série" />
          </Field>

          <div className="sticky bottom-0 -mx-4 -mb-4 flex flex-col-reverse gap-2 border-t bg-popover/95 px-4 py-3 backdrop-blur sm:-mx-5 sm:-mb-5 sm:flex-row sm:items-center sm:justify-end sm:px-5">
            <span className="mr-auto hidden text-sm text-muted-foreground sm:block">
              Celkem <strong className="tabular-nums text-foreground">{formatMoney(explicitTotal ?? sum.total, job.currency)}</strong>
            </span>
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>Zrušit</Button>
            <Button type="submit" variant="success" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {editing ? "Uložit nabídku" : "Přidat nabídku"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
