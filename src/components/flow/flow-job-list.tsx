import Link from "next/link";
import { Building2, CalendarClock, Flame, Package, Sparkles, UserRound, ChevronRight } from "lucide-react";
import { StageBadge } from "@/components/jobs/stage-badge";
import { stageMeta } from "@/lib/jobs/stages";
import { deadlineInfo, DEADLINE_BADGE } from "@/lib/jobs/deadlines";
import type { JobListItem } from "@/lib/jobs/types";
import { cn, formatCZK } from "@/lib/utils";
import { czDay, dateFromIso } from "./flow-utils";

/**
 * Kompaktní řádky zakázek pro stránky toku (poptávky, potvrzení…). Celý řádek je
 * odkaz na kartu zakázky; pod číslem dílčí stav fáze s autorem („V řešení · Petr
 * Obchodník · před 5 min“), vpravo další krok. Hlavní stav je jen odznak — korekce
 * stavu patří do karty zakázky. Bez stavu — renderuje se na serveru (akce jsou ostrůvky).
 */

export function money(value: number | null, currency = "CZK"): string | null {
  if (value === null || value === undefined) return null;
  if (!currency || currency === "CZK") return formatCZK(value);
  try {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

/** Odznak termínu („za 3 dny", „2 dny po termínu"). */
export function DeadlineChip({
  job,
  today,
  className,
}: {
  job: Pick<JobListItem, "stage" | "dueDate" | "customerRequiredDate" | "maxToleratedDate" | "supplierPromisedDate">;
  today: string;
  className?: string;
}) {
  const info = deadlineInfo(
    {
      stage: job.stage,
      dueDate: job.dueDate,
      customerRequiredDate: job.customerRequiredDate,
      maxToleratedDate: job.maxToleratedDate,
      supplierPromisedDate: job.supplierPromisedDate,
    },
    dateFromIso(today),
  );
  const which = job.dueDate ? "Potvrzený termín" : "Požadovaný termín zákazníkem";
  return (
    <span
      title={info.date ? `${which}: ${czDay(info.date)}` : "Zákazník termín neuvedl"}
      className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", DEADLINE_BADGE[info.state], className)}
    >
      <CalendarClock className="h-3 w-3" />
      {info.date ? `${czDay(info.date, { short: true, today })} · ${info.label}` : info.label}
    </span>
  );
}

export function FlowJobRow({
  job,
  today,
  action,
  state,
  extra,
}: {
  job: JobListItem;
  today: string;
  /** Akce vpravo (další krok + menu). */
  action?: React.ReactNode;
  /** Dílčí stav fáze (chipy) a kdo ho nastavil. */
  state?: React.ReactNode;
  /** Doplňující řádek pod údaji. */
  extra?: React.ReactNode;
}) {
  const m = stageMeta(job.stage);
  const value = money(job.value, job.currency);
  return (
    <li
      className={cn(
        "group relative flex flex-col gap-3 overflow-hidden rounded-xl border bg-card p-3 pl-4 shadow-sm transition hover:shadow-md sm:flex-row sm:items-center",
        "hover:border-foreground/20",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", m.bar)} />
      <Link href={`/orders/${job.id}`} className="absolute inset-0 z-0 rounded-xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Otevřít zakázku ${job.number} — ${job.title}`} />
      <div className="pointer-events-none relative min-w-0 flex-1 space-y-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="font-mono text-sm font-bold tracking-tight">{job.number}</span>
          <StageBadge stage={job.stage} size="sm" />
          {job.priority === "vysoka" && (
            <span title="Vysoká priorita" className="inline-flex items-center gap-0.5 rounded-full bg-red-100 px-1.5 py-0.5 text-[10.5px] font-semibold text-red-700 dark:bg-red-500/15 dark:text-red-300">
              <Flame className="h-3 w-3" /> Spěchá
            </span>
          )}
          <DeadlineChip job={job} today={today} />
          {job.aiFilled && (
            <span title="Údaje vyplnila AI — zkontroluj je" className="inline-flex text-violet-500 dark:text-violet-400">
              <Sparkles className="h-3.5 w-3.5" />
            </span>
          )}
        </div>
        {state && <div className="pointer-events-auto relative z-10 flex min-w-0 flex-col gap-1">{state}</div>}
        <p className="truncate font-medium leading-snug">{job.title || "Bez názvu"}</p>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
          <span className="inline-flex min-w-0 items-center gap-1">
            <Building2 className="h-3.5 w-3.5 shrink-0 text-sky-500" />
            <span className="truncate font-medium text-foreground/80">{job.customer?.name ?? "Zákazník neuveden"}</span>
            {job.customer?.customerNumber && <span className="font-mono">· {job.customer.customerNumber}</span>}
          </span>
          {job.customerInquiryNumber && (
            <span className="rounded bg-sky-50 px-1.5 py-0.5 text-sky-800 dark:bg-sky-500/10 dark:text-sky-200">
              Popt. zák. <span className="font-mono font-semibold">{job.customerInquiryNumber}</span>
            </span>
          )}
          {job.customerOrderNumber && (
            <span className="rounded bg-orange-50 px-1.5 py-0.5 text-orange-800 dark:bg-orange-500/10 dark:text-orange-200">
              Obj. zák. <span className="font-mono font-semibold">{job.customerOrderNumber}</span>
            </span>
          )}
          {job.drawingNumbers.slice(0, 3).map((d) => (
            <span key={d} title={`Výkres ${d}`} className="rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300">
              {d}
            </span>
          ))}
          {job.itemCount > 0 && (
            <span className="inline-flex items-center gap-1">
              <Package className="h-3.5 w-3.5" /> {job.itemCount} pol. · {job.totalQuantity} ks
            </span>
          )}
          {value && <span className="font-semibold text-foreground/80">{value}</span>}
          {job.owner && (
            <span className="inline-flex items-center gap-1" title="Obchodník">
              <UserRound className="h-3.5 w-3.5" /> {job.owner.name}
            </span>
          )}
        </div>
        {extra && <div className="pointer-events-auto relative z-10 pt-1">{extra}</div>}
      </div>
      <div className="relative z-10 flex shrink-0 items-center gap-2 self-stretch sm:max-w-[50%] sm:self-auto">
        {action}
        <ChevronRight aria-hidden className="hidden h-5 w-5 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-foreground sm:block" />
      </div>
    </li>
  );
}

export function FlowJobList({
  jobs,
  today,
  renderAction,
  renderState,
}: {
  jobs: JobListItem[];
  today: string;
  /** Akce řádku (volá se na serveru — vrací prvek s čistými daty). */
  renderAction?: (job: JobListItem) => React.ReactNode;
  /** Dílčí stav a autor řádku. */
  renderState?: (job: JobListItem) => React.ReactNode;
}) {
  return (
    <ul className="space-y-2">
      {jobs.map((j) => (
        <FlowJobRow key={j.id} job={j} today={today} action={renderAction?.(j)} state={renderState?.(j)} />
      ))}
    </ul>
  );
}
