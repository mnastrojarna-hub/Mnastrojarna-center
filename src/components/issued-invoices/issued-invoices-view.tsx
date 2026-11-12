"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle, ArrowDown, ArrowUp, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Download, ExternalLink, FileArchive,
  FileSpreadsheet, FileText, Files, Search, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/jobs/book/native-select";
import { PageHero } from "@/components/commissions/page-hero";
import { ConfirmDialog } from "@/components/jobs/detail/confirm-dialog";
import { formatMoney, dateText } from "@/components/supplier-invoices/format";
import { deleteIssuedInvoice } from "@/app/actions/issued-invoices";
import {
  byMonth, exportBaseName, filterInvoices, isFuturePeriod, monthName, monthShort, PAYMENT_STATE_META, periodKey, periodLabel,
  periodLabelFrom, shiftPeriod, sortInvoices, totalsOf, DEFAULT_SORT,
  type IssuedInvoice, type IssuedPeriod, type IssuedSortKey, type IssuedTotals,
} from "@/lib/issued-invoices/model";
import { cn } from "@/lib/utils";

export interface IssuedInvoicesViewProps {
  period: IssuedPeriod;
  items: IssuedInvoice[];
  /** Kurz ČNB (Kč za jednotku) k fakturám v cizí měně, podle id faktury. */
  rates: Record<string, number>;
  today: string;
  canDelete: boolean;
  initialQuery?: string;
}

const hrefOf = (p: IssuedPeriod) => `/issued-invoices?obdobi=${periodKey(p)}`;
const plural = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);

/** Hlavní částka součtů: vše v Kč (i přepočtené), jinak Kč faktury, jinak první měna. */
function mainAmount(t: IssuedTotals, field: "net" | "gross" | "unpaid"): { value: number; currency: string; converted: boolean } {
  if (t.czk) return { value: t.czk[field], currency: "CZK", converted: t.czk.converted };
  const base = t.byCurrency.find((c) => c.currency === "CZK") ?? t.byCurrency[0];
  if (!base) return { value: 0, currency: "CZK", converted: false };
  return { value: base[field], currency: base.currency, converted: false };
}

