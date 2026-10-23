"use client";

import * as React from "react";
import Link from "next/link";
import {
  Wallet, ShoppingCart, TrendingUp, Coins, CalendarClock, AlertTriangle, CheckCircle2, Loader2, Undo2, CircleDollarSign,
  BadgeCheck, Clock3, ArrowUpRight, ChevronDown, Trash2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { markStatementPaid } from "@/app/actions/commission-rules";
import { StageBadge } from "@/components/jobs/stage-badge";
import { cn } from "@/lib/utils";
import { BandBar } from "./band-bar";
import {
  ENTRY_STATUS_META, STATEMENT_STATUS_META, commissionPending, commissionPendingText, czDay, czk, entriesOfStatement,
  formatStamp, monthLabel, statementDue,
  type CommissionEntryView, type CommissionStatementView,
} from "./model";

const JOBS_SHOWN = 8;

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function Kpi({ label, value, sub, icon: Icon, tone, big }: { label: string; value: string; sub?: string; icon: typeof Wallet; tone: string; big?: boolean }) {
  return (
    <div className={cn("min-w-0 rounded-xl border p-3", big ? "border-emerald-300 bg-emerald-600 text-white shadow-md shadow-emerald-600/25 dark:border-emerald-500/40" : "bg-card")}>
      <div className={cn("flex items-center gap-1.5 text-xs font-medium", big ? "text-white/85" : "text-muted-foreground")}>
        <Icon className={cn("h-3.5 w-3.5", big ? "text-white" : tone)} /> {label}
      </div>
      <div className={cn("mt-0.5 truncate font-bold tabular-nums", big ? "text-2xl sm:text-3xl" : "text-lg")}>{value}</div>
      {sub && <div className={cn("truncate text-[11px]", big ? "text-white/85" : "text-muted-foreground")}>{sub}</div>}
    </div>
  );
}

/**
 * Měsíční vyúčtování provize: inkaso / obrat, náklad, zisk, provize, splatnost,
 * rozpad do pásem a zakázky měsíce. Super admin označí vyplacení (DB zamkne čísla).
 */
export function StatementCard({
  statement, entries, today, showOwner, canPay, onNotify, onChanged,
}: {
  statement: CommissionStatementView;
  entries: CommissionEntryView[];
  today: string;
  showOwner?: boolean;
  /** Super admin — smí označit vyplacení. */
  canPay?: boolean;
  onNotify?: (tone: "success" | "error", text: string) => void;
  onChanged?: () => void;
}) {
  const st = statement;
  const meta = STATEMENT_STATUS_META[st.status];
  const due = statementDue(st, today);
  const all = entriesOfStatement(entries, st);
  const jobs = all.filter((e) => e.job);
  const orphans = all.filter((e) => !e.job);
  // jen provize ze zisku čekají na nákupní cenu (provize z obratu se počítá i vyplácí)
  const pendingCount = all.filter(commissionPending).length;
  const [expanded, setExpanded] = React.useState(false);
  const shown = expanded ? jobs : jobs.slice(0, JOBS_SHOWN);
  const collected = st.basis === "collected";
  const margin = st.revenue > 0 ? st.profit / st.revenue : null;
  const [paidAt, setPaidAt] = React.useState(today);
  const [busy, setBusy] = React.useState(false);

  async function pay(date: string | null) {
    setBusy(true);
    try {
      const res = await markStatementPaid(st.id, date);
      if (!res.ok) onNotify?.("error", res.error ?? "Výplatu se nepodařilo uložit.");
      else {
        onNotify?.("success", date ? `Provize ${st.ownerName} za ${monthLabel(st.period)} označena jako vyplacená.` : "Výplata vrácena — provize se znovu přepočítala.");
        onChanged?.();
      }
    } catch {
      onNotify?.("error", "Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="overflow-hidden rounded-2xl border bg-card shadow-sm">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b bg-muted/30 px-4 py-3">
        <div className="min-w-0">
          <h3 className="flex flex-wrap items-center gap-2 text-base font-semibold">
            {capital(monthLabel(st.period))}
            {showOwner && <span className="font-normal text-muted-foreground">· {st.ownerName}</span>}
            <span title={meta.hint} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium", meta.badge)}>
              <span className={cn("h-1.5 w-1.5 rounded-full", meta.dot)} /> {meta.label}
            </span>
          </h3>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {st.ruleName ?? (collected ? "Pásmová provize z inkasa" : "Provize ze zakázek měsíce")}
            {" · "}{st.jobsCount} {st.jobsCount === 1 ? "zakázka" : st.jobsCount < 5 ? "zakázky" : "zakázek"}
          </p>
        </div>
        <span
          className={cn(
            "inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold",
            due.overdue ? "bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300"
              : st.status === "vyplaceno" ? "bg-green-100 text-green-800 dark:bg-green-500/15 dark:text-green-300"
                : "bg-muted text-muted-foreground",
          )}
        >
          {st.status === "vyplaceno" ? <BadgeCheck className="h-3.5 w-3.5" /> : <CalendarClock className="h-3.5 w-3.5" />} {due.label}
          {st.status === "vyplaceno" && st.paidBy ? ` · označil ${st.paidBy}` : ""}
        </span>
      </header>

      <div className="space-y-4 p-4">
        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <Kpi label={collected ? "Inkaso" : "Obrat"} value={czk(st.revenue)} sub={collected ? "zaplaceno zákazníky v měsíci" : "objednávky měsíce bez DPH"} icon={Wallet} tone="text-sky-600" />
          <Kpi label="Náklad" value={czk(st.cost)} sub="nákup od dodavatelů" icon={ShoppingCart} tone="text-orange-600" />
          <Kpi label="Zisk" value={czk(st.profit)} sub={margin !== null ? `marže ${Math.round(margin * 1000) / 10} %`.replace(".", ",") : undefined} icon={TrendingUp} tone="text-green-600" />
          <Kpi label="Provize" value={czk(st.commission)} sub={st.status === "otevrena" ? "průběžně — měsíc běží" : st.status === "vyplaceno" ? "vyplaceno" : "k výplatě"} icon={Coins} tone="" big />
        </div>

        {pendingCount > 0 ? (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            {pendingCount} {pendingCount === 1 ? "zakázka čeká" : pendingCount < 5 ? "zakázky čekají" : "zakázek čeká"} na nákupní cenu — provize se {pendingCount === 1 ? "jí" : "jim"} zatím nepočítá ani nevyplácí. Doplň ceny v objednávce dodavateli (nebo nákup) a provize se dopočítá sama.
          </p>
        ) : st.unknownCostJobs > 0 && (
          <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" />
            {st.unknownCostJobs} {st.unknownCostJobs === 1 ? "zakázka nemá" : st.unknownCostJobs < 5 ? "zakázky nemají" : "zakázek nemá"} nákupní cenu — jejich zisk se zatím nepočítá. Doplň nákup nebo vystav objednávku dodavateli.
          </p>
        )}

        {st.bands.length > 0 && <BandBar bands={st.bands} revenue={st.revenue} showNext={st.status === "otevrena"} />}

        {all.length > 0 && (
          <div className="overflow-hidden rounded-xl border">
            <div className="hidden grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))_minmax(0,1fr)] gap-3 bg-muted/40 px-3 py-1.5 text-[11px] font-medium text-muted-foreground md:grid">
              <span>Zakázka</span>
              <span className="text-right">{collected ? "Inkaso" : "Obrat"}</span>
              <span className="text-right">Zisk</span>
              <span className="text-right">Provize</span>
              <span className="text-right">Stav</span>
            </div>
            <ul className="divide-y">
              {shown.map((e) => <EntryRow key={e.id} entry={e} />)}
              {orphans.length > 0 && <OrphanRow entries={orphans} />}
            </ul>
            {jobs.length > JOBS_SHOWN && (
              <button
                type="button"
                onClick={() => setExpanded((x) => !x)}
                className="flex w-full items-center justify-center gap-1 border-t bg-muted/30 py-2 text-xs font-medium text-muted-foreground transition hover:bg-muted/60 hover:text-foreground"
              >
                <ChevronDown className={cn("h-3.5 w-3.5 transition", expanded && "rotate-180")} />
                {expanded ? "Méně zakázek" : `Zobrazit všech ${jobs.length} zakázek`}
              </button>
            )}
          </div>
        )}

        {canPay && st.status !== "otevrena" && (
          <div className="flex flex-col gap-2 rounded-xl border border-dashed p-3 sm:flex-row sm:items-center">
            {st.status === "k_vyplate" ? (
              <>
                <CircleDollarSign className="hidden h-5 w-5 text-emerald-600 sm:block" />
                <span className="flex-1 text-sm">Vyplatit <strong className="tabular-nums">{czk(st.commission)}</strong> obchodníkovi {st.ownerName}</span>
                <Input type="date" value={paidAt} max={today} onChange={(e) => setPaidAt(e.target.value)} className="h-9 sm:w-40" aria-label="Datum výplaty" />
                <Button variant="success" onClick={() => void pay(paidAt || today)} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Označit jako vyplacené
                </Button>
              </>
            ) : (
              <>
                <BadgeCheck className="hidden h-5 w-5 text-green-600 sm:block" />
                <span className="flex-1 text-sm text-muted-foreground">
                  Vyplaceno{st.paidAt ? ` ${czDay(st.paidAt)}` : ""}
                  {st.paidBy ? <> — označil <strong className="text-foreground">{st.paidBy}</strong>{st.paidMarkedAt ? ` · ${formatStamp(st.paidMarkedAt)}` : ""}</> : null}
                  . Čísla vyúčtování i zakázek jsou zamčená.
                </span>
                <Button variant="ghost" size="sm" onClick={() => void pay(null)} disabled={busy}>
                  {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Undo2 className="h-4 w-4" />} Vrátit výplatu
                </Button>
              </>
            )}
          </div>
        )}
      </div>
    </article>
  );
}

/** Řádek zakázky v provizích (vyúčtování i předběžné). */
export function EntryRow({ entry: e, estimate }: { entry: CommissionEntryView; estimate?: boolean }) {
  const pending = commissionPending(e);
  // čekající provize není „K výplatě" (DB ji drží jako předběžnou; starší řádky taky tak ukážeme)
  const meta = ENTRY_STATUS_META[pending && e.status === "k_vyplate" ? "predbezna" : e.status];
  const amount = estimate ? e.estimatedCommission : e.commission;
  // náklad neznámý → žádná „0 Kč": provize čeká na nákupní cenu (a do výplaty se nepočítá)
  const amountNode = pending
    ? <span className="text-xs font-semibold text-amber-600 dark:text-amber-400" title="Do výplaty se nepočítá — dopočítá se po doplnění nákupních cen.">{commissionPendingText(e)}</span>
    : <>{estimate && amount !== null ? "≈ " : ""}{amount === null ? "—" : czk(amount)}</>;
  return (
    <li className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-3 py-2.5 text-sm md:grid-cols-[minmax(0,2.2fr)_repeat(3,minmax(0,1fr))_minmax(0,1fr)]">
      <div className="min-w-0">
        {e.job ? (
          <Link href={`/orders/${e.job.id}?tab=nakup`} className="group inline-flex max-w-full items-center gap-1.5">
            <span className="shrink-0 whitespace-nowrap font-mono text-xs font-bold text-primary group-hover:underline">{e.job.number}</span>
            <StageBadge stage={e.job.stage} size="xs" short />
            <ArrowUpRight className="h-3 w-3 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
          </Link>
        ) : (
          <span className="text-xs italic text-muted-foreground">zakázka smazána</span>
        )}
        <div className="truncate text-xs text-muted-foreground">
          {[e.job?.customerName, e.job?.title].filter(Boolean).join(" · ") || "—"}
        </div>
      </div>
      <div className="text-right md:hidden">
        <div className={cn("font-bold tabular-nums", !pending && amount && amount > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
          {amountNode}
        </div>
        <div className="text-[11px] text-muted-foreground">{czk(e.revenue)} · zisk {e.costKnown ? czk(e.profit) : "?"}</div>
      </div>
      <div className="hidden text-right tabular-nums md:block">{czk(e.revenue)}</div>
      <div className={cn("hidden text-right tabular-nums md:block", !e.costKnown && "text-amber-600")}>{e.costKnown ? czk(e.profit) : "nákup ?"}</div>
      <div className={cn("hidden text-right font-bold tabular-nums md:block", !pending && amount && amount > 0 ? "text-emerald-700 dark:text-emerald-400" : "text-muted-foreground")}>
        {amountNode}
      </div>
      <div className="col-span-2 flex flex-wrap justify-start gap-1 md:col-span-1 md:justify-end">
        {e.collected ? (
          <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-1.5 py-px text-[10px] font-semibold text-green-800 dark:bg-green-500/15 dark:text-green-300" title={e.job?.paidAt ? `Inkasováno ${e.job.paidAt}` : "Inkasováno"}>
            <CheckCircle2 className="h-3 w-3" /> inkaso
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 rounded-full bg-muted px-1.5 py-px text-[10px] font-medium text-muted-foreground">
            <Clock3 className="h-3 w-3" /> neinkasováno
          </span>
        )}
        <span title={meta.hint} className={cn("rounded-full px-1.5 py-px text-[10px] font-semibold", meta.badge)}>{estimate ? "odhad" : meta.label}</span>
      </div>
    </li>
  );
}

/**
 * Záznamy provize, jejichž zakázka byla smazána — jeden souhrnný řádek. Nevyplacené
 * DB při smazání zakázky uklidí, zůstává jen vyplacená provize jako historie výplat.
 */
export function OrphanRow({ entries }: { entries: CommissionEntryView[] }) {
  const revenue = entries.reduce((s, e) => s + e.revenue, 0);
  const commission = entries.reduce((s, e) => s + e.commission, 0);
  const paid = entries.every((e) => e.status === "vyplaceno");
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-muted/30 px-3 py-2.5 text-sm text-muted-foreground">
      <Trash2 className="h-4 w-4 shrink-0" />
      <span className="min-w-0 flex-1">
        <strong className="font-medium text-foreground">Smazané zakázky ({entries.length})</strong>
        {paid ? " — zakázka už neexistuje, vyplacená provize zůstává v historii výplat." : " — záznamy provize bez zakázky."}
      </span>
      <span className="tabular-nums">{czk(revenue)}</span>
      <span className="font-semibold tabular-nums">{czk(commission)}</span>
    </li>
  );
}
