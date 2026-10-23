"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ShoppingBag, Search, X, Factory, CalendarClock, CalendarCheck, Send, AlertTriangle, ListChecks, Clock3, BadgeCheck,
  PackageCheck, Ban, Inbox, ArrowUpRight, ClipboardList, CircleDotDashed, type LucideIcon,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import type { PurchaseOrderListItem } from "@/lib/jobs/purchasing-types";
import { PURCHASE_ORDER_STATUS_META, filterPurchaseOrders } from "@/lib/jobs/purchasing";
import { StageBadge } from "@/components/jobs/stage-badge";
import { ToastProvider, useNotify } from "@/components/jobs/detail/toast";
import { formatMoney, longDate } from "@/components/jobs/detail/detail-helpers";
import { PageHero } from "@/components/commissions/page-hero";
import { cn } from "@/lib/utils";
import { PurchaseOrderActions } from "./purchase-order-actions";
import { PurchaseExtraChips, PurchaseStepsLine } from "./purchase-orders-section";
import { PurchaseOrderStatusBadge } from "./ui-bits";
import { isPurchaseOrderLate, matchesPurchaseFilter, type PurchaseFilter } from "./purchasing-model";

const FILTERS: { key: PurchaseFilter; label: string; icon: LucideIcon; tone: string; active: string }[] = [
  { key: "vse", label: "Aktivní", icon: ListChecks, tone: "bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300", active: "border-lime-500 ring-2 ring-lime-500/30" },
  { key: "k_odeslani", label: "K odeslání", icon: Send, tone: "bg-sky-100 text-sky-800 dark:bg-sky-500/15 dark:text-sky-300", active: "border-sky-500 ring-2 ring-sky-500/30" },
  { key: "ceka", label: "Čeká na potvrzení", icon: Clock3, tone: "bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300", active: "border-amber-500 ring-2 ring-amber-500/30" },
  { key: "potvrzena", label: "Potvrzené", icon: BadgeCheck, tone: "bg-indigo-100 text-indigo-800 dark:bg-indigo-500/15 dark:text-indigo-300", active: "border-indigo-500 ring-2 ring-indigo-500/30" },
  { key: "castecne", label: "Částečně dodané", icon: CircleDotDashed, tone: "bg-lime-100 text-lime-800 dark:bg-lime-500/15 dark:text-lime-300", active: "border-lime-500 ring-2 ring-lime-500/30" },
  { key: "dodana", label: "Dodané", icon: PackageCheck, tone: "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300", active: "border-green-500 ring-2 ring-green-500/30" },
  { key: "po_terminu", label: "Po termínu", icon: AlertTriangle, tone: "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300", active: "border-red-500 ring-2 ring-red-500/30" },
  { key: "zrusena", label: "Zrušené", icon: Ban, tone: "bg-zinc-100 text-zinc-700 dark:bg-zinc-500/15 dark:text-zinc-300", active: "border-zinc-500 ring-2 ring-zinc-500/30" },
];

function isFilter(v: unknown): v is PurchaseFilter {
  return typeof v === "string" && FILTERS.some((f) => f.key === v);
}

/** Přehled „Objednávky dodavatelům" napříč zakázkami: stavy, hledání, PDF a odeslání. */
export function PurchaseOrdersBoard(props: { items: PurchaseOrderListItem[]; today: string; initialFilter?: string; initialQuery?: string }) {
  return (
    <ToastProvider>
      <Board {...props} />
    </ToastProvider>
  );
}