export function IssuedInvoicesView({ period, items, rates, today, canDelete, initialQuery = "" }: IssuedInvoicesViewProps) {
  const router = useRouter();
  const [q, setQ] = React.useState(initialQuery);
  const [sort, setSort] = React.useState<{ key: IssuedSortKey; dir: "asc" | "desc" }>(DEFAULT_SORT);
  const [toDelete, setToDelete] = React.useState<IssuedInvoice | null>(null);
  const [notice, setNotice] = React.useState<string | null>(null);

  const rateOf = React.useCallback((it: IssuedInvoice) => rates[it.id] ?? null, [rates]);
  const totals = React.useMemo(() => totalsOf(items, rateOf), [items, rateOf]);
  const shown = React.useMemo(() => sortInvoices(filterInvoices(items, q), sort.key, sort.dir), [items, q, sort]);
  const key = periodKey(period);
  const base = exportBaseName(period);
  const prev = shiftPeriod(period, -1);
  const next = shiftPeriod(period, 1);
  const nextDisabled = isFuturePeriod(next, today);
  const [ty, tm] = today.split("-").map(Number);
  const thisMonth: IssuedPeriod = { kind: "month", year: ty, month: tm };
  const isThisMonth = period.kind === "month" && period.year === ty && period.month === tm;

  const toggleSort = (k: IssuedSortKey) =>
    setSort((s) => (s.key === k ? { key: k, dir: s.dir === "asc" ? "desc" : "asc" } : { key: k, dir: k === "odberatel" || k === "cislo" ? "asc" : "desc" }));

  const net = mainAmount(totals, "net");
  const gross = mainAmount(totals, "gross");
  const unpaid = mainAmount(totals, "unpaid");
  const foreign = totals.byCurrency.filter((c) => c.currency !== "CZK");
  const overdue = totals.byCurrency.reduce((s, c) => s + (c.currency === "CZK" ? c.overdue : 0), 0);

  return (
    <div className="space-y-4">
      <PageHero
        tone="emerald"
        icon={FileSpreadsheet}
        title="Faktury vydané"
        count={totals.count}
        description={
          <>
            Naše faktury {periodLabelFrom(period)} — komu, kdy, za kolik a co je zaplacené. Pro účetní: všechna PDF najednou
            (ZIP), jedno PDF, nebo přehled do Excelu.
          </>
        }
      >
        <div className="space-y-3">
          <PeriodBar period={period} prev={prev} next={next} nextDisabled={nextDisabled} thisMonth={isThisMonth ? null : thisMonth} today={today} />
          <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4" data-testid="issued-totals">
            <Tile
              label={`Faktur ${period.kind === "month" ? "za měsíc" : "za rok"}`}
              value={String(totals.count)}
              sub={totals.withoutPdf ? `${totals.withoutPdf} bez PDF` : totals.storno ? `${totals.storno} stornováno (mimo součty)` : undefined}
              subTone={totals.withoutPdf ? "text-amber-700 dark:text-amber-300" : undefined}
            />
            <Tile label="Vyfakturováno bez DPH" value={formatMoney(net.value, net.currency)} sub={net.converted ? "vč. cizí měny (kurz ČNB k DUZP)" : undefined} strong />
            <Tile label="Vyfakturováno s DPH" value={formatMoney(gross.value, gross.currency)} sub={gross.converted ? "vč. cizí měny (kurz ČNB k DUZP)" : undefined} />
            <Tile
              label="Nezaplaceno"
              value={formatMoney(unpaid.value, unpaid.currency)}
              tone={unpaid.value > 0 ? "text-rose-700 dark:text-rose-300" : "text-emerald-700 dark:text-emerald-300"}
              sub={totals.count ? `zaplaceno ${totals.paidCount} z ${totals.count}${totals.overdueCount ? ` · po splatnosti ${totals.overdueCount}${overdue ? ` (${formatMoney(overdue)})` : ""}` : ""}` : undefined}
              subTone={totals.overdueCount ? "text-rose-700 dark:text-rose-300" : undefined}
            />
          </dl>
          {foreign.length > 0 && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground" data-testid="issued-currencies">
              <span className="font-medium text-foreground">Po měnách:</span>
              {totals.byCurrency.map((c) => (
                <span key={c.currency} className="tabular-nums">
                  {formatMoney(c.net, c.currency)} bez DPH / {formatMoney(c.gross, c.currency)} s DPH ({c.count} {plural(c.count, "faktura", "faktury", "faktur")})
                </span>
              ))}
              {!totals.czk && (
                <span className="inline-flex items-center gap-1 text-amber-800 dark:text-amber-300">
                  <AlertTriangle className="h-3.5 w-3.5" /> kurz ČNB nedostupný — cizí měna není v součtu v Kč
                </span>
              )}
            </p>
          )}
          {totals.count > 0 && (
            <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center" data-testid="issued-bulk">
              <Button asChild variant="success" className="col-span-2 h-10 sm:col-span-1">
                <a href={`/api/issued-invoices/zip?obdobi=${key}`} download={`${base}.zip`} data-testid="issued-zip">
                  <FileArchive className="h-4 w-4" /> Stáhnout všechny PDF (ZIP)
                </a>
              </Button>
              <Button asChild variant="outline" className="h-10">
                <a href={`/api/pdf/issued-invoices?obdobi=${key}`} data-filename={`${base}.pdf`} aria-label={`Otevřít všechny faktury ${base}.pdf`} data-testid="issued-open-all">
                  <Files className="h-4 w-4 text-emerald-600" /> Otevřít všechny
                </a>
              </Button>
              <Button asChild variant="outline" className="h-10">
                <a href={`/api/pdf/issued-invoices?obdobi=${key}&download=1`} download={`${base}.pdf`} data-testid="issued-merged-download">
                  <Download className="h-4 w-4 text-emerald-600" /> <span>Jedno PDF<span className="hidden sm:inline"> ke stažení</span></span>
                </a>
              </Button>
              <Button asChild variant="outline" className="col-span-2 h-10 sm:col-span-1">
                <a href={`/api/issued-invoices/csv?obdobi=${key}`} download={`${base}.csv`} data-testid="issued-csv">
                  <FileSpreadsheet className="h-4 w-4 text-emerald-600" /> Export pro účetní (CSV)
                </a>
              </Button>
            </div>
          )}
        </div>
      </PageHero>

      {period.kind === "year" && <YearGrid period={period} items={items} rateOf={rateOf} today={today} />}

      {notice && (
        <div role="status" className="flex items-start gap-2 rounded-xl border border-emerald-300/60 bg-emerald-50 px-3 py-2 text-sm text-emerald-900 dark:border-emerald-500/30 dark:bg-emerald-500/10 dark:text-emerald-200">
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="flex-1">{notice}</span>
          <button type="button" onClick={() => setNotice(null)} aria-label="Zavřít" className="text-emerald-800/70 hover:text-emerald-900 dark:text-emerald-200/70">
            <X className="h-4 w-4" />
          </button>
        </div>
      )}

      {items.length > 0 && (
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-2xl border bg-card p-2.5 shadow-sm sm:p-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Číslo faktury, odběratel, IČ, zakázka…"
              className="h-9 pl-9 text-base sm:text-sm"
              aria-label="Hledat faktury"
            />
          </div>
          <NativeSelect
            value={`${sort.key}:${sort.dir}`}
            onChange={(e) => {
              const [k, d] = e.target.value.split(":");
              setSort({ key: k as IssuedSortKey, dir: d === "asc" ? "asc" : "desc" });
            }}
            aria-label="Řazení"
            wrapperClassName="w-36 sm:w-48"
          >
            <option value="datum:desc">Nejnovější</option>
            <option value="datum:asc">Nejstarší</option>
            <option value="cislo:asc">Číslo ↑</option>
            <option value="cislo:desc">Číslo ↓</option>
            <option value="castka:desc">Nejvyšší částka</option>
            <option value="castka:asc">Nejnižší částka</option>
            <option value="odberatel:asc">Odběratel A–Z</option>
          </NativeSelect>
          {q && (
            <p className="col-span-2 text-xs text-muted-foreground">
              Zobrazeno {shown.length} z {items.length}. Hromadné stažení a export platí pro celé období.
            </p>
          )}
        </div>
      )}

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground" data-testid="issued-empty">
          <FileSpreadsheet className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
          {isFuturePeriod(period, today) ? "Toto období ještě nezačalo." : `${periodLabel(period).replace(/^./, (c) => c.toUpperCase())}: žádná vystavená faktura.`}
          <p className="mt-1 text-xs">Fakturu vystavíš v kartě zakázky (po dodání) — tady se objeví sama.</p>
        </div>
      ) : shown.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-6 text-center text-sm text-muted-foreground">Nic tomu neodpovídá.</div>
      ) : (
        <>
          <InvoiceTable items={shown} sort={sort} onSort={toggleSort} canDelete={canDelete} onDelete={setToDelete} />
          <ul className="space-y-2.5 md:hidden" data-testid="issued-cards">
            {shown.map((it) => <InvoiceCard key={it.id} it={it} canDelete={canDelete} onDelete={setToDelete} />)}
          </ul>
        </>
      )}

      {toDelete && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setToDelete(null)}
          icon={Trash2}
          tone="bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
          title={`Smazat fakturu ${toDelete.number}?`}
          confirmLabel="Smazat fakturu"
          confirmVariant="destructive"
          onConfirm={async () => {
            const r = await deleteIssuedInvoice(toDelete.id);
            if (!r.ok) return r.error ?? "Fakturu se nepodařilo smazat.";
            setNotice(
              `Faktura ${r.number} smazána.` +
              (r.stageReturned ? " Zakázka je zpět ve stavu „Dodáno zákazníkovi“ — můžeš vystavit novou fakturu." : "") +
              (r.numberFree ? ` Číslo ${r.number} je volné, nová faktura ho dostane znovu.` : ""),
            );
            setToDelete(null);
            router.refresh();
            return null;
          }}
        >
          <DeleteText it={toDelete} />
        </ConfirmDialog>
      )}
    </div>
  );
}

