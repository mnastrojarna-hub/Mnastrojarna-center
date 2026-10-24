"use client";

import * as React from "react";
import Link from "next/link";
import {
  TrendingUp, TrendingDown, Wallet, ShoppingCart, Briefcase, AlertTriangle, Coins, Minus, Equal, ArrowUpRight, Lock,
} from "lucide-react";

export const COMMISSION_HIDDEN = "Provize vidí jen obchodník zakázky a super admin.";
import { assignJobOwner } from "@/app/actions/purchasing";
import type { JobDetail } from "@/lib/jobs/types";
import type { JobPurchasing } from "@/lib/jobs/purchasing-types";
import { ROLE_LABELS } from "@/lib/auth/permissions";
import type { UserRole } from "@/lib/supabase/database.types";
import { useJobDetail } from "@/components/jobs/detail/detail-context";
import { SearchSelect } from "@/components/jobs/detail/search-select";
import { formatMoney, formatPercent } from "@/components/jobs/detail/detail-helpers";
import { cn } from "@/lib/utils";
import { commissionDisplay, marginHero, type CommissionTone } from "./purchasing-model";
import { ActorStamp } from "@/components/flow-status/actor-stamp";
import type { ChangeStamp } from "@/lib/jobs/flow-status";

const COMMISSION_TONES: Record<CommissionTone, { box: string; amount: string; chip: string }> = {
  emerald: {
    box: "border-emerald-200 bg-emerald-50/70 dark:border-emerald-500/30 dark:bg-emerald-500/10",
    amount: "text-emerald-700 dark:text-emerald-300",
    chip: "bg-emerald-600 text-white",
  },
  green: {
    box: "border-green-200 bg-green-50/70 dark:border-green-500/30 dark:bg-green-500/10",
    amount: "text-green-700 dark:text-green-300",
    chip: "bg-green-600 text-white",
  },
  sky: {
    box: "border-sky-200 bg-sky-50/70 dark:border-sky-500/30 dark:bg-sky-500/10",
    amount: "text-sky-700 dark:text-sky-300",
    chip: "bg-sky-600 text-white",
  },
  amber: {
    box: "border-amber-200 bg-amber-50/70 dark:border-amber-500/30 dark:bg-amber-500/10",
    amount: "text-amber-700 dark:text-amber-300",
    chip: "bg-amber-500 text-white",
  },
  slate: {
    box: "border-dashed bg-muted/30",
    amount: "text-muted-foreground",
    chip: "bg-muted text-muted-foreground",
  },
};

const STATUS_CHIP = { predbezna: "předběžná", k_vyplate: "k výplatě", vyplaceno: "vyplaceno" } as const;

function Amount({
  label, sub, value, icon: Icon, tone, currency,
}: {
  label: string;
  sub: string;
  value: number | null;
  icon: typeof Wallet;
  tone: string;
  currency: string;
}) {
  return (
    <div className="min-w-0 rounded-xl border bg-card/80 p-3 shadow-sm">
      <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
        <Icon className={cn("h-3.5 w-3.5", tone)} /> {label}
      </div>
      <div className="mt-1 truncate text-xl font-bold tabular-nums sm:text-2xl">
        {value === null ? <span className="text-base font-medium text-amber-600">neznámý</span> : formatMoney(value, currency)}
      </div>
      <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
    </div>
  );
}

/**
 * Hlavní karta záložky: obrat (zakázka zákazníka) − nákup (objednávky dodavatelům,
 * jinak odhad) = zisk a marže; obchodník zakázky a jeho provize dle smlouvy
 * (počítá DB — tady se jen zobrazuje).
 */
