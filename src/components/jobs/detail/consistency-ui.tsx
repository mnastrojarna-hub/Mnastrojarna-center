"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, Info, Loader2, Lock, Scale, Wand2, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { JobDetail } from "@/lib/jobs/types";
import type { JobPurchasing } from "@/lib/jobs/purchasing-types";
import {
  DISTRIBUTE_MODE_LABELS, activePurchaseOrders, availableModes, consistencyIssues, defaultMode, distributeJobValue,
  formatKc, invoicedValueBlock, itemsSaleValue, orderedCost, quotePriceWarning, unpricedCount,
  type ConsistencyIssue, type ConsistencySnapshot, type DistributeMode, type MoneyItem,
} from "@/lib/jobs/consistency";
import { alignJobConsistency, setJobValue } from "@/app/actions/job-consistency";
import { useJobDetail } from "./detail-context";
import { InlineEditor } from "./inline-field";
import { DialogHead, ErrorBox } from "./confirm-dialog";
import { decimalInput, formatMoney, formatQty, parseDecimal } from "./detail-helpers";

/**
 * Křížová konzistence na kartě zakázky (majitel 4. 11.): hodnota = součet položek (změna se rozpočítá
 * na položky s náhledem), nákup = objednávky dodavatelům, odznaky nesouladu s opravou jedním klikem.
 */

function itemLabel(it: JobDetail["items"][number]): string {
  return [it.drawingNumber, it.name || it.description].map((x) => (x ?? "").trim()).filter(Boolean).join(" ") || `položka ${it.position + 1}`;
}

export function moneyItemsOf(job: Pick<JobDetail, "items">): (MoneyItem & { id: string })[] {
  return job.items.map((it) => ({
    id: it.id, quantity: Number(it.quantity) || 0, unitPrice: it.unitPrice, purchaseUnitPrice: it.purchaseUnitPrice, label: itemLabel(it),
  }));
}

export function consistencySnapshot(job: JobDetail, purchasing: JobPurchasing | null | undefined, margins: boolean): ConsistencySnapshot {
  return {
    value: job.value,
    purchaseCost: margins ? job.purchaseCost : null,
    currency: job.currency,
    invoiceNumber: job.invoiceNumber,
    invoicedAt: job.invoicedAt,
    stage: job.stage,
    items: moneyItemsOf(job),
    quotes: job.quotes.map((q) => ({
      id: q.id, number: q.number, state: q.state ?? null, status: q.status, total: q.total, archived: q.archived,
      accepted: q.accepted, sentAt: q.sentAt,
    })),
    purchaseOrders: margins && purchasing ? purchasing.purchaseOrders.map((p) => ({
      id: p.id, number: p.number, status: p.status, total: p.total, requiredDate: p.requiredDate, confirmedDate: p.confirmedDate,
      items: p.items.map((i) => ({ orderItemId: i.orderItemId ?? null, quantity: i.quantity })),
    })) : null,
    margins,
    dueDate: job.dueDate,
    customerRequiredDate: job.customerRequiredDate,
    maxToleratedDate: job.maxToleratedDate,
  };
}

export function useJobConsistency(job: JobDetail, purchasing: JobPurchasing | null | undefined): ConsistencyIssue[] {
  const { perms } = useJobDetail();
  return React.useMemo(() => consistencyIssues(consistencySnapshot(job, purchasing, perms.margins)), [job, purchasing, perms.margins]);
}

