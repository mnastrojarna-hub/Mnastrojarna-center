"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, CalendarClock, Check, ChevronDown, Link2, Loader2, Pencil, Plus, ReceiptText, RotateCcw, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/jobs/book/native-select";
import { PageHero } from "@/components/commissions/page-hero";
import { amountInput, dateText, formatMoney } from "@/components/supplier-invoices/format";
import {
  addPaymentPlanEntry, deletePaymentPlanEntry, searchInvoicesForPaymentPlan, setPaymentPlanPaid, updatePaymentPlanEntry,
} from "@/app/actions/payment-plan";
import { setSupplierInvoicePayment } from "@/app/actions/supplier-invoices";
import {
  addDays, buildPlanView, PLAN_CURRENCIES, UPCOMING_INVOICE_DAYS,
  type CurrencyTotal, type PaymentPlanData, type PaymentPlanEntry, type PaymentPlanInput, type PlanInvoiceOption, type UpcomingInvoice,
} from "@/lib/supplier-invoices/payment-plan";
import { cn } from "@/lib/utils";

const totalText = (t: CurrencyTotal[]): string => (t.length ? t.map((x) => formatMoney(x.amount, x.currency)).join(" + ") : formatMoney(0, "CZK"));

interface LinkedInvoice { id: string; number: string | null; supplierName: string | null }

interface FormValues {
  payee: string;
  amount: string;
  currency: string;
  dueOn: string;
  invoice: LinkedInvoice | null;
  note: string;
}

const emptyForm = (today: string): FormValues => ({ payee: "", amount: "", currency: "CZK", dueOn: today, invoice: null, note: "" });

function toInput(v: FormValues): Partial<PaymentPlanInput> {
  return { payee: v.payee, amount: v.amount, currency: v.currency, dueOn: v.dueOn, invoiceId: v.invoice?.id ?? null, note: v.note };
}

/**
 * Platební plán (31. 10., jen super admin): jednoduché poznámky „komu, kolik, kdy" — řádek se přidá
 * jedním formulářem (Enter), seznam po dnech (po termínu červeně) se součty; Zaplaceno / Upravit / Smazat.
 * Nezaplacené faktury se splatností brzy jsou jen sbalená nápověda (do plánu ani součtů se nepočítají).
 */