export function MarginHeroCard({
  job, data, ownerAssigned,
}: {
  job: JobDetail;
  data: JobPurchasing;
  /** Kdo naposledy přidělil obchodníka (historie zakázky). */
  ownerAssigned?: ChangeStamp | null;
}) {
  const { options, notify, refresh, perms } = useJobDetail();
  const h = marginHero(data.totals);
  const cur = job.currency;
  const owner = data.owner ?? job.owner;
  // #25: obchodníka mění jen super admin; cizí provizi vidí jen obchodník zakázky a super admin
  const ownerEditable = perms.ownerEditable ?? perms.canDelete;
  const c = data.commissionHidden
    ? { amount: null, estimate: false, title: "Provize", detail: COMMISSION_HIDDEN, status: null, tone: "slate" as const }
    : commissionDisplay(data.commission, { hasOwner: Boolean(owner), currency: cur });
  const ct = COMMISSION_TONES[c.tone];

  const userOptions = React.useMemo(() => {
    const rank = (r: string) => (r === "obchodnik" ? 0 : r === "super_admin" ? 1 : 2);
    return [...options.users]
      .sort((a, b) => rank(a.role) - rank(b.role) || a.name.localeCompare(b.name, "cs"))
      .map((u) => ({ value: u.id, label: u.name, sub: ROLE_LABELS[u.role as UserRole] ?? u.role }));
  }, [options.users]);

  async function saveOwner(next: string | null): Promise<string | null> {
    try {
      const res = await assignJobOwner(job.id, next);
      if (!res.ok) return res.error ?? "Obchodníka se nepodařilo změnit.";
      const name = userOptions.find((u) => u.value === next)?.label;
      notify("success", next ? `Zakázka přidělena: ${name ?? "obchodník"} — provize přepočítána dle jeho smlouvy.` : "Zakázka je bez obchodníka.");
      refresh();
      return null;
    } catch {
      return "Spojení se nepovedlo — zkus to znovu.";
    }
  }

  const ProfitIcon = h.profit !== null && h.profit < 0 ? TrendingDown : TrendingUp;

  return (
    <section
      className={cn(
        "relative overflow-hidden rounded-2xl border p-4 shadow-sm sm:p-5",
        h.tone === "green" && "border-green-200/80 bg-gradient-to-br from-green-50 via-card to-card dark:border-green-500/25 dark:from-green-500/10",
        h.tone === "red" && "border-red-200/80 bg-gradient-to-br from-red-50 via-card to-card dark:border-red-500/25 dark:from-red-500/10",
        h.tone === "amber" && "border-amber-200/80 bg-gradient-to-br from-amber-50 via-card to-card dark:border-amber-500/25 dark:from-amber-500/10",
        h.tone === "slate" && "bg-card",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "pointer-events-none absolute -right-16 -top-20 h-52 w-52 rounded-full blur-3xl",
          h.tone === "green" ? "bg-green-400/20" : h.tone === "red" ? "bg-red-400/20" : "bg-amber-400/15",
        )}
      />
      <div className="relative space-y-4">
        <div className="grid grid-cols-2 items-stretch gap-2 sm:grid-cols-[1fr_auto_1fr_auto_1.2fr]">
          <Amount label="Obrat" sub="objednávka zákazníka bez DPH" value={h.revenue} icon={Wallet} tone="text-sky-600" currency={cur} />
          <span className="hidden items-center justify-center text-muted-foreground sm:flex" aria-hidden><Minus className="h-5 w-5" /></span>
          <Amount label="Nákup" sub={h.costLabel} value={h.cost} icon={ShoppingCart} tone="text-orange-600" currency={cur} />
          <span className="hidden items-center justify-center text-muted-foreground sm:flex" aria-hidden><Equal className="h-5 w-5" /></span>
          <div
            className={cn(
              "col-span-2 min-w-0 rounded-xl p-3 shadow-sm sm:col-span-1",
              h.profit === null ? "border border-dashed bg-card/80" : h.profit >= 0 ? "bg-green-600 text-white shadow-green-600/25" : "bg-red-600 text-white shadow-red-600/25",
            )}
          >
            <div className={cn("flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide", h.profit === null ? "text-muted-foreground" : "text-white/85")}>
              <ProfitIcon className="h-3.5 w-3.5" /> Zisk
            </div>
            <div className="mt-0.5 truncate text-2xl font-extrabold tabular-nums sm:text-3xl">
              {h.profit === null ? <span className="text-base font-medium text-muted-foreground">—</span> : formatMoney(h.profit, cur)}
            </div>
            <div className={cn("text-xs font-medium", h.profit === null ? "text-muted-foreground" : "text-white/90")}>
              {h.margin !== null ? `marže ${formatPercent(h.margin)}` : "marže —"}
            </div>
          </div>
        </div>

        {h.revenue !== null && h.revenue > 0 && h.cost !== null && (
          <div className="space-y-1">
            <div className="flex h-3 overflow-hidden rounded-full bg-muted" role="img" aria-label={`Nákup ${h.costPct} %, zisk ${h.profitPct} % obratu`}>
              <span className="h-full bg-orange-400 transition-all dark:bg-orange-500" style={{ width: `${h.costPct}%` }} />
              <span className={cn("h-full transition-all", h.profit !== null && h.profit < 0 ? "bg-red-500" : "bg-green-500")} style={{ width: `${h.profitPct}%` }} />
            </div>
            <div className="flex justify-between text-[11px] text-muted-foreground">
              <span><span className="mr-1 inline-block h-2 w-2 rounded-full bg-orange-400" />nákup {h.costPct.toLocaleString("cs-CZ")} %</span>
              <span>zisk {h.profitPct.toLocaleString("cs-CZ")} % <span className="ml-1 inline-block h-2 w-2 rounded-full bg-green-500" /></span>
            </div>
          </div>
        )}

        {(h.missingCost || h.missingRevenue) && (
          <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            <span>
              {h.missingRevenue
                ? "Zakázka nemá hodnotu objednávky zákazníka — doplň ji v Přehledu, ať jde spočítat zisk."
                : "Doplň nákupní cenu nebo vystav objednávku dodavateli — pak se spočítá zisk i provize."}
            </span>
          </div>
        )}

        <div className="grid gap-2 sm:grid-cols-2">
          <div className="rounded-xl border bg-card/80 px-3 py-2.5 shadow-sm">
            {ownerEditable ? (
              <SearchSelect
                label="Obchodník (provize dle jeho smlouvy)"
                icon={Briefcase}
                iconClass="text-emerald-600"
                value={owner?.id ?? null}
                valueLabel={owner?.name}
                options={userOptions}
                emptyLabel="Přidělit obchodníka…"
                placeholder="Hledej jméno…"
                onSave={saveOwner}
              />
            ) : (
              <div className="min-w-0" data-field="owner-readonly">
                <div className="mb-0.5 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                  <Briefcase className="h-3.5 w-3.5 text-emerald-600" aria-hidden /> Obchodník (provize dle jeho smlouvy)
                  <Lock className="h-3 w-3" aria-label="jen pro čtení" />
                </div>
                <div className="truncate text-sm font-medium">{owner?.name ?? "—"}</div>
                <p className="text-[11px] text-muted-foreground">Obchodníka zakázky mění jen super admin.</p>
              </div>
            )}
            {ownerAssigned && owner && <ActorStamp verb="Přidělení" stamp={ownerAssigned} short className="mt-0.5" />}
          </div>
          <div className={cn("flex items-center gap-3 rounded-xl border px-3 py-2.5", ct.box)}>
            <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg", ct.chip)}>
              <Coins className="h-5 w-5" />
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-1.5 text-xs font-medium text-muted-foreground">
                {c.title}
                {c.status && !c.title.toLowerCase().includes(STATUS_CHIP[c.status].slice(0, 6)) && (
                  <span className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold", ct.chip)}>{STATUS_CHIP[c.status]}</span>
                )}
              </div>
              <div className={cn("text-lg font-bold tabular-nums", ct.amount)}>
                {c.amount === null ? "—" : `${c.estimate ? "odhad " : ""}${formatMoney(c.amount, cur)}`}
              </div>
              <div className="text-[11px] leading-snug text-muted-foreground">{c.detail}</div>
            </div>
            {data.commission && (
              <Link href="/commissions" className="shrink-0 rounded-md p-1 text-muted-foreground transition hover:bg-background/70 hover:text-foreground" title="Provize — měsíční vyúčtování" aria-label="Otevřít provize">
                <ArrowUpRight className="h-4 w-4" />
              </Link>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