function DeleteText({ it }: { it: IssuedInvoice }) {
  return (
    <div className="space-y-2" data-testid="issued-delete-text">
      <p>
        <strong className="text-foreground">{it.number}</strong>
        {it.customer ? ` · ${it.customer.name}` : ""} · {formatMoney(it.gross, it.currency)} s DPH
      </p>
      {it.job ? (
        <p>
          Smaže se PDF faktury (i starší verze) a záznam v knize faktur. Zakázka{" "}
          <strong className="text-foreground">{it.job.number ?? "bez čísla"}</strong> se vrátí do stavu{" "}
          <strong className="text-foreground">„Dodáno zákazníkovi“</strong> a půjde vystavit novou fakturu. Pokud je číslo v řadě
          poslední, uvolní se — nová faktura dostane stejné číslo.
        </p>
      ) : (
        <p>Faktura nepatří k žádné zakázce — smaže se jen záznam v knize faktur (a uvolní číslo, pokud je v řadě poslední).</p>
      )}
      {it.file && !it.file.generated && <p>Nahraný sken faktury zůstane v dokumentech zakázky.</p>}
      {it.payment.paid > 0 && (
        <p className="flex items-start gap-1.5 rounded-lg border border-amber-300/60 bg-amber-50 px-2.5 py-1.5 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>Na fakturu už je zapsaná úhrada ({formatMoney(it.payment.paid, it.currency)}). Platby zakázky zůstanou zapsané.</span>
        </p>
      )}
    </div>
  );
}

