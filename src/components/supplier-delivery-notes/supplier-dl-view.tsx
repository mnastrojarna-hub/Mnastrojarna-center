"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, ExternalLink, FileText, Search, Truck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { inPeriod, matchesDl, periodKey, type DlPeriod, type SupplierDlRow } from "@/lib/supplier-delivery-notes/model";

const MONTHS = ["leden", "únor", "březen", "duben", "květen", "červen", "červenec", "srpen", "září", "říjen", "listopad", "prosinec"];
const czDate = (iso: string) => {
  const [y, m, d] = iso.split("-").map(Number);
  return y && m && d ? `${d}. ${m}. ${y}` : iso;
};
function label(p: DlPeriod): string {
  return p.kind === "all" ? "Vše" : p.kind === "year" ? `Rok ${p.year}` : `${MONTHS[p.month - 1]} ${p.year}`;
}
function shift(p: DlPeriod, by: number, today: string): DlPeriod {
  if (p.kind === "all") return { kind: "month", year: +today.slice(0, 4), month: +today.slice(5, 7) };
  if (p.kind === "year") return { kind: "year", year: p.year + by };
  const n = p.year * 12 + (p.month - 1) + by;
  return { kind: "month", year: Math.floor(n / 12), month: (n % 12) + 1 };
}

/** Kniha dodacích listů dodavatelů: období, hledání, řádky s odkazy na zakázku, objednávku a PDF. */
export function SupplierDlView({ rows, period, today, initialQuery }: { rows: SupplierDlRow[]; period: DlPeriod; today: string; initialQuery: string }) {
  const [q, setQ] = React.useState(initialQuery);
  // hledání jde přes všechna období (jako hledání čísla dokladu)
  const items = React.useMemo(() => rows.filter((r) => (q.trim() ? matchesDl(r, q) : inPeriod(r.date, period))), [rows, q, period]);
  const href = (p: DlPeriod) => `/supplier-delivery-notes?obdobi=${periodKey(p)}`;
  const year = period.kind === "all" ? +today.slice(0, 4) : period.year;
  return (
    <div className="space-y-3" data-testid="supplier-dl-page">
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="flex items-center gap-2 text-lg font-semibold tracking-tight"><Truck className="h-5 w-5 text-sky-600" /> Dodací listy dodavatelů</h1>
        <span className="text-xs text-muted-foreground">{items.length} {items.length === 1 ? "dodací list" : items.length >= 2 && items.length <= 4 ? "dodací listy" : "dodacích listů"}</span>
        <div className="ml-auto flex flex-wrap items-center gap-1 text-sm">
          {period.kind !== "all" && (
            <Link href={href(shift(period, -1, today))} className="rounded-md border p-1.5 hover:bg-accent" aria-label="Předchozí období"><ChevronLeft className="h-4 w-4" /></Link>
          )}
          <span className="min-w-[8rem] text-center font-medium capitalize" data-testid="supplier-dl-period">{label(period)}</span>
          {period.kind !== "all" && (
            <Link href={href(shift(period, 1, today))} className="rounded-md border p-1.5 hover:bg-accent" aria-label="Další období"><ChevronRight className="h-4 w-4" /></Link>
          )}
          <Link href={href({ kind: "month", year: +today.slice(0, 4), month: +today.slice(5, 7) })} className={cn("rounded-md border px-2 py-1 text-xs hover:bg-accent", period.kind === "month" && "bg-accent")}>Měsíc</Link>
          <Link href={href({ kind: "year", year })} className={cn("rounded-md border px-2 py-1 text-xs hover:bg-accent", period.kind === "year" && "bg-accent")}>Rok</Link>
          <Link href={href({ kind: "all" })} className={cn("rounded-md border px-2 py-1 text-xs hover:bg-accent", period.kind === "all" && "bg-accent")}>Vše</Link>
        </div>
      </div>
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
        <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Hledat (číslo DL, dodavatel, objednávka, zakázka…)" className="pl-8" data-testid="supplier-dl-search" />
      </div>
      {items.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground" data-testid="supplier-dl-empty">
          {q.trim() ? "Nic nenalezeno." : "V tomto období žádný dodací list dodavatele. Dodací listy přibývají samy z focení, e-mailu a nahraných dokladů u zakázek."}
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="hidden grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)_8rem_minmax(0,1.2fr)_2.5rem] gap-3 border-b bg-muted/40 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground md:grid">
            <span>Datum</span><span>Číslo DL</span><span>Dodavatel</span><span>Objednávka</span><span>Zakázka</span><span />
          </div>
          <ul className="divide-y" data-testid="supplier-dl-list">
            {items.map((r) => (
              <li key={r.fileId} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-3 py-2 text-sm md:grid-cols-[6.5rem_minmax(0,1fr)_minmax(0,1fr)_8rem_minmax(0,1.2fr)_2.5rem] md:items-center" data-testid="supplier-dl-row">
                <span className="tabular-nums text-muted-foreground md:text-foreground">{czDate(r.date)}</span>
                <span className="truncate font-medium md:order-none" title={r.filename}>{r.number ?? <span className="text-muted-foreground">{r.title || r.filename}</span>}</span>
                <span className="truncate">{r.supplierName ?? <span className="text-muted-foreground">—</span>}</span>
                <span className="truncate">
                  {r.purchaseOrderNumber
                    ? r.purchaseOrderId
                      ? <Link href={`/orders/${r.jobId}?tab=nakup`} className="text-primary hover:underline">{r.purchaseOrderNumber}</Link>
                      : r.purchaseOrderNumber
                    : <span className="text-muted-foreground">—</span>}
                </span>
                <span className="min-w-0 truncate">
                  <Link href={`/orders/${r.jobId}?tab=dokumenty`} className="font-medium text-primary hover:underline">{r.jobNumber}</Link>
                  {r.jobTitle && <span className="text-muted-foreground"> · {r.jobTitle}</span>}
                  {r.customerName && <span className="text-muted-foreground"> · {r.customerName}</span>}
                </span>
                <a href={`/api/jobs/files/${r.fileId}`} target="_blank" rel="noopener noreferrer" className="justify-self-end rounded-md p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground" aria-label={`Otevřít ${r.filename}`} title="Otevřít dodací list">
                  <span className="sr-only">PDF</span><FileText className="h-4 w-4 md:hidden" /><ExternalLink className="hidden h-4 w-4 md:block" />
                </a>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </div>
  );
}