function Board({
  items, today, initialFilter, initialQuery,
}: { items: PurchaseOrderListItem[]; today: string; initialFilter?: string; initialQuery?: string }) {
  const router = useRouter();
  const notify = useNotify();
  const [refreshing, startRefresh] = React.useTransition();
  const [filter, setFilter] = React.useState<PurchaseFilter>(isFilter(initialFilter) ? initialFilter : "vse");
  const [query, setQuery] = React.useState(initialQuery ?? "");
  const refresh = React.useCallback(() => startRefresh(() => router.refresh()), [router]);

  const stats = React.useMemo(() => FILTERS.map((f) => {
    const list = items.filter((po) => matchesPurchaseFilter(po, f.key, today));
    return { key: f.key, count: list.length, total: list.reduce((s, po) => s + po.total, 0) };
  }), [items, today]);
  const searched = React.useMemo(() => filterPurchaseOrders(items, query), [items, query]);
  const visible = searched.filter((po) => matchesPurchaseFilter(po, filter, today));
  const visibleTotal = visible.reduce((s, po) => s + po.total, 0);
  const lateCount = stats.find((s) => s.key === "po_terminu")?.count ?? 0;
  const toSend = stats.find((s) => s.key === "k_odeslani")?.count ?? 0;

  function pick(next: PurchaseFilter) {
    setFilter(next);
    try {
      const url = new URL(window.location.href);
      if (next === "vse") url.searchParams.delete("stav");
      else url.searchParams.set("stav", next);
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // adresa je jen pohodlí
    }
  }

  return (
    <div className={cn("space-y-4", refreshing && "opacity-80 transition-opacity")}>
      <PageHero
        tone="lime"
        icon={ShoppingBag}
        title="Objednávky dodavatelům"
        count={stats[0].count}
        description={
          <>
            Naše objednávky za Mnástrojárnu u kooperantů a dodavatelů — vystavují se na kartě zakázky (záložka <em>Nákup &amp; marže</em>) z vítězné nabídky.
            {toSend ? <> <strong>{toSend}</strong> čeká na odeslání.</> : null}
            {lateCount ? <> <strong className="text-red-600 dark:text-red-400">{lateCount}</strong> po termínu.</> : null}
          </>
        }
        actions={
          <Button asChild variant="outline">
            <Link href="/orders"><ClipboardList className="h-4 w-4" /> Kniha zakázek</Link>
          </Button>
        }
      />

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-8">
        {FILTERS.map((f) => {
          const st = stats.find((s) => s.key === f.key);
          const Icon = f.icon;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => pick(f.key)}
              aria-pressed={filter === f.key}
              className={cn(
                "flex items-center gap-2.5 rounded-xl border bg-card p-2.5 text-left shadow-sm transition hover:-translate-y-0.5 hover:shadow-md",
                filter === f.key && f.active,
              )}
            >
              <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", f.tone)}>
                <Icon className="h-4 w-4" />
              </span>
              <span className="min-w-0">
                <span className="block text-lg font-bold leading-none tabular-nums">{st?.count ?? 0}</span>
                <span className="block truncate text-[11px] text-muted-foreground">{f.label}</span>
              </span>
            </button>
          );
        })}
      </div>

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Hledej číslo objednávky, dodavatele, zakázku, zákazníka, výkres…"
            className="h-10 pl-9"
            aria-label="Hledat objednávky"
          />
          {query && (
            <button type="button" onClick={() => setQuery("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-muted-foreground hover:text-foreground" aria-label="Smazat hledání">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        <p className="shrink-0 text-sm text-muted-foreground">
          {visible.length} {visible.length === 1 ? "objednávka" : visible.length < 5 && visible.length > 0 ? "objednávky" : "objednávek"} ·{" "}
          <strong className="tabular-nums text-foreground">{formatMoney(visibleTotal)}</strong> bez DPH
        </p>
      </div>

      {items.length === 0 ? (
        <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-lime-200 bg-lime-50/40 px-4 py-12 text-center dark:border-lime-500/20 dark:bg-lime-500/5">
          <span className="flex h-12 w-12 items-center justify-center rounded-full bg-lime-100 text-lime-700 dark:bg-lime-500/15 dark:text-lime-300">
            <ShoppingBag className="h-6 w-6" />
          </span>
          <p className="font-medium">Zatím žádná objednávka dodavateli</p>
          <p className="max-w-md text-sm text-muted-foreground">
            Otevři zakázku → záložka <strong>Nákup &amp; marže</strong> → vyber vítěznou nabídku dodavatele → <strong>Vystavit objednávku</strong>. Vše se vyplní samo.
          </p>
          <Button asChild variant="success"><Link href="/orders">Otevřít Knihu zakázek</Link></Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          <Inbox className="h-8 w-8 opacity-40" />
          Nic neodpovídá {query ? "hledání" : "filtru"}.
          <Button variant="ghost" size="sm" onClick={() => { setQuery(""); pick("vse"); }}>Zobrazit vše</Button>
        </div>
      ) : (
        <ul className="space-y-2">
          {visible.map((po) => (
            <OrderRow key={po.id} po={po} today={today} notify={notify} onChanged={refresh} />
          ))}
        </ul>
      )}
    </div>
  );
}

function OrderRow({
  po, today, notify, onChanged,
}: {
  po: PurchaseOrderListItem;
  today: string;
  notify: ReturnType<typeof useNotify>;
  onChanged: () => void;
}) {
  const m = PURCHASE_ORDER_STATUS_META[po.status];
  const late = isPurchaseOrderLate(po, today);
  const cancelled = po.status === "zrusena";
  return (
    <li className={cn("relative overflow-hidden rounded-xl border bg-card shadow-sm transition hover:shadow-md", cancelled && "opacity-70")}>
      <span className={cn("absolute inset-y-0 left-0 w-1.5", m.dot)} aria-hidden />
      <div className="grid gap-3 p-3 pl-4 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.5fr)_minmax(0,1.2fr)_auto] lg:items-center">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("font-mono text-sm font-bold", cancelled && "line-through")}>{po.number}</span>
            <PurchaseOrderStatusBadge status={po.status} />
            <PurchaseExtraChips order={po} today={today} />
          </div>
          <p className="flex items-center gap-1 truncate text-sm font-medium">
            <Factory className="h-3.5 w-3.5 shrink-0 text-orange-600" /> {po.supplier?.name ?? "Dodavatel"}
          </p>
          <p className="text-base font-bold tabular-nums lg:hidden">{formatMoney(po.total, po.currency)}</p>
        </div>

        <div className="min-w-0 space-y-1">
          {po.job ? (
            <Link href={`/orders/${po.job.id}?tab=nakup`} className="group flex min-w-0 items-center gap-1.5">
              <span className="shrink-0 whitespace-nowrap font-mono text-xs font-bold text-primary group-hover:underline">{po.job.number}</span>
              <StageBadge stage={po.job.stage} size="xs" short />
              <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
            </Link>
          ) : (
            <span className="text-xs italic text-muted-foreground">bez zakázky</span>
          )}
          <p className="truncate text-xs text-muted-foreground">{[po.job?.title, po.customer?.name].filter(Boolean).join(" · ") || "—"}</p>
          {po.drawingNumbers.length > 0 && (
            <p className="truncate font-mono text-[11px] text-blue-700 dark:text-blue-400">
              {po.drawingNumbers.slice(0, 4).join(", ")}{po.drawingNumbers.length > 4 ? ` +${po.drawingNumbers.length - 4}` : ""}
            </p>
          )}
        </div>

        <dl className="grid grid-cols-3 gap-2 text-[11px] lg:grid-cols-3">
          <div>
            <dt className="flex items-center gap-1 text-muted-foreground"><CalendarClock className="h-3 w-3 text-red-500" /> Požadováno</dt>
            <dd className={cn("font-medium", late && !po.confirmedDate && "text-red-600 dark:text-red-400")}>{longDate(po.requiredDate) ?? "—"}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-muted-foreground"><CalendarCheck className="h-3 w-3 text-indigo-500" /> Potvrzeno</dt>
            <dd className={cn("font-medium", po.confirmedDate && "text-indigo-700 dark:text-indigo-300")}>{longDate(po.confirmedDate) ?? "—"}</dd>
          </div>
          <div>
            <dt className="flex items-center gap-1 text-muted-foreground"><Send className="h-3 w-3 text-red-500" /> Odesláno</dt>
            <dd className="font-medium">{po.sentAt ? longDate(po.sentAt) : "—"}</dd>
          </div>
        </dl>

        <div className="flex flex-col gap-2 lg:items-end">
          <p className="hidden text-lg font-bold tabular-nums lg:block">{formatMoney(po.total, po.currency)}</p>
          <PurchaseOrderActions order={po} notify={notify} onChanged={onChanged} />
        </div>

        <PurchaseStepsLine order={po} className="lg:col-span-4" />
      </div>
    </li>
  );
}
