"use client";

import * as React from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  AlertTriangle, CalendarClock, CheckCircle2, Copy, Factory, Filter, ListChecks, ReceiptText, Search, SlidersHorizontal, Sparkles, Upload, Wallet, X,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/jobs/book/native-select";
import { PageHero } from "@/components/commissions/page-hero";
import { formatMoney, dateText } from "@/components/supplier-invoices/format";
import { VisibilitySwitch } from "@/components/supplier-invoices/visibility-switch";
import { INVOICE_STATUS_META, PAYMENT_STATUS_META, type SupplierInvoiceListItem, type SupplierInvoicePerms, type SupplierInvoiceTotals } from "@/lib/supplier-invoices/types";
import type { SupplierInvoiceVisibility } from "@/lib/supplier-invoices/access";
import { cn } from "@/lib/utils";

export type ListView = "vse" | "ke_kontrole" | "neprirazene" | "nezaplacene" | "po_splatnosti" | "duplicity";

const VIEWS: { key: ListView; label: string; icon: LucideIcon; paid?: boolean }[] = [
  { key: "vse", label: "Vše", icon: ListChecks },
  { key: "ke_kontrole", label: "Ke kontrole", icon: Sparkles },
  { key: "neprirazene", label: "Nepřiřazené", icon: Filter },
  { key: "nezaplacene", label: "Nezaplacené", icon: Wallet, paid: true },
  { key: "po_splatnosti", label: "Po splatnosti", icon: AlertTriangle, paid: true },
  { key: "duplicity", label: "Duplicity", icon: Copy },
];

export interface InvoiceListProps {
  items: SupplierInvoiceListItem[];
  totals: SupplierInvoiceTotals;
  suppliers: { id: string; name: string }[];
  perms: SupplierInvoicePerms;
  filter: { view: ListView; supplierId: string; jobId: string; from: string; to: string; q: string; period: string };
  /** Jen super admin: přepínač viditelnosti. */
  visibility?: SupplierInvoiceVisibility | null;
  today: string;
}