function PeriodBar({
  period, prev, next, nextDisabled, thisMonth, today,
}: { period: IssuedPeriod; prev: IssuedPeriod; next: IssuedPeriod; nextDisabled: boolean; thisMonth: IssuedPeriod | null; today: string }) {
  const router = useRouter();
  const ty = Number(today.slice(0, 4));
  const years = Array.from({ length: 6 }, (_, i) => ty - i);
  if (period.year < ty - 5) years.push(period.year);
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="issued-period">
      <div className="flex items-center gap-1">
        <Button asChild variant="outline" size="icon" className="h-9 w-9">
          <Link href={hrefOf(prev)} aria-label={`Předchozí: ${periodLabel(prev)}`} scroll={false}><ChevronLeft className="h-4 w-4" /></Link>
        </Button>
        {period.kind === "month" ? (
          <NativeSelect
            value={String(period.month)}
            onChange={(e) => router.push(hrefOf({ kind: "month", year: period.year, month: Number(e.target.value) }), { scroll: false })}
            aria-label="Měsíc"
            icon={<CalendarDays />}
            wrapperClassName="w-36"
            className="font-semibold"
          >
            {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
              <option key={m} value={m}>{monthName(m)}</option>
            ))}
          </NativeSelect>
        ) : null}
        <NativeSelect
          value={String(period.year)}
          onChange={(e) => router.push(hrefOf(period.kind === "month" ? { ...period, year: Number(e.target.value) } : { kind: "year", year: Number(e.target.value) }), { scroll: false })}
          aria-label="Rok"
          wrapperClassName="w-24"
          className="font-semibold"
        >
          {years.sort((a, b) => b - a).map((y) => <option key={y} value={y}>{y}</option>)}
        </NativeSelect>
        {nextDisabled ? (
          <Button variant="outline" size="icon" className="h-9 w-9" disabled aria-label="Další období ještě nezačalo"><ChevronRight className="h-4 w-4" /></Button>
        ) : (
          <Button asChild variant="outline" size="icon" className="h-9 w-9">
            <Link href={hrefOf(next)} aria-label={`Další: ${periodLabel(next)}`} scroll={false}><ChevronRight className="h-4 w-4" /></Link>
          </Button>
        )}
      </div>
      <div className="inline-flex rounded-lg border bg-background p-0.5 text-sm" role="tablist" aria-label="Měsíc nebo rok">
        <Link
          href={hrefOf(period.kind === "month" ? period : { kind: "month", year: period.year, month: period.year === ty ? Number(today.slice(5, 7)) : 12 })}
          role="tab"
          aria-selected={period.kind === "month"}
          scroll={false}
          className={cn("rounded-md px-3 py-1.5 font-medium", period.kind === "month" ? "bg-emerald-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          Měsíc
        </Link>
        <Link
          href={hrefOf({ kind: "year", year: period.year })}
          role="tab"
          aria-selected={period.kind === "year"}
          scroll={false}
          className={cn("rounded-md px-3 py-1.5 font-medium", period.kind === "year" ? "bg-emerald-600 text-white shadow-sm" : "text-muted-foreground hover:text-foreground")}
        >
          Rok
        </Link>
      </div>
      {thisMonth && (
        <Link href={hrefOf(thisMonth)} scroll={false} className="text-sm font-medium text-emerald-700 hover:underline dark:text-emerald-300">
          Tento měsíc
        </Link>
      )}
    </div>
  );
}

