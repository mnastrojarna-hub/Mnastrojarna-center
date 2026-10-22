import Link from "next/link";
import { CalendarClock, ChevronRight, FileText, Hash, Sparkles } from "lucide-react";
import { StageBadge } from "@/components/jobs/stage-badge";
import { stageMeta } from "@/lib/jobs/stages";
import { deadlineInfo, DEADLINE_BADGE, type DeadlineInfo } from "@/lib/jobs/deadlines";
import type { JobListItem } from "@/lib/jobs/types";
import { cn, formatCZK, formatDate } from "@/lib/utils";

/**
 * Kompaktní řádky zakázek (karta zákazníka, AI přehled): barevný pruh stavu,
 * naše číslo, stav, název, číslo objednávky zákazníka, termín a hodnota.
 * Celý řádek otevře kartu zakázky v Knize zakázek. Bez stavu (server).
 */

export function jobDeadline(job: JobListItem, today?: Date): DeadlineInfo {
  return deadlineInfo(
    {
      stage: job.stage,
      dueDate: job.dueDate,
      customerRequiredDate: job.customerRequiredDate,
      maxToleratedDate: job.maxToleratedDate,
      supplierPromisedDate: job.supplierPromisedDate,
    },
    today,
  );
}

function money(value: number | null, currency: string): string | null {
  if (value === null || value === undefined) return null;
  if (!currency || currency === "CZK") return formatCZK(value);
  try {
    return new Intl.NumberFormat("cs-CZ", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
  } catch {
    return `${Math.round(value)} ${currency}`;
  }
}

export function JobMiniList({
  jobs,
  showCustomer = false,
  today,
  className,
}: {
  jobs: JobListItem[];
  showCustomer?: boolean;
  today?: Date;
  className?: string;
}) {
  return (
    <ul className={cn("space-y-1.5", className)}>
      {jobs.map((job) => {
        const m = stageMeta(job.stage);
        const dl = jobDeadline(job, today);
        const value = money(job.value, job.currency);
        return (
          <li key={job.id}>
            <Link
              href={`/orders/${job.id}`}
              className="group relative flex items-center gap-3 overflow-hidden rounded-xl border bg-card py-2.5 pl-4 pr-3 transition hover:border-foreground/20 hover:shadow-sm"
            >
              <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", m.bar)} />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="font-mono text-sm font-semibold">{job.number}</span>
                  <StageBadge stage={job.stage} size="xs" />
                  {job.aiFilled && (
                    <span title="Vyplnila AI z dokladu" className="inline-flex items-center gap-0.5 text-[10px] font-medium text-fuchsia-600 dark:text-fuchsia-400">
                      <Sparkles className="h-3 w-3" /> AI
                    </span>
                  )}
                </div>
                <p className="truncate text-sm">
                  {showCustomer && job.customer ? <span className="font-medium">{job.customer.name} · </span> : null}
                  <span className="text-muted-foreground">{job.title || "bez názvu"}</span>
                </p>
                <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-foreground">
                  {job.customerOrderNumber && (
                    <span className="inline-flex items-center gap-0.5" title="Číslo objednávky zákazníka">
                      <Hash className="h-3 w-3 text-orange-500" />{`obj. ${job.customerOrderNumber}`}
                    </span>
                  )}
                  {!job.customerOrderNumber && job.customerInquiryNumber && (
                    <span className="inline-flex items-center gap-0.5" title="Číslo poptávky zákazníka">
                      <Hash className="h-3 w-3 text-sky-500" />{`popt. ${job.customerInquiryNumber}`}
                    </span>
                  )}
                  {job.quoteCount > 0 && (
                    <span className="inline-flex items-center gap-0.5"><FileText className="h-3 w-3 text-violet-500" />{`${job.quoteCount}× nabídka`}</span>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 flex-col items-end gap-1">
                {value && <span className="text-sm font-semibold">{value}</span>}
                <span
                  title={dl.date ? `Termín ${formatDate(dl.date)}` : "Bez termínu"}
                  className={cn("inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", DEADLINE_BADGE[dl.state])}
                >
                  <CalendarClock className="h-3 w-3" />
                  {dl.date && dl.state !== "done" ? `${formatDate(dl.date)} · ${dl.label}` : dl.label}
                </span>
              </div>
              <ChevronRight className="hidden h-4 w-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 sm:block" />
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
