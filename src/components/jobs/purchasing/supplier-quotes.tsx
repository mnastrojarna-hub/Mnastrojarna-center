"use client";

import * as React from "react";
import {
  Factory, Trophy, Pencil, Trash2, Loader2, CalendarDays, Clock, Truck, Package, Paperclip, CheckCircle2, Undo2, Scale,
  Zap, BadgePercent, FilePlus2, CalendarX, Camera, Download,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  selectWinningSupplierQuote, unselectSupplierQuote, deleteSupplierQuote, importCapturedSupplierQuote,
} from "@/app/actions/purchasing";
import type { PendingCapturedQuote, SupplierQuoteView } from "@/lib/jobs/purchasing-types";
import type { ActionResult } from "@/lib/jobs/types";
import { useJobDetail } from "@/components/jobs/detail/detail-context";
import { ConfirmDialog } from "@/components/jobs/detail/confirm-dialog";
import { formatMoney, formatPercent, formatQty, longDate } from "@/components/jobs/detail/detail-helpers";
import { cn } from "@/lib/utils";
import { compareSupplierQuotes } from "./purchasing-model";
import { ActorStamp } from "@/components/flow-status/actor-stamp";
import type { ChangeStamp } from "@/lib/jobs/flow-status";

/** Kdo nabídku zapsal (created_by + čas založení). */
function createdStamp(q: SupplierQuoteView): ChangeStamp {
  return {
    by: q.createdBy, byName: q.createdBy?.name ?? null, at: q.createdAt,
    via: q.source === "foto" ? "foto" : q.source === "email" ? "email" : q.source === "ai" ? "ai" : null,
    kind: q.source === "ai" ? "ai" : q.createdBy ? "user" : "system",
  };
}