function YearGrid({ period, items, rateOf, today }: { period: IssuedPeriod; items: IssuedInvoice[]; rateOf: (it: IssuedInvoice) => number | null; today: string }) {
  const months = byMonth(items, rateOf);
  return (
    <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6" data-testid="issued-year">
      {months.map(({ month, totals }) => {
        const p: IssuedPeriod = { kind: "month", year: period.year, month };
        const future = isFuturePeriod(p, today);
        const g = mainAmount(totals, "gross");
        return (
          <li key={month}>
            <Link
              href={hrefOf(p)}
              className={cn(
                "flex h-full flex-col rounded-xl border bg-card px-3 py-2 shadow-sm transition hover:border-emerald-500/50 hover:shadow-md",
                future && "opacity-50",
              )}
            >
              <span className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{monthShort(month)}</span>
              <span className="text-base font-semibold tabular-nums">{totals.count ? formatMoney(g.value, g.currency) : "—"}</span>
              <span className="text-[11px] text-muted-foreground">
                {totals.count} {plural(totals.count, "faktura", "faktury", "faktur")}
                {totals.unpaidCount ? ` · ${totals.unpaidCount} nezapl.` : ""}
              </span>
            </Link>
          </li>
        );
      })}
    </ul>
  );
}

function Tile({ label, value, tone, sub, subTone, strong }: { label: string; value: string; tone?: string; sub?: string; subTone?: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-xl border bg-background/70 px-3 py-2", strong && "border-emerald-300/70 dark:border-emerald-500/30")}>
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("text-base font-semibold tabular-nums sm:text-lg", tone)}>{value}</dd>
      {sub && <dd className={cn("text-[11px] text-muted-foreground", subTone)}>{sub}</dd>}
    </div>
  );
}

function StatusBadge({ it }: { it: IssuedInvoice }) {
  const meta = PAYMENT_STATE_META[it.payment.state];
  return (
    <span className="inline-flex shrink-0 flex-col items-start gap-0.5">
      <span className={cn("inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", meta.tone)} data-testid="issued-status">{meta.label}</span>
      {it.payment.state !== "zaplaceno" && it.payment.state !== "storno" && it.payment.paid > 0 && (
        <span className="text-[11px] text-muted-foreground">zbývá {formatMoney(it.payment.remaining, it.currency)}</span>
      )}
      {it.payment.state === "zaplaceno" && it.payment.paidOn && (
        <span className="text-[11px] text-muted-foreground">{dateText(it.payment.paidOn)}</span>
      )}
    </span>
  );
}

