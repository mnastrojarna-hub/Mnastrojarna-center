"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Wallet, FileSignature, Users, Hourglass, CircleDollarSign, BadgeCheck, Activity, Clock3, CalendarRange, Pencil, Info,
} from "lucide-react";
import { ToastProvider, useNotify } from "@/components/jobs/detail/toast";
import { cn } from "@/lib/utils";
import { PageHero } from "./page-hero";
import { BandBar } from "./band-bar";
import { EntryRow, OrphanRow, StatementCard } from "./statement-card";
import {
  BAND_TONES, compactCzk, czDay, czk, formatRate, formatStamp, monthBars, monthLabel, monthShort, ownerTotals, pendingEntries, periodParam,
  ruleLines, ruleSummary, tierRangeLabel, STATEMENT_STATUS_META,
  type CommissionOverview, type CommissionOwnerView, type CommissionRuleView,
} from "./model";

function capital(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]?.toUpperCase() ?? "").join("") || "?";
}

/** Stránka Provize: smlouva, výběr měsíce, měsíční vyúčtování s pásmy, předběžné provize. */
export function CommissionsView(props: { overview: CommissionOverview; initialMonth?: string | null }) {
  return (
    <ToastProvider>
      <Inner {...props} />
    </ToastProvider>
  );
}