export function PaymentPlan({ data }: { data: PaymentPlanData }) {
  const router = useRouter();
  const { today } = data;
  const [entries, setEntries] = React.useState<PaymentPlanEntry[]>(data.entries);
  const [form, setForm] = React.useState<FormValues>(() => emptyForm(today));
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [editing, setEditing] = React.useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null);
  const [offer, setOffer] = React.useState<{ entryId: string; payee: string; invoiceId: string; number: string | null } | null>(null);
  const payeeRef = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => setEntries(data.entries), [data.entries]);

  const view = React.useMemo(() => buildPlanView(entries, today), [entries, today]);
  const upsert = (e: PaymentPlanEntry) => setEntries((xs) => (xs.some((x) => x.id === e.id) ? xs.map((x) => (x.id === e.id ? e : x)) : [...xs, e]));

  const add = async () => {
    if (busy) return;
    setBusy("add");
    setError(null);
    try {
      const r = await addPaymentPlanEntry(toInput(form));
      if (!r.ok) { setError(r.error); return; }
      upsert(r.entry);
      setForm((f) => ({ ...emptyForm(today), currency: f.currency }));
      payeeRef.current?.focus();
      router.refresh();
    } catch {
      setError("Spojení selhalo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };

  const save = async (id: string, v: FormValues): Promise<boolean> => {
    setBusy(id);
    setError(null);
    try {
      const r = await updatePaymentPlanEntry(id, toInput(v));
      if (!r.ok) { setError(r.error); return false; }
      upsert(r.entry);
      setEditing(null);
      return true;
    } catch {
      setError("Spojení selhalo — zkus to znovu.");
      return false;
    } finally {
      setBusy(null);
    }
  };

  const paid = async (e: PaymentPlanEntry, isPaid: boolean) => {
    setBusy(e.id);
    setError(null);
    try {
      const r = await setPaymentPlanPaid(e.id, isPaid);
      if (!r.ok) { setError(r.error); return; }
      upsert(r.entry);
      setOffer(r.offerInvoice ? { entryId: e.id, payee: e.payee, invoiceId: r.offerInvoice.id, number: r.offerInvoice.number } : null);
    } catch {
      setError("Spojení selhalo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    setError(null);
    try {
      const r = await deletePaymentPlanEntry(id);
      if (!r.ok) { setError(r.error); return; }
      setEntries((xs) => xs.filter((x) => x.id !== id));
      setConfirmDelete(null);
    } catch {
      setError("Spojení selhalo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };

  const payInvoice = async () => {
    if (!offer) return;
    setBusy("offer");
    try {
      const r = await setSupplierInvoicePayment(offer.invoiceId, { status: "zaplaceno" });
      if (!r.ok) { setError(r.error); return; }
      setEntries((xs) => xs.map((x) => (x.invoice?.id === offer.invoiceId ? { ...x, invoice: { ...x.invoice, paymentStatus: "zaplaceno" } } : x)));
      setOffer(null);
      router.refresh();
    } catch {
      setError("Spojení selhalo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };

  const prefillFromInvoice = (inv: UpcomingInvoice) => {
    setForm({
      payee: inv.supplierName ?? "", amount: inv.amount !== null ? amountInput(inv.amount) : "", currency: inv.currency,
      dueOn: inv.dueDate < today ? today : inv.dueDate, invoice: { id: inv.id, number: inv.number, supplierName: inv.supplierName }, note: "",
    });
    payeeRef.current?.focus();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <div className="space-y-4" data-testid="payment-plan">
      <PageHero
        tone="emerald"
        icon={CalendarClock}
        title="Platební plán"
        count={view.groups.reduce((n, g) => n + g.entries.length, 0)}
        description="Poznámky, co se má v příštích dnech zaplatit — komu, kolik a kdy. Faktura není podmínka. Vidíš jen ty."
      >
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3" data-testid="plan-totals">
          <div className="rounded-xl border bg-background/70 p-3">
            <dt className="text-xs text-muted-foreground">Celkem k zaplacení</dt>
            <dd className="text-lg font-semibold tabular-nums" data-testid="plan-total">{totalText(view.total)}</dd>
          </div>
          <div className="rounded-xl border bg-background/70 p-3">
            <dt className="text-xs text-muted-foreground">Po termínu</dt>
            <dd className={cn("text-lg font-semibold tabular-nums", view.overdueCount && "text-rose-700 dark:text-rose-300")} data-testid="plan-overdue">
              {view.overdueCount ? totalText(view.groups[0]?.totals ?? []) : "—"}
            </dd>
          </div>
        </dl>
      </PageHero>

      <PlanForm
        values={form} onChange={setForm} onSubmit={() => void add()} busy={busy === "add"} today={today} payees={data.payees}
        payeeRef={payeeRef} submitLabel="Přidat" testid="plan-form"
      />

      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200" role="alert" data-testid="plan-error">{error}</p>}

      {offer && (
        <div className="flex flex-col gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-3 text-sm sm:flex-row sm:items-center dark:border-emerald-500/30 dark:bg-emerald-500/10" data-testid="plan-offer-invoice">
          <p className="flex-1">
            „{offer.payee}“ zaplaceno. Faktura{offer.number ? ` č. ${offer.number}` : ""} ještě není označená jako zaplacená — označit ji taky?
          </p>
          <div className="flex gap-2">
            <Button size="sm" variant="success" disabled={busy === "offer"} onClick={() => void payInvoice()} data-testid="plan-offer-yes">
              {busy === "offer" ? <Loader2 className="animate-spin" /> : <Check />} Označit fakturu zaplacenou
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOffer(null)} data-testid="plan-offer-no">Ne</Button>
          </div>
        </div>
      )}

      {view.groups.length === 0 ? (
        <p className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="plan-empty">
          V plánu nic není. Přidej první platbu — komu, kolik a kdy.
        </p>
      ) : (
        <div className="space-y-3">
          {view.groups.map((g) => (
            <section
              key={g.key}
              className={cn("overflow-hidden rounded-2xl border bg-card", g.overdue && "border-rose-300 dark:border-rose-500/40")}
              data-testid="plan-day" data-day={g.key}
            >
              <header className={cn(
                "flex items-center justify-between gap-2 border-b px-3 py-2 sm:px-4",
                g.overdue ? "bg-rose-50 text-rose-800 dark:bg-rose-500/10 dark:text-rose-200" : g.today ? "bg-emerald-50 dark:bg-emerald-500/10" : "bg-muted/40",
              )}>
                <h2 className="flex min-w-0 items-center gap-1.5 text-sm font-semibold" data-testid="plan-day-label">
                  {g.overdue && <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />}
                  <span className="truncate">{g.label}</span>
                  {!g.overdue && g.label !== dateText(g.key) && (g.today || g.label === "Zítra") && <span className="font-normal text-muted-foreground">· {dateText(g.key)}</span>}
                </h2>
                <span className="shrink-0 text-sm font-semibold tabular-nums" data-testid="plan-day-total">{totalText(g.totals)}</span>
              </header>
              <ul className="divide-y">
                {g.entries.map((e) => (
                  <li key={e.id} data-testid="plan-row" data-id={e.id}>
                    {editing === e.id ? (
                      <div className="p-3">
                        <PlanForm
                          values={{ payee: e.payee, amount: amountInput(e.amount), currency: e.currency, dueOn: e.dueOn, invoice: e.invoice, note: e.note ?? "" }}
                          onSubmit={(v) => void save(e.id, v)} busy={busy === e.id} today={today} payees={data.payees}
                          submitLabel="Uložit" onCancel={() => setEditing(null)} testid="plan-edit-form" compact
                        />
                      </div>
                    ) : (
                      <EntryRow
                        e={e} overdue={g.overdue} busy={busy === e.id}
                        onPaid={() => void paid(e, true)} onEdit={() => { setEditing(e.id); setConfirmDelete(null); }}
                        confirmDelete={confirmDelete === e.id} onDelete={() => setConfirmDelete(e.id)}
                        onConfirmDelete={() => void remove(e.id)} onCancelDelete={() => setConfirmDelete(null)}
                      />
                    )}
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}

      {data.upcomingInvoices.length > 0 && (
        <details className="group rounded-2xl border bg-card" data-testid="plan-invoices-hint">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-muted-foreground sm:px-4 [&::-webkit-details-marker]:hidden">
            <ReceiptText className="h-4 w-4 shrink-0" aria-hidden />
            <span className="flex-1">Nezaplacené faktury se splatností do {UPCOMING_INVOICE_DAYS} dní ({data.upcomingInvoices.length}) — zobrazit</span>
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <p className="px-3 pb-2 text-xs text-muted-foreground sm:px-4">Jen pro přehled — do plánu ani do součtů se nepočítají, dokud je nepřidáš.</p>
          <ul className="divide-y border-t">
            {data.upcomingInvoices.map((inv) => (
              <li key={inv.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm sm:px-4" data-testid="plan-invoice-hint">
                <Link href={`/supplier-invoices/${inv.id}`} className="min-w-0 flex-1 truncate font-medium hover:underline">
                  {inv.supplierName ?? "Dodavatel"}{inv.number ? ` · č. ${inv.number}` : ""}
                </Link>
                <span className={cn("text-xs", inv.overdue ? "font-medium text-rose-700 dark:text-rose-300" : "text-muted-foreground")}>
                  splatnost {dateText(inv.dueDate)}
                </span>
                <span className="tabular-nums">{inv.amount !== null ? formatMoney(inv.amount, inv.currency) : "—"}</span>
                {inv.inPlan ? (
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">v plánu</span>
                ) : (
                  <Button size="sm" variant="ghost" className="h-8" onClick={() => prefillFromInvoice(inv)} data-testid="plan-invoice-prefill"><Plus /> Do plánu</Button>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}

      {view.paid.length > 0 && (
        <details className="group rounded-2xl border bg-card" data-testid="plan-paid">
          <summary className="flex min-h-11 cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm text-muted-foreground sm:px-4 [&::-webkit-details-marker]:hidden">
            <Check className="h-4 w-4 shrink-0 text-emerald-600" aria-hidden />
            <span className="flex-1">Zaplacené za posledních 30 dní ({view.paid.length})</span>
            <ChevronDown className="h-4 w-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="divide-y border-t">
            {view.paid.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm text-muted-foreground sm:px-4" data-testid="plan-paid-row">
                <span className="min-w-0 flex-1 truncate font-medium text-foreground">{e.payee}</span>
                <span className="text-xs">zaplaceno {dateText(e.paidAt)}{e.paidByName ? ` · ${e.paidByName}` : ""}</span>
                <span className="tabular-nums">{formatMoney(e.amount, e.currency)}</span>
                <Button size="sm" variant="ghost" className="h-8" disabled={busy === e.id} onClick={() => void paid(e, false)}><RotateCcw /> Vrátit</Button>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

function EntryRow({
  e, overdue, busy, onPaid, onEdit, confirmDelete, onDelete, onConfirmDelete, onCancelDelete,
}: {
  e: PaymentPlanEntry; overdue: boolean; busy: boolean;
  onPaid: () => void; onEdit: () => void;
  confirmDelete: boolean; onDelete: () => void; onConfirmDelete: () => void; onCancelDelete: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-3 py-2.5 sm:flex-nowrap sm:px-4">
      <div className="min-w-0 flex-1 basis-full sm:basis-0">
        <p className="truncate font-medium" data-testid="plan-row-payee">{e.payee}</p>
        <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          {overdue && <span className="font-medium text-rose-700 dark:text-rose-300">mělo být {dateText(e.dueOn)}</span>}
          {e.invoice && (
            <Link href={`/supplier-invoices/${e.invoice.id}`} className="inline-flex items-center gap-0.5 hover:text-foreground hover:underline" data-testid="plan-row-invoice">
              <Link2 className="h-3 w-3" aria-hidden /> faktura{e.invoice.number ? ` ${e.invoice.number}` : ""}
              {e.invoice.paymentStatus === "zaplaceno" && " (zaplacená)"}
            </Link>
          )}
          {e.note && <span className="truncate">{e.note}</span>}
        </p>
      </div>
      <span className={cn("ml-auto shrink-0 text-base font-semibold tabular-nums", overdue && "text-rose-700 dark:text-rose-300")} data-testid="plan-row-amount">
        {formatMoney(e.amount, e.currency)}
      </span>
      {confirmDelete ? (
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-xs text-muted-foreground">Smazat?</span>
          <Button size="sm" variant="destructive" className="h-9" disabled={busy} onClick={onConfirmDelete} data-testid="plan-row-delete-yes">Smazat</Button>
          <Button size="sm" variant="ghost" className="h-9" onClick={onCancelDelete}>Ne</Button>
        </div>
      ) : (
        <div className="flex shrink-0 items-center gap-1">
          <Button size="sm" variant="success" className="h-9" disabled={busy} onClick={onPaid} data-testid="plan-row-paid">
            {busy ? <Loader2 className="animate-spin" /> : <Check />} Zaplaceno
          </Button>
          <Button size="icon" variant="ghost" className="h-9 w-9" aria-label="Upravit" title="Upravit" disabled={busy} onClick={onEdit} data-testid="plan-row-edit"><Pencil /></Button>
          <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground hover:text-destructive" aria-label="Smazat" title="Smazat" disabled={busy} onClick={onDelete} data-testid="plan-row-delete"><Trash2 /></Button>
        </div>
      )}
    </div>
  );
}

/** Jeden řádek formuláře (Enter = uložit); na mobilu pod sebou. Bez `onChange` drží hodnoty sám (úprava řádku). */
function PlanForm({
  values, onChange, onSubmit, busy, today, payees, payeeRef, submitLabel, onCancel, testid, compact,
}: {
  values: FormValues;
  onChange?: (v: FormValues) => void;
  onSubmit: (v: FormValues) => void;
  busy: boolean;
  today: string;
  payees: string[];
  payeeRef?: React.Ref<HTMLInputElement>;
  submitLabel: string;
  onCancel?: () => void;
  testid: string;
  compact?: boolean;
}) {
  const [own, setOwn] = React.useState(values);
  const v = onChange ? values : own;
  const set = (patch: Partial<FormValues>) => (onChange ? onChange({ ...values, ...patch }) : setOwn((x) => ({ ...x, ...patch })));
  const listId = React.useId();
  const [linking, setLinking] = React.useState(false);
  const quick = [
    { label: "Dnes", day: today },
    { label: "Zítra", day: addDays(today, 1) },
    { label: "Pozítří", day: addDays(today, 2) },
    { label: "Za týden", day: addDays(today, 7) },
  ];
  return (
    <form
      className={cn("space-y-2", !compact && "rounded-2xl border bg-card p-3 sm:p-4")}
      onSubmit={(ev) => { ev.preventDefault(); onSubmit(v); }}
      data-testid={testid}
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_5.5rem_10rem_auto]">
        <label className="col-span-2 sm:col-span-1">
          <span className="sr-only">Komu</span>
          <Input
            ref={payeeRef} value={v.payee} onChange={(e) => set({ payee: e.target.value })} placeholder="Komu (např. Franta Vomáčka)"
            list={listId} autoComplete="off" className="h-10" data-testid="plan-payee" required
          />
          <datalist id={listId}>{payees.map((p) => <option key={p} value={p} />)}</datalist>
        </label>
        <label>
          <span className="sr-only">Částka</span>
          <Input
            value={v.amount} onChange={(e) => set({ amount: e.target.value })} placeholder="Částka" inputMode="decimal"
            className="h-10 text-right tabular-nums" data-testid="plan-amount" required
          />
        </label>
        <label>
          <span className="sr-only">Měna</span>
          <NativeSelect value={v.currency} onChange={(e) => set({ currency: e.target.value })} className="h-10" data-testid="plan-currency">
            {[...new Set([...PLAN_CURRENCIES, v.currency])].map((c) => <option key={c} value={c}>{c === "CZK" ? "Kč" : c}</option>)}
          </NativeSelect>
        </label>
        <label className="col-span-2 sm:col-span-1">
          <span className="sr-only">Kdy zaplatit</span>
          <Input type="date" value={v.dueOn} onChange={(e) => set({ dueOn: e.target.value })} className="h-10" data-testid="plan-due" required />
        </label>
        <div className="col-span-2 flex gap-2 sm:col-span-1">
          <Button type="submit" variant="success" className="h-10 flex-1 sm:flex-none" disabled={busy} data-testid="plan-submit">
            {busy ? <Loader2 className="animate-spin" /> : submitLabel === "Přidat" ? <Plus /> : <Check />} {submitLabel}
          </Button>
          {onCancel && <Button type="button" variant="ghost" className="h-10" onClick={onCancel} aria-label="Zrušit úpravu"><X /></Button>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        {quick.map((q) => (
          <button
            key={q.label} type="button" onClick={() => set({ dueOn: q.day })}
            className={cn(
              "min-h-8 rounded-full border px-2.5 text-xs transition",
              v.dueOn === q.day ? "border-emerald-400 bg-emerald-50 font-medium text-emerald-800 dark:border-emerald-500/50 dark:bg-emerald-500/10 dark:text-emerald-200" : "text-muted-foreground hover:bg-accent",
            )}
            data-testid={`plan-quick-${q.label === "Za týden" ? "tyden" : q.label.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")}`}
          >
            {q.label}
          </button>
        ))}
        <span className="mx-1 hidden h-4 w-px bg-border sm:inline-block" aria-hidden />
        {v.invoice ? (
          <span className="inline-flex min-h-8 items-center gap-1 rounded-full bg-muted px-2.5 text-xs" data-testid="plan-linked-invoice">
            <Link2 className="h-3 w-3" aria-hidden /> faktura {v.invoice.number ?? ""}{v.invoice.supplierName ? ` · ${v.invoice.supplierName}` : ""}
            <button type="button" aria-label="Odebrat fakturu" className="ml-0.5 rounded-full p-0.5 hover:bg-background" onClick={() => set({ invoice: null })}><X className="h-3 w-3" /></button>
          </span>
        ) : linking ? (
          <InvoiceSearch
            onPick={(inv) => {
              setLinking(false);
              set({
                invoice: { id: inv.id, number: inv.number, supplierName: inv.supplierName },
                ...(v.payee ? {} : { payee: inv.supplierName ?? "" }),
                ...(v.amount || inv.amount === null ? {} : { amount: amountInput(inv.amount), currency: inv.currency }),
                ...(inv.dueDate && inv.dueDate >= today && v.dueOn === today ? { dueOn: inv.dueDate } : {}),
              });
            }}
            onClose={() => setLinking(false)}
          />
        ) : (
          <button type="button" className="inline-flex min-h-8 items-center gap-1 rounded-full border border-dashed px-2.5 text-xs text-muted-foreground hover:bg-accent" onClick={() => setLinking(true)} data-testid="plan-link-invoice">
            <Link2 className="h-3 w-3" aria-hidden /> Odkaz na fakturu (nepovinné)
          </button>
        )}
        <Input
          value={v.note} onChange={(e) => set({ note: e.target.value })} placeholder="Poznámka (nepovinné)"
          className="h-8 min-w-0 flex-1 basis-full text-xs sm:basis-48" data-testid="plan-note"
        />
      </div>
    </form>
  );
}

function InvoiceSearch({ onPick, onClose }: { onPick: (inv: PlanInvoiceOption) => void; onClose: () => void }) {
  const [q, setQ] = React.useState("");
  const [items, setItems] = React.useState<PlanInvoiceOption[] | null>(null);
  React.useEffect(() => {
    let live = true;
    const t = window.setTimeout(async () => {
      const r = await searchInvoicesForPaymentPlan(q).catch(() => null);
      if (live) setItems(r && r.ok ? r.invoices : []);
    }, q ? 250 : 0);
    return () => { live = false; window.clearTimeout(t); };
  }, [q]);
  return (
    <div className="relative basis-full sm:basis-72">
      <div className="flex items-center gap-1">
        <Input
          autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Číslo faktury nebo dodavatel"
          className="h-8 text-xs" data-testid="plan-invoice-search"
          onKeyDown={(e) => { if (e.key === "Escape") onClose(); if (e.key === "Enter") { e.preventDefault(); if (items?.[0]) onPick(items[0]); } }}
        />
        <Button type="button" size="icon-sm" variant="ghost" aria-label="Zavřít" onClick={onClose}><X /></Button>
      </div>
      {items && (
        <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-auto rounded-xl border bg-popover p-1 text-sm shadow-lg">
          {items.length === 0 && <li className="px-2 py-1.5 text-xs text-muted-foreground">Nic nenalezeno.</li>}
          {items.map((inv) => (
            <li key={inv.id}>
              <button type="button" className="flex w-full flex-col items-start rounded-lg px-2 py-1.5 text-left hover:bg-accent" onClick={() => onPick(inv)} data-testid="plan-invoice-option">
                <span className="w-full truncate font-medium">{inv.number ?? "bez čísla"} · {inv.supplierName ?? "dodavatel"}</span>
                <span className="text-xs text-muted-foreground">
                  {inv.amount !== null ? formatMoney(inv.amount, inv.currency) : "—"}{inv.dueDate ? ` · splatnost ${dateText(inv.dueDate)}` : ""}{inv.paymentStatus === "zaplaceno" ? " · zaplacená" : ""}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