function Flags({ it }: { it: IssuedInvoice }) {
  return (
    <>
      {it.estimated && (
        <span className="whitespace-nowrap rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-500/15 dark:text-amber-300" title="Faktura je zapsaná jen u zakázky — částka odhadnutá z hodnoty zakázky">
          odhad částky
        </span>
      )}
      {it.external && !it.estimated && (
        <span className="whitespace-nowrap rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground" title="Vystavená mimo systém">mimo systém</span>
      )}
    </>
  );
}

function PdfAction({ it, compact }: { it: IssuedInvoice; compact?: boolean }) {
  if (it.file) {
    return (
      <Button asChild variant="outline" size="sm" className="h-8">
        <a href={`/api/jobs/files/${it.file.id}`} data-filename={it.file.filename} aria-label={`Otevřít ${it.file.filename}`} data-testid="issued-pdf">
          <FileText className="h-4 w-4 text-emerald-600" /> {compact ? "PDF" : "Otevřít PDF"}
        </a>
      </Button>
    );
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5 text-xs text-amber-800 dark:text-amber-300" data-testid="issued-no-pdf">
      <AlertTriangle className="h-3.5 w-3.5" /> Bez PDF
      {it.job && (
        <Link href={`/orders/${it.job.id}`} className="font-medium underline-offset-2 hover:underline">
          {it.external ? "otevřít zakázku" : "vystavit v zakázce"}
        </Link>
      )}
    </span>
  );
}

function SortHead({ label, k, sort, onSort, className }: { label: string; k: IssuedSortKey; sort: { key: IssuedSortKey; dir: "asc" | "desc" }; onSort: (k: IssuedSortKey) => void; className?: string }) {
  const on = sort.key === k;
  const Icon = sort.dir === "asc" ? ArrowUp : ArrowDown;
  return (
    <th className={cn("px-3 py-2 font-medium", className)} aria-sort={on ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}>
      <button type="button" onClick={() => onSort(k)} className={cn("inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground", on && "text-foreground")}>
        {label} {on && <Icon className="h-3.5 w-3.5" />}
      </button>
    </th>
  );
}