function Inner({ overview: o, initialMonth }: { overview: CommissionOverview; initialMonth?: string | null }) {
  const router = useRouter();
  const notify = useNotify();
  const [refreshing, startRefresh] = React.useTransition();
  const [month, setMonth] = React.useState(initialMonth && o.months.includes(initialMonth) ? initialMonth : o.months[0] ?? o.today);

  const owner: CommissionOwnerView | null = o.ownerId
    ? o.owners.find((x) => x.id === o.ownerId) ?? null
    : !o.canSeeAll ? o.owners[0] ?? null : null;
  const allView = o.canSeeAll && !o.ownerId;
  const statements = o.statements.filter((s) => s.period === month);
  const pending = pendingEntries(o.entries);
  const bars = monthBars(o.months, o.statements);
  const visibleOwners = allView ? o.owners : owner ? [owner] : [];
  const totals = ownerTotals(visibleOwners.map((x) => x.id), o.statements, o.entries, month);
  const sum = (k: "toPay" | "paid" | "running" | "estimate") => totals.reduce((s, t) => s + t[k], 0);

  function pickMonth(p: string) {
    setMonth(p);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set("mesic", periodParam(p));
      window.history.replaceState(window.history.state, "", url.toString());
    } catch {
      // adresa je jen pohodlí
    }
  }

  const refresh = () => startRefresh(() => router.refresh());
  const ownerHref = (id: string | null) => {
    const params = new URLSearchParams();
    if (id) params.set("obchodnik", id);
    params.set("mesic", periodParam(month));
    return `/commissions?${params.toString()}`;
  };

  return (
    <div className={cn("space-y-5", refreshing && "opacity-80 transition-opacity")}>
      <PageHero
        tone="emerald"
        icon={Wallet}
        title="Provize"
        description={
          allView
            ? "Provize všech obchodníků — počítá je databáze automaticky dle smlouvy každého (ze zisku, z obratu nebo pásmově z inkasa)."
            : o.canSeeAll && owner && owner.id !== o.viewerId
              ? `Provize obchodníka ${owner.name} — počítá se automaticky dle jeho smlouvy: zisk = objednávka zákazníka − nákup od dodavatelů.`
              : "Tvoje provize se počítá automaticky dle smlouvy: zisk = objednávka zákazníka − nákup od dodavatelů. Vyúčtování je měsíční."
        }
      >
        {o.canSeeAll && (
          <nav aria-label="Obchodník" className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 scrollbar-thin">
            <Link
              href={ownerHref(null)}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium transition",
                allView ? "border-emerald-600 bg-emerald-600 text-white shadow-sm" : "bg-card hover:bg-accent",
              )}
            >
              <Users className="h-3.5 w-3.5" /> Všichni
            </Link>
            {o.owners.map((x) => (
              <Link
                key={x.id}
                href={ownerHref(x.id)}
                className={cn(
                  "inline-flex shrink-0 items-center gap-1.5 rounded-full border py-1 pl-1 pr-3 text-xs font-medium transition",
                  o.ownerId === x.id ? "border-emerald-600 bg-emerald-600 text-white shadow-sm" : "bg-card hover:bg-accent",
                )}
              >
                <span className={cn("flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-bold", o.ownerId === x.id ? "bg-white/20" : "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200")}>
                  {initials(x.name)}
                </span>
                {x.name}
              </Link>
            ))}
          </nav>
        )}
      </PageHero>

      {/* Součty */}
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile icon={CircleDollarSign} tone="bg-amber-500 text-white" label="K výplatě" value={czk(sum("toPay"))} sub="skončené měsíce" />
        <Tile icon={Activity} tone="bg-sky-500 text-white" label="Běžící měsíc" value={czk(sum("running"))} sub="průběžně, ještě se mění" />
        <Tile icon={Hourglass} tone="bg-violet-500 text-white" label="Odhad z neinkasovaných" value={`≈ ${czk(sum("estimate"))}`} sub="pásmová provize po inkasu" />
        <Tile icon={BadgeCheck} tone="bg-green-600 text-white" label="Vyplaceno" value={czk(sum("paid"))} sub={`posledních ${o.months.length} měsíců`} />
      </div>

      {owner && <ContractCard owner={owner} rules={o.rules.filter((r) => r.ownerId === owner.id)} canEdit={o.canSeeAll} />}

      {allView && <OwnerGrid owners={o.owners} totals={totals} month={month} hrefFor={ownerHref} />}

      <MonthPicker bars={bars} month={month} onPick={pickMonth} statuses={o.statements} />

      <section className="space-y-3" aria-live="polite">
        {statements.length === 0 ? (
          <EmptyMonth month={month} owner={owner} allView={allView} />
        ) : (
          statements.map((s) => (
            <StatementCard
              key={s.id}
              statement={s}
              entries={o.entries}
              today={o.today}
              showOwner={allView}
              canPay={o.canSeeAll}
              onNotify={(tone, text) => notify(tone, text)}
              onChanged={refresh}
            />
          ))
        )}
      </section>

      {pending.length > 0 && (
        <section className="overflow-hidden rounded-2xl border border-violet-200/70 bg-card shadow-sm dark:border-violet-500/25">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b bg-violet-50/60 px-4 py-3 dark:bg-violet-500/10">
            <div>
              <h3 className="flex items-center gap-2 font-semibold">
                <Clock3 className="h-4 w-4 text-violet-600" /> Předběžné (neinkasované)
                <span className="rounded-full bg-violet-100 px-2 py-0.5 text-xs font-semibold text-violet-800 dark:bg-violet-500/20 dark:text-violet-200">{pending.length}</span>
              </h3>
              <p className="text-xs text-muted-foreground">Pásmová provize se započte až v měsíci inkasa. Odhad = zisk zakázky × sazba pásma, do kterého by inkaso padlo teď.</p>
            </div>
            <span className="text-sm">odhad celkem <strong className="tabular-nums text-violet-700 dark:text-violet-300">≈ {czk(pending.reduce((s, e) => s + (e.estimatedCommission ?? 0), 0))}</strong></span>
          </header>
          <ul className="divide-y">
            {pending.filter((e) => e.job).map((e) => <EntryRow key={e.id} entry={e} estimate />)}
            {pending.some((e) => !e.job) && <OrphanRow entries={pending.filter((e) => !e.job)} />}
          </ul>
        </section>
      )}
    </div>
  );
}

function Tile({ icon: Icon, tone, label, value, sub }: { icon: typeof Wallet; tone: string; label: string; value: string; sub: string }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border bg-card p-3 shadow-sm">
      <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-lg shadow-sm", tone)}>
        <Icon className="h-4 w-4" />
      </span>
      <div className="min-w-0">
        <div className="truncate text-xs text-muted-foreground">{label}</div>
        <div className="truncate text-base font-bold tabular-nums sm:text-lg">{value}</div>
        <div className="truncate text-[11px] text-muted-foreground">{sub}</div>
      </div>
    </div>
  );
}

