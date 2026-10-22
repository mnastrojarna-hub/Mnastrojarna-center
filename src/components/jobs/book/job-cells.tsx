import { AlertTriangle, Camera, Flame, Mail, Paperclip, FileText, Sparkles, Upload, Truck, CalendarClock } from "lucide-react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { deadlineInfo, DEADLINE_BADGE, type DeadlineInfo } from "@/lib/jobs/deadlines";
import { avatarTone, countLabel, dateFromIso, initials, shortDate } from "@/components/jobs/book/book-params";
import type { JobListItem, PersonRef } from "@/lib/jobs/types";
import { cn, formatCZK } from "@/lib/utils";

/**
 * Drobné stavební kousky řádku / karty knihy (bez stavu — fungují na serveru
 * i v klientské tabuli). Barvy: stavy dle STAGES, termíny dle DEADLINE_BADGE.
 */

/** Částka v měně zakázky (bez haléřů). */
export function formatMoney(value: number, currency = "CZK"): string {
  if (!currency || currency === "CZK") return formatCZK(value);
  try {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${formatCZK(value).replace(/\s?Kč$/, "")} ${currency}`;
  }
}

export function jobDeadline(job: JobListItem, today: string): DeadlineInfo {
  return deadlineInfo(
    {
      stage: job.stage,
      dueDate: job.dueDate,
      customerRequiredDate: job.customerRequiredDate,
      maxToleratedDate: job.maxToleratedDate,
      supplierPromisedDate: job.supplierPromisedDate,
    },
    dateFromIso(today),
  );
}

function Tip({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>{children}</TooltipTrigger>
      <TooltipContent className="max-w-xs whitespace-normal">{label}</TooltipContent>
    </Tooltip>
  );
}

export function PersonAvatar({
  person,
  role,
  size = "md",
  className,
}: {
  person: PersonRef | null;
  role: string;
  size?: "sm" | "md";
  className?: string;
}) {
  if (!person) return null;
  return (
    <Tip label={`${role}: ${person.name}`}>
      <span
        role="img"
        aria-label={`${role}: ${person.name}`}
        className={cn(
          "relative z-10 inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold ring-2 ring-card",
          size === "md" ? "h-7 w-7 text-[11px]" : "h-6 w-6 text-[10px]",
          avatarTone(person.id),
          className,
        )}
      >
        {initials(person.name)}
      </span>
    </Tip>
  );
}

/** Obchodník + zpracovává (překryté avatary). */
export function PeopleStack({ owner, assignee }: { owner: PersonRef | null; assignee: PersonRef | null }) {
  if (!owner && !assignee) return <span className="text-xs text-muted-foreground">—</span>;
  const same = owner && assignee && owner.id === assignee.id;
  return (
    <span className="flex items-center -space-x-1.5">
      <PersonAvatar person={owner} role={same ? "Obchodník i zpracovává" : "Obchodník"} />
      {!same && <PersonAvatar person={assignee} role="Zpracovává" size="sm" />}
    </span>
  );
}

export function PriorityMark({ priority }: { priority: JobListItem["priority"] }) {
  if (priority !== "vysoka") return null;
  return (
    <Tip label="Vysoká priorita — řeš přednostně">
      <span role="img" aria-label="Vysoká priorita" className="relative z-10 inline-flex text-red-500 dark:text-red-400">
        <Flame className="h-4 w-4 fill-red-500/20" />
      </span>
    </Tip>
  );
}

const SOURCE_META = {
  foto: { icon: Camera, label: "Založeno z fotky dokladu", cls: "text-rose-500 dark:text-rose-400" },
  email: { icon: Mail, label: "Založeno z e-mailu", cls: "text-cyan-600 dark:text-cyan-400" },
  import: { icon: Upload, label: "Importováno", cls: "text-slate-500 dark:text-slate-400" },
  ai: { icon: Sparkles, label: "Založila AI", cls: "text-violet-500 dark:text-violet-400" },
} as const;

export function SourceMark({ source, aiFilled }: { source: JobListItem["source"]; aiFilled: boolean }) {
  const meta = source !== "manual" ? SOURCE_META[source] : null;
  return (
    <>
      {meta && (
        <Tip label={meta.label}>
          <span role="img" aria-label={meta.label} className={cn("relative z-10 inline-flex", meta.cls)}>
            <meta.icon className="h-3.5 w-3.5" />
          </span>
        </Tip>
      )}
      {aiFilled && source !== "ai" && (
        <Tip label="Údaje vyplnila AI — zkontroluj je">
          <span role="img" aria-label="Vyplněno AI" className="relative z-10 inline-flex text-violet-500 dark:text-violet-400">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
        </Tip>
      )}
    </>
  );
}

export function DrawingChips({ numbers, max = 3, className }: { numbers: string[]; max?: number; className?: string }) {
  if (!numbers.length) return null;
  const shown = numbers.slice(0, max);
  const rest = numbers.length - shown.length;
  return (
    <span className={cn("inline-flex min-w-0 flex-wrap items-center gap-1", className)}>
      {shown.map((n) => (
        <span
          key={n}
          title={`Výkres ${n}`}
          className="max-w-[9rem] truncate rounded bg-blue-50 px-1.5 py-0.5 font-mono text-[10.5px] font-medium text-blue-700 dark:bg-blue-500/15 dark:text-blue-300"
        >
          {n}
        </span>
      ))}
      {rest > 0 && (
        <span title={numbers.slice(max).join(", ")} className="rounded bg-muted px-1.5 py-0.5 text-[10.5px] font-medium text-muted-foreground">
          +{rest}
        </span>
      )}
    </span>
  );
}

/** Číslo dokladu zákazníka — u objednávek výrazně „Obj. zák.", jinak číslo poptávky. */
export function CustomerDocNumber({ job, className }: { job: JobListItem; className?: string }) {
  if (job.customerOrderNumber) {
    return (
      <span
        title="Číslo objednávky zákazníka"
        className={cn("inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-orange-50 px-1.5 py-0.5 text-[11px] text-orange-800 ring-1 ring-inset ring-orange-200 dark:bg-orange-500/10 dark:text-orange-200 dark:ring-orange-500/30", className)}
      >
        <span className="shrink-0 font-medium opacity-80">Obj. zák.</span>
        <span className="truncate font-mono font-semibold">{job.customerOrderNumber}</span>
      </span>
    );
  }
  if (job.customerInquiryNumber) {
    return (
      <span
        title="Číslo poptávky zákazníka"
        className={cn("inline-flex min-w-0 max-w-full items-center gap-1 rounded-md bg-sky-50 px-1.5 py-0.5 text-[11px] text-sky-800 ring-1 ring-inset ring-sky-200 dark:bg-sky-500/10 dark:text-sky-200 dark:ring-sky-500/30", className)}
      >
        <span className="shrink-0 font-medium opacity-80">Popt.</span>
        <span className="truncate font-mono font-semibold">{job.customerInquiryNumber}</span>
      </span>
    );
  }
  return null;
}

/** Termín: datum + odznak („za 3 dny"), varování na dodavatele, slíbeno dodavatelem. */
export function DeadlineBlock({ job, today, compact }: { job: JobListItem; today: string; compact?: boolean }) {
  const info = jobDeadline(job, today);
  const supplier = job.supplierPromisedDate;
  return (
    <span className="flex min-w-0 flex-col gap-0.5">
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {info.date ? (
          <span className={cn("whitespace-nowrap text-sm tabular-nums", info.state === "done" ? "text-muted-foreground" : "font-medium")}>
            {shortDate(info.date, today)}
          </span>
        ) : null}
        <span className={cn("whitespace-nowrap rounded-full px-1.5 py-0.5 text-[10.5px] font-semibold leading-none", DEADLINE_BADGE[info.state])}>
          {info.label}
        </span>
        {info.supplierRisk && (
          <Tip label={`Pozor: dodavatel slíbil ${shortDate(supplier, today)} — později než náš termín ${shortDate(info.date, today)}.`}>
            <span role="img" aria-label="Riziko: dodavatel slíbil později než náš termín" className="relative z-10 inline-flex text-amber-500">
              <AlertTriangle className="h-4 w-4" />
            </span>
          </Tip>
        )}
      </span>
      {!compact && supplier && (
        <span
          title="Slíbeno dodavatelem"
          className={cn("flex items-center gap-1 whitespace-nowrap text-[11px]", info.supplierRisk ? "font-medium text-amber-700 dark:text-amber-400" : "text-muted-foreground")}
        >
          <Truck className="h-3 w-3" /> dod. {shortDate(supplier, today)}
        </span>
      )}
      {!compact && !supplier && job.expectedDeliveryDate && (
        <span title="Předpokládaný termín dodání" className="flex items-center gap-1 whitespace-nowrap text-[11px] text-muted-foreground">
          <CalendarClock className="h-3 w-3" /> předp. {shortDate(job.expectedDeliveryDate, today)}
        </span>
      )}
    </span>
  );
}

export function JobValue({ job, className }: { job: Pick<JobListItem, "value" | "currency">; className?: string }) {
  if (job.value === null || job.value === undefined) {
    return <span className={cn("text-sm text-muted-foreground", className)} title="Zatím bez ceny">—</span>;
  }
  return <span className={cn("whitespace-nowrap text-sm font-semibold tabular-nums", className)}>{formatMoney(job.value, job.currency)}</span>;
}

/** Počítadla: dokumenty a nabídky. */
export function JobCounters({ job, className }: { job: Pick<JobListItem, "fileCount" | "quoteCount">; className?: string }) {
  if (!job.fileCount && !job.quoteCount) return null;
  return (
    <span className={cn("inline-flex items-center gap-2 text-[11px] text-muted-foreground", className)}>
      {job.fileCount > 0 && (
        <span className="inline-flex items-center gap-0.5" title={countLabel(job.fileCount, "dokument", "dokumenty", "dokumentů")} aria-label={`Dokumenty: ${job.fileCount}`}>
          <Paperclip className="h-3 w-3 text-rose-500" />
          {job.fileCount}
        </span>
      )}
      {job.quoteCount > 0 && (
        <span className="inline-flex items-center gap-0.5" title={countLabel(job.quoteCount, "nabídka", "nabídky", "nabídek")} aria-label={`Nabídky: ${job.quoteCount}`}>
          <FileText className="h-3 w-3 text-violet-500" />
          {job.quoteCount}
        </span>
      )}
    </span>
  );
}