const TONE: Record<ConsistencyIssue["tone"], { box: string; icon: LucideIcon }> = {
  info: { box: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-500/30 dark:bg-sky-500/10 dark:text-sky-100", icon: Info },
  warn: { box: "border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100", icon: AlertTriangle },
  danger: { box: "border-red-300 bg-red-50 text-red-900 dark:border-red-500/40 dark:bg-red-500/10 dark:text-red-100", icon: AlertTriangle },
};

/** Odznaky nesouladu (u pole nebo v přehledu) s opravou jedním klikem. */
export function ConsistencyBadges({ issues, className }: { issues: ConsistencyIssue[]; className?: string }) {
  const { jobId, notify, refresh } = useJobDetail();
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  if (!issues.length) return null;

  async function fix(issue: ConsistencyIssue) {
    if (!issue.fix || busy) return;
    setBusy(issue.key);
    setError(null);
    try {
      const res = await alignJobConsistency(jobId, issue.fix, issue.quoteId ? { quoteId: issue.quoteId } : {});
      if (!res.ok) {
        setError(res.error ?? "Srovnání se nepovedlo.");
        return;
      }
      notify("success", res.message ?? "Srovnáno.", res.quoteId ? { label: "Otevřít nabídku", href: `/orders/${jobId}?tab=nabidky` } : undefined);
      refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className={cn("space-y-1.5", className)} data-testid="consistency-badges">
      {issues.map((i) => {
        const t = TONE[i.tone];
        const Icon = t.icon;
        return (
          <div key={i.key} className={cn("flex flex-col gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs sm:flex-row sm:items-center", t.box)} data-issue={i.key}>
            <span className="flex min-w-0 flex-1 items-start gap-1.5">
              <Icon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="min-w-0 break-words">{i.text}</span>
            </span>
            {i.fix && (
              <Button
                type="button" size="sm" variant="outline"
                className="h-8 shrink-0 bg-background/70 text-xs"
                onClick={() => void fix(i)} disabled={busy !== null} data-fix={i.fix}
              >
                {busy === i.key ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Wand2 className="h-3.5 w-3.5" />} {i.fixLabel ?? "Srovnat"}
              </Button>
            )}
          </div>
        );
      })}
      {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
    </div>
  );
}

// ── Hodnota zakázky ────────────────────────────────────────────
interface Pending { value: number; resolve: (err: string | null) => void }

/** Hodnota zakázky: s naceněnými položkami „= součet položek"; změna → dialog rozpočítání s náhledem. */
export function JobValueField({ job }: { job: JobDetail }) {
  const { save, notify } = useJobDetail();
  const [pending, setPending] = React.useState<Pending | null>(null);
  const items = React.useMemo(() => moneyItemsOf(job), [job]);
  const itemsValue = itemsSaleValue(items);
  const derived = itemsValue !== null;
  const lock = invoicedValueBlock(job);
  const unpriced = unpricedCount(items);
  const hint = lock ? "Vyfakturováno — hodnota je uzamčená."
    : derived ? `= součet položek (${items.length - unpriced} s cenou${unpriced ? `, ${unpriced} bez ceny` : ""}). Změnu rozpočítám na položky.`
    : "Ruční hodnota — položky zatím nemají ceny. Jakmile je mají, hodnota = jejich součet.";

  async function onSave(next: string): Promise<string | null> {
    const v = next.trim() ? parseDecimal(next) : null;
    if (!derived) {
      const err = await save({ value: v });
      if (!err) {
        const w = quotePriceWarning(consistencyQuotes(job), v, job.currency);
        if (w) notify("info", w);
      }
      return err;
    }
    if (v === null) return "Hodnotu nejde smazat, dokud mají položky ceny — smaž ceny v Položkách.";
    return new Promise<string | null>((resolve) => setPending({ value: v, resolve }));
  }

  return (
    <div className="min-w-0" data-field="job-value">
      <InlineEditor
        label="Prodejní hodnota (bez DPH)"
        kind="money"
        value={decimalInput(job.value)}
        display={(v) => <span className="tabular-nums">{formatMoney(parseDecimal(v), job.currency)}</span>}
        onSave={onSave}
        readOnly={Boolean(lock)}
        icon={lock ? Lock : Scale}
        iconClass="text-emerald-500"
        placeholder="Doplnit částku"
        hint={hint}
      />
      <DistributeValueDialog
        job={job}
        items={items}
        pending={pending}
        onClose={(err) => {
          pending?.resolve(err);
          setPending(null);
        }}
      />
    </div>
  );
}

function consistencyQuotes(job: JobDetail) {
  return job.quotes.map((q) => ({ id: q.id, number: q.number, state: q.state ?? null, status: q.status, total: q.total, archived: q.archived, accepted: q.accepted, sentAt: q.sentAt }));
}

export function DistributeValueDialog({
  job, items, pending, onClose,
}: {
  job: JobDetail;
  items: (MoneyItem & { id: string })[];
  pending: Pending | null;
  onClose: (err: string | null) => void;
}) {
  const { jobId, notify, refresh } = useJobDetail();
  const target = pending?.value ?? 0;
  const modes = React.useMemo(() => availableModes(items, target), [items, target]);
  const [mode, setMode] = React.useState<DistributeMode | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [openFor, setOpenFor] = React.useState<Pending | null>(null);
  if (pending !== openFor) {
    setOpenFor(pending);
    setMode(pending ? defaultMode(items, pending.value) : null);
    setError(null);
  }
  const cur = job.currency || "CZK";
  const preview = pending && mode ? distributeJobValue(items, target, mode) : null;
  const before = itemsSaleValue(items) ?? job.value;
  const quoteWarn = preview?.ok ? quotePriceWarning(consistencyQuotes(job), preview.achieved, cur) : null;

  async function apply() {
    if (!pending || !mode || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await setJobValue(jobId, pending.value, mode);
      if (!res.ok) {
        setError(res.error ?? "Hodnotu se nepodařilo uložit.");
        return;
      }
      notify("success", `Hodnota zakázky ${formatKc(res.value ?? null, cur)} — rozpočítáno na ${res.changed ?? 0} ${(res.changed ?? 0) === 1 ? "položku" : (res.changed ?? 0) < 5 ? "položky" : "položek"}.`);
      if (res.warning) notify("info", res.warning);
      onClose(null);
      refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={Boolean(pending)} onOpenChange={(o) => { if (!o && !busy) onClose(`Nic se neuložilo — hodnota zůstává ${formatKc(job.value, cur)}.`); }}>
      <DialogContent aria-describedby={undefined} className="max-h-[92dvh] w-[calc(100%-1.5rem)] overflow-y-auto sm:max-w-xl">
        <DialogHead
          icon={Scale}
          tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
          title="Rozpočítat změnu na položky"
          subtitle={<>Hodnota zakázky je součet položek: <strong className="tabular-nums">{formatKc(before, cur)}</strong> → <strong className="tabular-nums">{formatKc(target, cur)}</strong></>}
        />
        <div className="space-y-4 p-4 sm:p-5" data-testid="distribute-dialog">
          {modes.length > 1 && (
            <fieldset className="grid gap-1.5 sm:grid-cols-3">
              <legend className="sr-only">Způsob rozpočítání</legend>
              {modes.map((m) => (
                <label
                  key={m}
                  className={cn(
                    "flex cursor-pointer items-center gap-2 rounded-lg border px-3 py-2 text-sm transition",
                    mode === m ? "border-emerald-500 bg-emerald-50 font-medium dark:bg-emerald-500/10" : "hover:bg-muted/60",
                  )}
                >
                  <input type="radio" name="distribute-mode" value={m} checked={mode === m} onChange={() => setMode(m)} className="accent-emerald-600" />
                  {DISTRIBUTE_MODE_LABELS[m]}
                </label>
              ))}
            </fieldset>
          )}

          {preview && !preview.ok && <ErrorBox error={preview.error} />}
          {preview?.ok && (
            <div className="overflow-hidden rounded-lg border">
              <ul className="divide-y text-sm" data-testid="distribute-preview">
                {items.map((it, i) => {
                  const to = preview.prices[i];
                  const changed = preview.changes.some((c) => c.index === i);
                  return (
                    <li key={it.id} className={cn("flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-3 py-2", changed && "bg-emerald-50/60 dark:bg-emerald-500/[0.06]")}>
                      <span className="min-w-0 flex-1 basis-40 break-words">{it.label}</span>
                      <span className="text-xs text-muted-foreground tabular-nums">{formatQty(it.quantity)} ks ×</span>
                      <span className="tabular-nums">
                        {changed && <span className="mr-1 text-xs text-muted-foreground line-through">{it.unitPrice === null ? "bez ceny" : formatMoney(it.unitPrice, cur)}</span>}
                        <span className={cn(changed && "font-semibold")}>{to === null ? "bez ceny" : formatMoney(to, cur)}</span>
                      </span>
                    </li>
                  );
                })}
              </ul>
              <div className="flex items-center justify-between border-t bg-muted/40 px-3 py-2 text-sm">
                <span className="font-medium">Hodnota zakázky po uložení</span>
                <span className="font-bold tabular-nums">{formatKc(preview.achieved, cur)}</span>
              </div>
            </div>
          )}
          {preview?.ok && !preview.exact && (
            <p className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
              Přesně {formatKc(target, cur)} se na haléře za kus složit nedá — uloží se nejbližší možná hodnota {formatKc(preview.achieved, cur)}.
            </p>
          )}
          {quoteWarn && (
            <p className="flex items-start gap-1.5 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-100">
              <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" /> {quoteWarn}
            </p>
          )}
          <ErrorBox error={error} />
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onClose(`Nic se neuložilo — hodnota zůstává ${formatKc(job.value, cur)}.`)} disabled={busy}>
              Zrušit
            </Button>
            <Button type="button" variant="success" onClick={() => void apply()} disabled={busy || !preview?.ok} data-testid="distribute-apply">
              {busy && <Loader2 className="h-4 w-4 animate-spin" />} Rozpočítat a uložit
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ── Nákupní náklady ────────────────────────────────────────────
/** Nákupní náklady: s objednávkami dodavatelům jen ke čtení (= Σ objednávek), jinak ruční pole. */
export function PurchaseCostField({ job, purchasing, children }: { job: JobDetail; purchasing: JobPurchasing | null | undefined; children: React.ReactNode }) {
  const active = purchasing ? activePurchaseOrders(purchasing.purchaseOrders) : [];
  if (!active.length) return <>{children}</>;
  const ordered = orderedCost(active.map((p) => ({ number: p.number, status: p.status, total: p.total })));
  return (
    <div className="min-w-0" data-field="purchase-cost-orders">
      <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Lock className="h-3.5 w-3.5 text-emerald-500" aria-hidden />
        Nákupní náklady
        <span className="rounded bg-muted px-1 text-[9px] font-normal uppercase tracking-wide">auto</span>
      </div>
      <div className="text-sm tabular-nums">{formatMoney(job.purchaseCost, job.currency)}</div>
      <p className="mt-0.5 text-[11px] leading-tight text-muted-foreground">
        = objednávky dodavatelům ({active.map((p) => p.number).join(", ")}{ordered !== null && job.purchaseCost !== null && Math.abs(ordered - job.purchaseCost) >= 0.005 ? `: ${formatKc(ordered, job.currency)}` : ""}).{" "}
        <Link href={`/orders/${job.id}?tab=nakup`} className="font-medium text-sky-700 hover:underline dark:text-sky-400">Změnit v Nákupu</Link>
      </p>
    </div>
  );
}