/** Smlouva obchodníka: druh provize, pásma, splatnost, historie dodatků. */
function ContractCard({ owner, rules, canEdit }: { owner: CommissionOwnerView; rules: CommissionRuleView[]; canEdit: boolean }) {
  const rule = owner.rule;
  const tiers = rule?.base === "margin_tiered" ? [...(rule.tiers ?? [])].sort((a, b) => a.from - b.from) : [];
  const older = rules.filter((r) => r.id !== rule?.id);
  return (
    <section className="rounded-2xl border bg-card p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-3">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
            <FileSignature className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs text-muted-foreground">Smlouva · {owner.name}</p>
            <h2 className="font-semibold">{rule?.name ?? (owner.profileRate > 0 ? "Sazba z profilu" : "Bez smlouvy")}</h2>
            <span className="mt-1 inline-flex rounded-full bg-emerald-600 px-2.5 py-0.5 text-xs font-semibold text-white">{ruleSummary(rule, owner.profileRate)}</span>
            {rule && (
              <p className="mt-1 text-[11px] text-muted-foreground" suppressHydrationWarning>
                Platí od {czDay(rule.validFrom)}
                {rule.changedBy ? <> · upravil <strong className="font-medium text-foreground">{rule.changedBy}</strong>{rule.changedAt ? ` · ${formatStamp(rule.changedAt)}` : ""}</> : null}
              </p>
            )}
          </div>
        </div>
        {canEdit && (
          <Link href={`/users?smlouva=${owner.id}`} className="inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-medium transition hover:bg-accent">
            <Pencil className="h-3.5 w-3.5" /> Upravit smlouvu
          </Link>
        )}
      </div>

      {tiers.length > 0 && (
        <ol className="mt-3 flex flex-wrap gap-1.5">
          {tiers.map((t, i) => (
            <li key={i} className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs", BAND_TONES[i % BAND_TONES.length].chip)}>
              <strong>{formatRate(t.rate)}</strong> <span className="opacity-80">{tierRangeLabel(t, true)}</span>
            </li>
          ))}
        </ol>
      )}
      <ul className="mt-3 space-y-1 text-sm text-muted-foreground">
        {ruleLines(rule, owner.profileRate).map((l) => (
          <li key={l} className="flex items-start gap-2"><span className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />{l}</li>
        ))}
      </ul>
      {rule?.note && <p className="mt-2 rounded-lg bg-muted/40 px-3 py-2 text-xs text-muted-foreground">{rule.note}</p>}
      {older.length > 0 && (
        <p className="mt-2 text-[11px] text-muted-foreground">
          Další smlouvy: {older.map((r) => `${r.name ?? ruleSummary(r)} (od ${r.validFrom.split("-").reverse().map(Number).join(". ")})`).join(" · ")}
        </p>
      )}
    </section>
  );
}

/** Obchodníci (super admin, „Všichni"): smlouva a součty — klik = detail obchodníka. */
function OwnerGrid({
  owners, totals, month, hrefFor,
}: {
  owners: CommissionOwnerView[];
  totals: ReturnType<typeof ownerTotals>;
  month: string;
  hrefFor: (id: string) => string;
}) {
  if (!owners.length) return null;
  return (
    <section className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
      {owners.map((x) => {
        const t = totals.find((y) => y.ownerId === x.id);
        return (
          <Link key={x.id} href={hrefFor(x.id)} className="group rounded-xl border bg-card p-3 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-emerald-100 text-xs font-bold text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-200">{initials(x.name)}</span>
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium group-hover:underline">{x.name}</div>
                <div className="truncate text-[11px] text-muted-foreground">{ruleSummary(x.rule, x.profileRate)}</div>
              </div>
            </div>
            <dl className="mt-2.5 grid grid-cols-3 gap-1 text-[11px]">
              <div><dt className="text-muted-foreground">{monthShort(month)}</dt><dd className="font-bold tabular-nums text-emerald-700 dark:text-emerald-400">{compactCzk(t?.month ?? 0)}</dd></div>
              <div><dt className="text-muted-foreground">k výplatě</dt><dd className="font-bold tabular-nums text-amber-700 dark:text-amber-400">{compactCzk(t?.toPay ?? 0)}</dd></div>
              <div><dt className="text-muted-foreground">odhad</dt><dd className="font-bold tabular-nums text-violet-700 dark:text-violet-400">≈ {compactCzk(t?.estimate ?? 0)}</dd></div>
            </dl>
          </Link>
        );
      })}
    </section>
  );
}