function periodRange(key: string, today: string): { from: string; to: string } | null {
  const [y, m] = today.split("-").map(Number);
  const iso = (yy: number, mm: number, dd: number) => `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
  const last = (yy: number, mm: number) => new Date(Date.UTC(yy, mm, 0)).getUTCDate();
  if (key === "mesic") return { from: iso(y, m, 1), to: iso(y, m, last(y, m)) };
  if (key === "minuly") { const py = m === 1 ? y - 1 : y; const pm = m === 1 ? 12 : m - 1; return { from: iso(py, pm, 1), to: iso(py, pm, last(py, pm)) }; }
  if (key === "kvartal") { const q0 = Math.floor((m - 1) / 3) * 3 + 1; return { from: iso(y, q0, 1), to: iso(y, q0 + 2, last(y, q0 + 2)) }; }
  if (key === "rok") return { from: iso(y, 1, 1), to: iso(y, 12, 31) };
  return null;
}

export function InvoiceList({ items, totals, suppliers, perms, filter, visibility, today }: InvoiceListProps) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, start] = React.useTransition();
  const [q, setQ] = React.useState(filter.q);

  const go = React.useCallback((patch: Partial<InvoiceListProps["filter"]>) => {
    const next = { ...filter, ...patch };
    const sp = new URLSearchParams();
    if (next.view !== "vse") sp.set("stav", next.view);
    if (next.supplierId) sp.set("dodavatel", next.supplierId);
    if (next.jobId) sp.set("zakazka", next.jobId);
    if (next.period) sp.set("obdobi", next.period);
    if (next.period === "vlastni") {
      if (next.from) sp.set("od", next.from);
      if (next.to) sp.set("do", next.to);
    }
    if (next.q) sp.set("q", next.q);
    const qs = sp.toString();
    start(() => router.push(qs ? `${pathname}?${qs}` : pathname));
  }, [filter, pathname, router]);

  React.useEffect(() => {
    if (q === filter.q) return;
    const t = window.setTimeout(() => go({ q }), 350);
    return () => window.clearTimeout(t);
  }, [q, filter.q, go]);

  const jobs = React.useMemo(() => {
    const m = new Map<string, string>();
    for (const it of items) for (const j of it.jobs) m.set(j.id, j.number);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1], "cs"));
  }, [items]);
  const views = VIEWS.filter((v) => !v.paid || perms.paid);
  const active = filter.supplierId || filter.jobId || filter.period || filter.q;
  // mobil: dodavatel / zakázka / období schované pod „Filtry" (první faktura je vidět bez posouvání)
  const moreActive = [filter.supplierId, filter.jobId, filter.period].filter(Boolean).length;
  const [showMore, setShowMore] = React.useState(moreActive > 0);

  return (
    <div className={cn("space-y-4", pending && "opacity-80 transition-opacity")}>
      <PageHero
        tone="emerald"
        icon={ReceiptText}
        title="Faktury dodavatelů"
        count={totals.count}
        description={
          <>
            Přijaté faktury — AI přečte hlavičku i položky a navrhne rozdělení na zakázky (nebo režii); ty jen potvrdíš.
            {perms.paid ? " Zaplaceno / nezaplaceno vidí jen super admin." : null}
          </>
        }
        actions={
          <Button asChild variant="success" size="lg" className="h-11">
            <Link href="/supplier-invoices/upload"><Upload className="h-4 w-4" /> Nahrát fakturu</Link>
          </Button>
        }
      >
        {perms.amounts && (
          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4" data-testid="invoice-totals">
            <Tile label="Celkem bez DPH" value={formatMoney(totals.net)} />
            <Tile label="Celkem s DPH" value={formatMoney(totals.gross)} />
            {perms.paid && <Tile label="Nezaplaceno" value={formatMoney(totals.unpaid)} tone={totals.unpaid ? "text-rose-700 dark:text-rose-300" : undefined} sub={totals.overdue ? `po splatnosti ${formatMoney(totals.overdue)}` : undefined} />}
            <Tile label="Nepřiřazeno k zakázkám" value={formatMoney(totals.unallocated)} tone={totals.unallocated ? "text-amber-700 dark:text-amber-300" : undefined} />
          </dl>
        )}
        {perms.amounts && (totals.foreign?.length ?? 0) > 0 && (
          // cizí měna bez kurzu se do Kč nesčítá (nikdy 1:1) — zvlášť po měnách
          <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-amber-800 dark:text-amber-300" data-testid="invoice-totals-foreign">
            <AlertTriangle className="h-3.5 w-3.5" /> Bez kurzu (mimo součty v Kč):
            {totals.foreign!.map((f) => (
              <span key={f.currency} className="font-medium tabular-nums">{formatMoney(f.net, f.currency)} bez DPH ({f.count} {f.count === 1 ? "faktura" : f.count < 5 ? "faktury" : "faktur"})</span>
            ))}
          </p>
        )}
      </PageHero>

      <div className="space-y-2.5 rounded-2xl border bg-card p-2.5 shadow-sm sm:p-3">
        <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-0.5" role="tablist" aria-label="Filtr faktur">
          {views.map((v) => {
            const Icon = v.icon;
            const on = filter.view === v.key;
            return (
              <button
                key={v.key}
                type="button"
                role="tab"
                aria-selected={on}
                onClick={() => go({ view: v.key })}
                className={cn(
                  "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-sm font-medium transition",
                  on ? "border-emerald-600 bg-emerald-600 text-white shadow-sm" : "bg-background hover:bg-accent",
                )}
              >
                <Icon className="h-4 w-4" /> {v.label}
              </button>
            );
          })}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Číslo faktury, dodavatel, zakázka…" className="h-9 pl-9 text-base sm:text-sm" aria-label="Hledat faktury" />
          </div>
          <Button
            type="button"
            variant={moreActive ? "secondary" : "outline"}
            className="h-9 sm:hidden"
            aria-expanded={showMore}
            onClick={() => setShowMore((v) => !v)}
            data-testid="invoice-filters-toggle"
          >
            <SlidersHorizontal className="h-4 w-4" /> Filtry{moreActive ? ` (${moreActive})` : ""}
          </Button>
          <div className={cn("col-span-2 grid grid-cols-1 gap-2 sm:col-span-1 sm:contents", !showMore && "hidden")}>
          <NativeSelect value={filter.supplierId} onChange={(e) => go({ supplierId: e.target.value })} icon={<Factory />} active={Boolean(filter.supplierId)} aria-label="Dodavatel">
            <option value="">Všichni dodavatelé</option>
            {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </NativeSelect>
          <NativeSelect value={filter.jobId} onChange={(e) => go({ jobId: e.target.value })} icon={<ListChecks />} active={Boolean(filter.jobId)} aria-label="Zakázka">
            <option value="">Všechny zakázky</option>
            {filter.jobId && !jobs.some(([id]) => id === filter.jobId) && <option value={filter.jobId}>vybraná zakázka</option>}
            {jobs.map(([id, num]) => <option key={id} value={id}>{num}</option>)}
          </NativeSelect>
          <NativeSelect
            value={filter.period}
            onChange={(e) => {
              const p = e.target.value;
              const r = periodRange(p, today);
              go({ period: p, from: r?.from ?? (p === "vlastni" ? filter.from : ""), to: r?.to ?? (p === "vlastni" ? filter.to : "") });
            }}
            icon={<CalendarClock />}
            active={Boolean(filter.period)}
            aria-label="Období"
          >
            <option value="">Celé období</option>
            <option value="mesic">Tento měsíc</option>
            <option value="minuly">Minulý měsíc</option>
            <option value="kvartal">Tento kvartál</option>
            <option value="rok">Letos</option>
            <option value="vlastni">Vlastní…</option>
          </NativeSelect>
          </div>
        </div>
        {filter.period === "vlastni" && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <label className="flex items-center gap-1.5">od <Input type="date" value={filter.from} onChange={(e) => go({ from: e.target.value })} className="h-9 w-auto" /></label>
            <label className="flex items-center gap-1.5">do <Input type="date" value={filter.to} onChange={(e) => go({ to: e.target.value })} className="h-9 w-auto" /></label>
          </div>
        )}
        {active && (
          <button type="button" onClick={() => { setQ(""); go({ supplierId: "", jobId: "", period: "", from: "", to: "", q: "" }); }} className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground">
            <X className="h-3.5 w-3.5" /> Zrušit filtry
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-2xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          <ReceiptText className="mx-auto mb-2 h-8 w-8 text-emerald-500" />
          {filter.view === "vse" && !active ? "Zatím žádná faktura — vyfoť ji nebo nahraj PDF." : "Nic tomu neodpovídá."}
        </div>
      ) : (
        <ul className="grid grid-cols-1 gap-2.5 lg:grid-cols-2" data-testid="invoice-list">
          {items.map((it) => <InvoiceCard key={it.id} it={it} perms={perms} />)}
        </ul>
      )}

      {visibility && <VisibilitySwitch value={visibility} />}
    </div>
  );
}

function Tile({ label, value, tone, sub }: { label: string; value: string; tone?: string; sub?: string }) {
  return (
    <div className="rounded-xl border bg-background/70 px-3 py-2">
      <dt className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">{label}</dt>
      <dd className={cn("text-base font-semibold tabular-nums", tone)}>{value}</dd>
      {sub && <dd className="text-[11px] text-rose-700 dark:text-rose-300">{sub}</dd>}
    </div>
  );
}

function InvoiceCard({ it, perms }: { it: SupplierInvoiceListItem; perms: SupplierInvoicePerms }) {
  const st = INVOICE_STATUS_META[it.status];
  const pay = it.paymentStatus ? PAYMENT_STATUS_META[it.paymentStatus] : null;
  return (
    <li>
      <Link
        href={`/supplier-invoices/${it.id}`}
        data-testid="invoice-card"
        className="flex h-full flex-col gap-2 rounded-2xl border bg-card p-3.5 shadow-sm transition hover:border-emerald-500/50 hover:shadow-md"
      >
        <div className="flex items-start gap-2">
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{it.supplierName || "Dodavatel zatím nepřečten"}</p>
            <p className="text-xs text-muted-foreground">
              {it.number ? <>č. <span className="font-mono">{it.number}</span></> : "bez čísla"}
              {it.issueDate ? <> · vystaveno {dateText(it.issueDate)}</> : null}
            </p>
          </div>
          {perms.amounts && it.totalGross !== null && (
            <p className="shrink-0 text-right">
              <span className="block text-base font-semibold tabular-nums">{formatMoney(it.totalGross, it.currency)}</span>
              {it.totalNet !== null && <span className="block text-[11px] text-muted-foreground">{formatMoney(it.totalNet, it.currency)} bez DPH</span>}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-xs">
          <span className={cn("rounded-full px-2 py-0.5 font-medium", st.tone)}>{st.label}</span>
          {pay && <span className={cn("rounded-full px-2 py-0.5 font-medium", pay.tone)} data-testid="invoice-paid">{pay.label}</span>}
          {it.overdue && <span className="rounded-full bg-red-600 px-2 py-0.5 font-semibold text-white">po splatnosti {dateText(it.dueDate)}</span>}
          {!it.overdue && it.dueDate && perms.paid && it.paymentStatus !== "zaplaceno" && <span className="text-muted-foreground">splatnost {dateText(it.dueDate)}</span>}
          {it.pendingAi > 0 && <span className="inline-flex items-center gap-1 rounded-full bg-fuchsia-100 px-2 py-0.5 font-medium text-fuchsia-800 dark:bg-fuchsia-500/15 dark:text-fuchsia-300"><Sparkles className="h-3 w-3" /> AI návrh čeká</span>}
          {it.duplicateOfId && <span className="rounded-full bg-slate-200 px-2 py-0.5 font-medium text-slate-800 dark:bg-slate-500/20 dark:text-slate-200">duplicita</span>}
          {it.isProforma && <span className="rounded-full bg-sky-100 px-2 py-0.5 font-medium text-sky-800 dark:bg-sky-500/15 dark:text-sky-300">zálohová</span>}
          {perms.amounts && it.missingRate && !it.isProforma && <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-300" data-testid="invoice-card-norate">chybí kurz</span>}
          {perms.paid && it.paymentStatus === "castecne" && it.paidAmount !== null && (
            <span className="text-muted-foreground">uhrazeno {formatMoney(it.paidAmount, it.currency)}</span>
          )}
          {perms.amounts && (it.unallocated ?? 0) > 0.004 && !it.duplicateOfId && (
            <span className="rounded-full bg-amber-100 px-2 py-0.5 font-medium text-amber-900 dark:bg-amber-500/15 dark:text-amber-300">nepřiřazeno {formatMoney(it.unallocated, it.currency)}</span>
          )}
          {perms.amounts && it.unallocated === 0 && it.status === "zpracovano" && <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="h-3.5 w-3.5" /> rozděleno</span>}
        </div>
        {(it.jobs.length > 0 || it.hasOverhead) && (
          <div className="flex flex-wrap gap-1">
            {it.jobs.map((j) => <span key={j.id} className="rounded-md border bg-background px-1.5 py-0.5 font-mono text-[11px]">{j.number}</span>)}
            {it.hasOverhead && <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[11px] text-slate-700 dark:bg-slate-500/15 dark:text-slate-300">režie</span>}
          </div>
        )}
        {it.uploadedByName && <p className="mt-auto text-[11px] text-muted-foreground">nahrál {it.uploadedByName}</p>}
      </Link>
    </li>
  );
}