function InvoiceTable({
  items, sort, onSort, canDelete, onDelete,
}: { items: IssuedInvoice[]; sort: { key: IssuedSortKey; dir: "asc" | "desc" }; onSort: (k: IssuedSortKey) => void; canDelete: boolean; onDelete: (it: IssuedInvoice) => void }) {
  return (
    <div className="hidden overflow-x-auto rounded-2xl border bg-card shadow-sm md:block">
      <table className="w-full text-sm" data-testid="issued-table">
        <thead className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            <SortHead label="Číslo" k="cislo" sort={sort} onSort={onSort} />
            <SortHead label="Vystaveno" k="datum" sort={sort} onSort={onSort} />
            <th className="px-3 py-2 font-medium">Splatnost</th>
            <SortHead label="Odběratel" k="odberatel" sort={sort} onSort={onSort} />
            <th className="px-3 py-2 font-medium">Zakázka</th>
            <th className="px-3 py-2 text-right font-medium">Bez DPH</th>
            <th className="hidden px-3 py-2 text-right font-medium xl:table-cell">DPH</th>
            <SortHead label="S DPH" k="castka" sort={sort} onSort={onSort} className="text-right" />
            <th className="px-3 py-2 font-medium">Stav</th>
            <th className="px-3 py-2"><span className="sr-only">Akce</span></th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {items.map((it) => (
            <tr key={it.id} className="align-top hover:bg-muted/30" data-testid="issued-row">
              <td className="px-3 py-2.5">
                <div className="font-semibold tabular-nums">{it.number}</div>
                <div className="mt-0.5 flex flex-wrap gap-1"><Flags it={it} /></div>
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 tabular-nums">{dateText(it.issueDate)}</td>
              <td className={cn("whitespace-nowrap px-3 py-2.5 tabular-nums", it.payment.overdue && "font-medium text-rose-700 dark:text-rose-300")}>{dateText(it.dueDate)}</td>
              <td className="max-w-[16rem] px-3 py-2.5">
                {it.customer ? (
                  <Link href={`/customers/${it.customer.id}`} className="font-medium hover:underline">{it.customer.name}</Link>
                ) : <span className="text-muted-foreground">—</span>}
                {it.customer?.ico && <div className="text-xs text-muted-foreground">IČ {it.customer.ico}</div>}
              </td>
              <td className="max-w-[14rem] px-3 py-2.5">
                {it.job ? (
                  <Link href={`/orders/${it.job.id}`} className="font-medium text-emerald-700 hover:underline dark:text-emerald-300">{it.job.number ?? "zakázka"}</Link>
                ) : <span className="text-muted-foreground">—</span>}
                {it.job?.title && <div className="truncate text-xs text-muted-foreground" title={it.job.title}>{it.job.title}</div>}
              </td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right tabular-nums">{formatMoney(it.net, it.currency)}</td>
              <td className="hidden whitespace-nowrap px-3 py-2.5 text-right tabular-nums text-muted-foreground xl:table-cell">{formatMoney(it.vat, it.currency)}</td>
              <td className="whitespace-nowrap px-3 py-2.5 text-right font-semibold tabular-nums">{formatMoney(it.gross, it.currency)}</td>
              <td className="px-3 py-2.5"><StatusBadge it={it} /></td>
              <td className="px-3 py-2.5">
                <div className="flex items-center justify-end gap-1.5">
                  <PdfAction it={it} compact />
                  {canDelete && (
                    <Button type="button" variant="ghost" size="icon-sm" onClick={() => onDelete(it)} aria-label={`Smazat fakturu ${it.number}`} data-testid="issued-delete">
                      <Trash2 className="h-4 w-4 text-muted-foreground" />
                    </Button>
                  )}
                </div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function InvoiceCard({ it, canDelete, onDelete }: { it: IssuedInvoice; canDelete: boolean; onDelete: (it: IssuedInvoice) => void }) {
  return (
    <li className="rounded-2xl border bg-card p-3.5 shadow-sm" data-testid="issued-card">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold tabular-nums">{it.number}</p>
          <p className="truncate text-sm">
            {it.customer ? <Link href={`/customers/${it.customer.id}`} className="hover:underline">{it.customer.name}</Link> : <span className="text-muted-foreground">bez odběratele</span>}
          </p>
        </div>
        <StatusBadge it={it} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>Vystaveno <span className="text-foreground tabular-nums">{dateText(it.issueDate)}</span></span>
        <span className={cn(it.payment.overdue && "text-rose-700 dark:text-rose-300")}>Splatnost <span className="tabular-nums">{dateText(it.dueDate)}</span></span>
        <span>Bez DPH <span className="text-foreground tabular-nums">{formatMoney(it.net, it.currency)}</span></span>
        <span>S DPH <span className="font-semibold text-foreground tabular-nums">{formatMoney(it.gross, it.currency)}</span></span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Flags it={it} />
        {it.job && (
          <Link href={`/orders/${it.job.id}`} className="inline-flex items-center gap-1 text-xs font-medium text-emerald-700 hover:underline dark:text-emerald-300">
            <ExternalLink className="h-3.5 w-3.5" /> {it.job.number ?? "zakázka"}
          </Link>
        )}
        <span className="flex-1" />
        <PdfAction it={it} />
        {canDelete && (
          <Button type="button" variant="ghost" size="icon-sm" onClick={() => onDelete(it)} aria-label={`Smazat fakturu ${it.number}`}>
            <Trash2 className="h-4 w-4 text-muted-foreground" />
          </Button>
        )}
      </div>
    </li>
  );
}