/** Výběr měsíce: sloupečky podle provize (posledních 12 měsíců), barva stavu vyúčtování. */
function MonthPicker({
  bars, month, onPick, statuses,
}: {
  bars: ReturnType<typeof monthBars>;
  month: string;
  onPick: (p: string) => void;
  statuses: { period: string; status: keyof typeof STATEMENT_STATUS_META }[];
}) {
  const chronological = [...bars].reverse();
  const scroller = React.useRef<HTMLDivElement>(null);
  // vybraný měsíc vždy na očích (na mobilu je lišta posuvná a nejnovější měsíc vpravo)
  React.useEffect(() => {
    const box = scroller.current;
    const active = box?.querySelector<HTMLElement>("[aria-pressed=true]");
    if (!box || !active) return;
    const target = active.offsetLeft - box.clientWidth / 2 + active.offsetWidth / 2;
    box.scrollTo({ left: Math.max(0, target) });
  }, [month]);
  return (
    <section className="rounded-2xl border bg-card p-3 shadow-sm">
      <div className="mb-2 flex items-center gap-2 px-1 text-sm font-medium">
        <CalendarRange className="h-4 w-4 text-emerald-600" /> Měsíc
        <span className="text-xs font-normal text-muted-foreground">— {capital(monthLabel(month))}</span>
      </div>
      <div ref={scroller} className="relative -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 scrollbar-thin">
        {chronological.map((b) => {
          const active = b.period === month;
          const st = statuses.find((s) => s.period === b.period);
          return (
            <button
              key={b.period}
              type="button"
              onClick={() => onPick(b.period)}
              aria-pressed={active}
              title={`${capital(monthLabel(b.period))}: ${czk(b.commission)}`}
              className={cn(
                "flex min-w-[3.6rem] flex-1 flex-col items-center gap-1 rounded-xl px-1.5 pb-1.5 pt-2 text-[11px] transition",
                active ? "bg-emerald-600 text-white shadow-md shadow-emerald-600/25" : "hover:bg-accent",
              )}
            >
              <span className="flex h-14 w-full items-end justify-center">
                <span
                  className={cn("w-5 rounded-t-md transition-all", active ? "bg-white/90" : b.commission > 0 ? "bg-emerald-400 dark:bg-emerald-500" : "bg-muted")}
                  style={{ height: `${Math.max(6, b.height)}%` }}
                />
              </span>
              <span className={cn("font-semibold tabular-nums", !active && b.commission <= 0 && "text-muted-foreground")}>{b.commission > 0 ? compactCzk(b.commission) : "—"}</span>
              <span className={cn("flex items-center gap-1", active ? "text-white/90" : "text-muted-foreground")}>
                {st && <span className={cn("h-1.5 w-1.5 rounded-full", STATEMENT_STATUS_META[st.status].dot)} />}
                {monthShort(b.period)} {b.period.slice(2, 4)}
              </span>
            </button>
          );
        })}
      </div>
    </section>
  );
}

function EmptyMonth({ month, owner, allView }: { month: string; owner: CommissionOwnerView | null; allView: boolean }) {
  const tiered = owner?.rule?.base === "margin_tiered" ? owner.rule : null;
  return (
    <div className="space-y-4 rounded-2xl border-2 border-dashed border-emerald-200 bg-emerald-50/30 p-5 text-center dark:border-emerald-500/20 dark:bg-emerald-500/5">
      <div className="flex flex-col items-center gap-2">
        <span className="flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
          <Wallet className="h-6 w-6" />
        </span>
        <p className="font-medium">{capital(monthLabel(month))} — zatím žádná provize</p>
        <p className="max-w-lg text-sm text-muted-foreground">
          {allView
            ? "Za tento měsíc nemá žádný obchodník vyúčtování."
            : tiered
              ? "Pásmová provize se počítá z inkasa: jakmile zákazník zaplatí zakázku (stav Dokončeno nebo datum inkasa), započte se do tohoto měsíce."
              : "Provize vznikne automaticky, jakmile zakázka s tebou jako obchodníkem dostane objednávku zákazníka."}
        </p>
      </div>
      {tiered && tiered.tiers && (
        <div className="mx-auto max-w-3xl text-left">
          <BandBar bands={tiered.tiers} revenue={0} showNext compact />
        </div>
      )}
      {!allView && !owner?.rule && (owner?.profileRate ?? 0) <= 0 && (
        <p className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
          <Info className="h-3.5 w-3.5" /> Bez smlouvy a sazby — požádej super admina o nastavení provize.
        </p>
      )}
    </div>
  );
}