/** Karta nabídky dodavatele — vítězná má zelený rámeček a odznak. */
export function SupplierQuoteCard({
  quote, today, onEdit, onDelete, cheapest,
}: {
  quote: SupplierQuoteView;
  today: string;
  onEdit: () => void;
  onDelete: () => void;
  cheapest?: boolean;
}) {
  const { notify, refresh } = useJobDetail();
  const [busy, setBusy] = React.useState<null | "select" | "unselect">(null);
  const expired = Boolean(quote.validUntil && quote.validUntil < today);
  const preview = quote.items.slice(0, 3);

  async function run(kind: "select" | "unselect", fn: () => Promise<ActionResult>, ok: string) {
    setBusy(kind);
    try {
      const res = await fn();
      if (!res.ok) notify("error", res.error ?? "Akce se nepovedla.");
      else {
        notify("success", ok);
        refresh();
      }
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <article
      className={cn(
        "relative flex flex-col overflow-hidden rounded-xl border bg-card shadow-sm transition",
        quote.selected && "border-green-400 ring-2 ring-green-500/50 dark:border-green-500/60",
      )}
    >
      <span className={cn("absolute inset-y-0 left-0 w-1.5", quote.selected ? "bg-green-500" : "bg-orange-400/70")} aria-hidden />
      <div className="flex flex-1 flex-col gap-3 p-4 pl-5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <Factory className="h-4 w-4 shrink-0 text-orange-600" />
              <span className="truncate font-semibold">{quote.supplierName || "Dodavatel"}</span>
              {quote.selected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-600 px-2 py-0.5 text-xs font-semibold text-white">
                  <Trophy className="h-3 w-3" /> Vítězná
                </span>
              )}
              {cheapest && !quote.selected && (
                <span className="inline-flex items-center gap-1 rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">
                  <BadgePercent className="h-3 w-3" /> nejlevnější
                </span>
              )}
              {!quote.supplier && (
                <span className="rounded-full bg-muted px-1.5 py-px text-[10px] text-muted-foreground" title="Při vystavení objednávky se dodavatel založí do adresáře">mimo adresář</span>
              )}
            </div>
            <p className="text-xs text-muted-foreground">
              {quote.number ? <span className="font-mono font-medium text-foreground">{quote.number}</span> : "bez čísla"}
              {quote.quoteDate ? ` · ${longDate(quote.quoteDate)}` : ""}
            </p>
          </div>
          <div className="shrink-0 text-right">
            <div className="text-lg font-bold tabular-nums">
              {quote.total !== null ? formatMoney(quote.total, quote.currency) : <span className="text-sm font-normal text-amber-600">bez ceny</span>}
            </div>
            <div className="text-[11px] text-muted-foreground">bez DPH</div>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-3 gap-y-1.5 text-xs">
          <div>
            <dt className="flex items-center gap-1 text-muted-foreground"><Truck className="h-3 w-3 text-lime-600" /> Termín dodání</dt>
            <dd className="font-medium">{longDate(quote.deliveryDate) ?? "—"}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-muted-foreground"><Clock className="h-3 w-3 text-lime-600" /> Dodací lhůta</dt>
            <dd className="font-medium">{quote.leadTimeDays !== null ? `${quote.leadTimeDays} dní` : "—"}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-muted-foreground">
              {expired ? <CalendarX className="h-3 w-3 text-red-500" /> : <CalendarDays className="h-3 w-3 text-lime-600" />} Platnost do
            </dt>
            <dd className={cn("font-medium", expired && "text-red-600 dark:text-red-400")}>
              {longDate(quote.validUntil) ?? "—"}{expired ? " (prošlá)" : ""}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-muted-foreground"><Package className="h-3 w-3 text-lime-600" /> Položky</dt>
            <dd className="font-medium">{quote.items.length || "jen celková cena"}</dd>
          </div>
        </dl>

        {preview.length > 0 && (
          <ul className="divide-y rounded-lg border bg-muted/20 text-xs">
            {preview.map((it, i) => (
              <li key={it.id ?? i} className="flex items-center gap-2 px-2.5 py-1.5">
                {it.drawingNumber && <span className="shrink-0 font-mono font-medium text-blue-700 dark:text-blue-400">{it.drawingNumber}</span>}
                <span className="min-w-0 flex-1 truncate">{it.name || "—"}</span>
                <span className="shrink-0 tabular-nums text-muted-foreground">{formatQty(it.quantity)} {it.unit}</span>
                <span className="w-20 shrink-0 text-right tabular-nums">
                  {it.unitPrice !== null ? formatMoney(it.unitPrice * it.quantity, quote.currency) : <span className="text-amber-600">—</span>}
                </span>
              </li>
            ))}
            {quote.items.length > preview.length && <li className="px-2.5 py-1 text-muted-foreground">a další {quote.items.length - preview.length}…</li>}
          </ul>
        )}

        {quote.note && <p className="line-clamp-2 text-xs text-muted-foreground">{quote.note}</p>}

        <div className="flex flex-col gap-0.5">
          <ActorStamp verb={quote.source === "foto" ? "Zapsána z fotky" : quote.source === "telefon" ? "Nabídka telefonem — zapsána" : "Zapsána"} stamp={createdStamp(quote)} />
          {quote.selected && quote.selectedStamp && (
            <ActorStamp verb="Vítězná" stamp={quote.selectedStamp} className="text-green-700 dark:text-green-400" />
          )}
        </div>

        <div className="mt-auto flex flex-wrap items-center gap-1.5 pt-1">
          {quote.selected ? (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy !== null}
              onClick={() => void run("unselect", () => unselectSupplierQuote(quote.id), "Výběr vítězné nabídky zrušen.")}
            >
              {busy === "unselect" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Zrušit výběr
            </Button>
          ) : (
            <Button
              size="sm"
              variant="success"
              disabled={busy !== null}
              onClick={() => void run("select", () => selectWinningSupplierQuote(quote.id), `Vítěz: ${quote.supplierName || "dodavatel"} — plánovaný nákup a termín propsány do zakázky.`)}
            >
              {busy === "select" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Vybrat jako vítěznou
            </Button>
          )}
          <Button size="sm" variant="outline" onClick={onEdit} disabled={busy !== null}>
            <Pencil className="h-4 w-4" /> Upravit
          </Button>
          {quote.fileId && (
            <Button asChild size="sm" variant="ghost">
              <a href={`/api/jobs/files/${quote.fileId}`} target="_blank" rel="noopener noreferrer">
                <Paperclip className="h-4 w-4" /> Dokument
              </a>
            </Button>
          )}
          <Button size="icon-sm" variant="ghost" onClick={onDelete} disabled={busy !== null} aria-label="Smazat nabídku" className="ml-auto text-muted-foreground hover:text-red-600">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </article>
  );
}

/** Srovnání nabídek (od 2): cena jako pruh, rozdíl proti nejlevnější, nejrychlejší termín. */
export function QuotesCompare({ quotes, today }: { quotes: SupplierQuoteView[]; today: string }) {
  const { notify, refresh } = useJobDetail();
  const [busy, setBusy] = React.useState<string | null>(null);
  const rows = compareSupplierQuotes(quotes, today);
  if (rows.length < 2) return null;

  async function pick(id: string, name: string) {
    setBusy(id);
    try {
      const res = await selectWinningSupplierQuote(id);
      if (!res.ok) notify("error", res.error ?? "Výběr se nepovedl.");
      else {
        notify("success", `Vítěz: ${name}.`);
        refresh();
      }
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="overflow-hidden rounded-xl border bg-card shadow-sm">
      <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-2 text-sm font-medium">
        <Scale className="h-4 w-4 text-lime-600" /> Srovnání nabídek
        <span className="text-xs font-normal text-muted-foreground">— od nejlevnější</span>
      </div>
      <ul className="divide-y">
        {rows.map((r) => (
          <li key={r.id} className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 sm:grid-cols-[minmax(0,1.3fr)_minmax(0,2fr)_9rem_auto]", r.selected && "bg-green-50/70 dark:bg-green-500/10")}>
            <div className="col-start-1 row-start-1 min-w-0 sm:col-start-auto sm:row-start-auto">
              <div className="flex items-center gap-1.5">
                {r.selected && <Trophy className="h-3.5 w-3.5 shrink-0 text-green-600" />}
                <span className="truncate text-sm font-medium">{r.supplierName}</span>
              </div>
              {r.number && <div className="truncate font-mono text-[11px] text-muted-foreground">{r.number}</div>}
            </div>
            <div className="col-span-2 row-start-2 min-w-0 sm:col-span-1 sm:row-start-auto">
              <div className="flex items-center gap-2">
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-muted">
                  <span className={cn("block h-full rounded-full", r.cheapest ? "bg-emerald-500" : "bg-orange-400")} style={{ width: `${r.bar}%` }} />
                </div>
                <span className={cn("w-28 shrink-0 text-right text-sm font-semibold tabular-nums", r.cheapest && "text-emerald-700 dark:text-emerald-400")}>
                  {r.total !== null ? formatMoney(r.total, r.currency) : "bez ceny"}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-muted-foreground">
                {r.cheapest ? (
                  <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400"><BadgePercent className="h-3 w-3" /> nejlevnější</span>
                ) : r.diff !== null ? (
                  <>+{formatMoney(r.diff, r.currency)}{r.diffShare !== null ? ` (+${formatPercent(r.diffShare)})` : ""} proti nejlevnější</>
                ) : "cena chybí"}
              </div>
            </div>
            <div className="hidden text-xs sm:block">
              <div className={cn("font-medium", r.fastest && "text-sky-700 dark:text-sky-400")}>
                {r.fastest && <Zap className="mr-0.5 inline h-3 w-3" />}
                {longDate(r.deliveryDate) ?? "termín —"}
              </div>
              <div className="text-muted-foreground">{r.leadTimeDays !== null ? `${r.leadTimeDays} dní` : ""}{r.expired ? " · prošlá" : ""}</div>
            </div>
            <div className="col-start-2 row-start-1 flex justify-end sm:col-start-auto sm:row-start-auto">
              {r.selected ? (
                <span className="rounded-full bg-green-600 px-2 py-0.5 text-[11px] font-semibold text-white">Vítězná</span>
              ) : (
                <Button size="sm" variant="outline" onClick={() => void pick(r.id, r.supplierName)} disabled={busy !== null}>
                  {busy === r.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4 text-green-600" />} Vybrat
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Nabídky dodavatelů vyfocené kolegou bez práva na marže: čekají, až je někdo s přístupem
 * k nákupním cenám jedním ťuknutím zapíše do Nákupu (ceny se přečtou z dokladu).
 */
export function PendingCapturedQuotes({ items }: { items: PendingCapturedQuote[] }) {
  const { notify, refresh } = useJobDetail();
  const [busy, setBusy] = React.useState<string | null>(null);
  if (!items.length) return null;

  async function importOne(item: PendingCapturedQuote) {
    setBusy(item.fileId);
    try {
      const res = await importCapturedSupplierQuote(item.fileId);
      if (!res.ok) notify("error", res.error ?? "Nabídku se nepodařilo zapsat.");
      else {
        notify("success", `Nabídka ${item.supplierName || "dodavatele"} zapsána do Nákupu.`);
        refresh();
      }
    } catch {
      notify("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="rounded-xl border border-amber-300 bg-amber-50 p-3 dark:border-amber-500/40 dark:bg-amber-500/10" data-testid="pending-captured-quotes">
      <p className="flex items-center gap-2 text-sm font-semibold text-amber-900 dark:text-amber-100">
        <Camera className="h-4 w-4 shrink-0 text-amber-600" />
        Nabídky z focení čekají na zapsání ({items.length})
      </p>
      <ul className="mt-2 space-y-1.5">
        {items.map((it) => (
          <li key={it.fileId} className="flex flex-wrap items-center gap-2 rounded-lg bg-background/80 px-2.5 py-2 text-sm">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-medium">{it.supplierName || "Dodavatel"}</span>
              <span className="block truncate text-xs text-muted-foreground">{it.title}{it.createdAt ? ` · ${longDate(it.createdAt.slice(0, 10)) ?? ""}` : ""}</span>
            </span>
            <Button size="sm" variant="ghost" asChild>
              <a href={`/api/jobs/files/${it.fileId}`} target="_blank" rel="noopener noreferrer" aria-label={`Dokument nabídky ${it.supplierName || "dodavatele"}`}>
                <Paperclip className="h-4 w-4" />
              </a>
            </Button>
            <Button size="sm" variant="success" disabled={busy !== null} onClick={() => void importOne(it)}>
              {busy === it.fileId ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />} Zapsat
            </Button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Sekce nabídek dodavatelů: čekající z focení, srovnání, karty, prázdný stav. */
export function SupplierQuotesSection({
  quotes, today, onAdd, onEdit, pendingCaptured = [],
}: {
  quotes: SupplierQuoteView[];
  today: string;
  onAdd: () => void;
  onEdit: (q: SupplierQuoteView) => void;
  /** Nabídky vyfocené bez práva na marže (JobPurchasing.pendingCaptured). */
  pendingCaptured?: PendingCapturedQuote[];
}) {
  const { notify, refresh } = useJobDetail();
  const [toDelete, setToDelete] = React.useState<SupplierQuoteView | null>(null);
  const cheapestId = React.useMemo(() => compareSupplierQuotes(quotes, today).find((r) => r.cheapest)?.id ?? null, [quotes, today]);
  // vítězná první, pak od nejnovější
  const sorted = React.useMemo(() => [...quotes].sort((a, b) => Number(b.selected) - Number(a.selected) || b.createdAt.localeCompare(a.createdAt)), [quotes]);

  if (!quotes.length) {
    return (
      <div className="space-y-3">
      <PendingCapturedQuotes items={pendingCaptured} />
      <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-orange-200 bg-orange-50/40 px-4 py-8 text-center dark:border-orange-500/20 dark:bg-orange-500/5">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300">
          <Factory className="h-6 w-6" />
        </span>
        <div>
          <p className="font-medium">Zatím žádná nabídka dodavatele</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">
            Zapiš nabídky kooperantů (cena, termín), vyber vítěze — objednávka se z něj vyplní sama.
          </p>
        </div>
        <Button type="button" variant="success" onClick={onAdd}>
          <FilePlus2 className="h-4 w-4" /> Nabídka dodavatele
        </Button>
      </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <PendingCapturedQuotes items={pendingCaptured} />
      <QuotesCompare quotes={quotes} today={today} />
      <div className="grid gap-3 lg:grid-cols-2">
        {sorted.map((q) => (
          <SupplierQuoteCard
            key={q.id}
            quote={q}
            today={today}
            cheapest={q.id === cheapestId}
            onEdit={() => onEdit(q)}
            onDelete={() => setToDelete(q)}
          />
        ))}
      </div>
      <ConfirmDialog
        open={Boolean(toDelete)}
        onOpenChange={(o) => !o && setToDelete(null)}
        icon={Trash2}
        tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
        title="Smazat nabídku dodavatele?"
        confirmLabel="Smazat"
        confirmVariant="destructive"
        onConfirm={async () => {
          if (!toDelete) return null;
          const res = await deleteSupplierQuote(toDelete.id);
          if (!res.ok) return res.error ?? "Nabídku se nepodařilo smazat.";
          notify("success", "Nabídka dodavatele smazána.");
          refresh();
          return null;
        }}
      >
        {toDelete ? `Nabídka ${toDelete.supplierName || "dodavatele"}${toDelete.number ? ` č. ${toDelete.number}` : ""} se smaže.` : null}
        {toDelete?.selected ? " Byla vítězná — plánovaný nákup v zakázce zůstane, dokud ho nezměníš." : ""}
      </ConfirmDialog>
    </div>
  );
}
