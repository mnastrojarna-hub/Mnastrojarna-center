import Link from "next/link";
import { StageSelect, NextStageButton } from "@/components/jobs/stage-select";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import {
  CustomerDocNumber, DeadlineBlock, DrawingChips, JobCounters, JobValue, PeopleStack, PriorityMark, SourceMark,
} from "@/components/jobs/book/job-cells";
import { nextStage, stageMeta } from "@/lib/jobs/stages";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import type { JobListItem } from "@/lib/jobs/types";
import { cn, relativeTime } from "@/lib/utils";

/**
 * Řádky Knihy zakázek — jeden jednoduchý barevný řádek na zakázku. Celý řádek
 * je odkaz na detail (roztažený odkaz čísla zakázky), vnořené ovládací prvky
 * leží nad ním (relative z-10). Tři rozložení: mobil / tablet = karta (flex
 * s řádky, každý řádek má vlastní šířky), menší desktop = mřížka na dva řádky,
 * široký desktop = mřížka na jeden řádek.
 */

const LAYOUT = cn(
  // mobil a tablet: karta (řádky: číslo+stav / zákazník / termín+hodnota / lidé+akce)
  "flex flex-wrap items-start gap-x-3 gap-y-2",
  // menší desktop: dva řádky (pevné sloupce = řádky pod sebou lícují)
  "lg:grid lg:gap-x-4 lg:gap-y-2 lg:grid-cols-[minmax(0,1fr)_8.5rem_4.5rem_5rem] lg:[grid-template-areas:'id_due_stage_stage'_'cust_val_ppl_act']",
  // široký desktop: jeden řádek
  "xl:grid-cols-[9.5rem_minmax(0,1fr)_10.5rem_8.5rem_3.5rem_6.5rem_4.5rem] xl:items-center xl:[grid-template-areas:'id_cust_stage_due_ppl_val_act']",
  "2xl:grid-cols-[11rem_minmax(0,1fr)_11rem_9rem_4rem_7rem_4.5rem]",
);

export function JobRows({ jobs, today }: { jobs: JobListItem[]; today: string }) {
  return (
    <ul role="list" className="space-y-2">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} today={today} />
      ))}
    </ul>
  );
}

/** Hlavička sloupců (jen široký desktop). */
export function JobRowsHeader() {
  return (
    <div
      aria-hidden
      className={cn(
        LAYOUT,
        "hidden px-3 pb-1 pl-5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground lg:hidden xl:grid",
      )}
    >
      <span className="[grid-area:id]">Zakázka</span>
      <span className="[grid-area:cust]">Zákazník · co se dělá</span>
      <span className="[grid-area:stage]">Stav</span>
      <span className="[grid-area:due]">Termín</span>
      <span className="[grid-area:ppl]">Lidé</span>
      <span className="text-right [grid-area:val]">Hodnota</span>
      <span className="text-right [grid-area:act]">Akce</span>
    </div>
  );
}

function JobRow({ job, today }: { job: JobListItem; today: string }) {
  const m = stageMeta(job.stage);
  const label = [job.number, job.customer?.name, job.title].filter(Boolean).join(" — ");
  const target = nextStage(job.stage);
  return (
    <li
      className={cn(
        "group relative overflow-hidden rounded-xl border bg-card shadow-sm transition",
        "hover:border-foreground/15 hover:shadow-md focus-within:ring-2 focus-within:ring-ring/40",
      )}
    >
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", m.bar)} />
      <div className={cn(LAYOUT, "py-3 pl-5 pr-3")}>
        {/* číslo + příznaky + číslo dokladu zákazníka (na mobilu je doklad u zákazníka) */}
        <div className="order-1 flex min-w-0 flex-1 flex-wrap items-center gap-x-2 gap-y-1 lg:order-none [grid-area:id] xl:flex-col xl:items-start">
          <span className="flex items-center gap-1.5">
            <Link
              href={`/orders/${job.id}`}
              aria-label={`Otevřít zakázku ${label}`}
              className="whitespace-nowrap font-mono text-sm font-bold tracking-tight outline-none after:absolute after:inset-0 after:content-[''] group-hover:text-primary"
            >
              {job.number}
            </Link>
            <PriorityMark priority={job.priority} />
            <SourceMark source={job.source} aiFilled={job.aiFilled} />
          </span>
          <CustomerDocNumber job={job} className="hidden lg:inline-flex" />
        </div>

        {/* zákazník + co se dělá */}
        <div className="order-3 min-w-0 basis-full lg:order-none lg:basis-auto [grid-area:cust]">
          <div className="flex min-w-0 items-baseline gap-1.5">
            {job.customer ? (
              <Link
                href={`/customers/${job.customer.id}`}
                className="relative z-10 truncate text-sm font-semibold hover:text-primary hover:underline"
              >
                {job.customer.name}
              </Link>
            ) : (
              <span className="truncate text-sm italic text-muted-foreground">Bez zákazníka</span>
            )}
            {job.customer?.customerNumber && (
              <span className="shrink-0 font-mono text-[11px] text-muted-foreground" title="Naše číslo zákazníka">
                {job.customer.customerNumber}
              </span>
            )}
          </div>
          <div className="mt-0.5 flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <span className="min-w-0 max-w-full truncate text-sm text-muted-foreground">{job.title || "Bez názvu"}</span>
            <DrawingChips numbers={job.drawingNumbers} />
          </div>
          <CustomerDocNumber job={job} className="mt-1.5 lg:hidden" />
        </div>

        {/* stav */}
        <div className="relative z-10 order-2 flex shrink-0 flex-col items-end gap-0.5 lg:order-none lg:justify-self-end [grid-area:stage] xl:items-start xl:justify-self-start">
          <StageSelect jobId={job.id} stage={job.stage} size="sm" />
          {job.stageChangedAt && (
            <span className="hidden text-[11px] text-muted-foreground xl:block">{relativeTime(job.stageChangedAt)}</span>
          )}
        </div>

        {/* termín */}
        <div className="order-4 min-w-0 flex-1 lg:order-none [grid-area:due]">
          <DeadlineBlock job={job} today={today} />
        </div>

        {/* lidé (na mobilu jsou v řádku s akcemi) */}
        <div className="hidden items-center lg:flex lg:justify-end [grid-area:ppl] xl:justify-start">
          <PeopleStack owner={job.owner} assignee={job.assignee} />
        </div>

        {/* hodnota + počítadla */}
        <div className="order-5 flex shrink-0 flex-col items-end gap-0.5 lg:order-none [grid-area:val]">
          <JobValue job={job} />
          <JobCounters job={job} />
        </div>

        {/* rychlé akce */}
        <div className="relative z-10 order-6 flex basis-full flex-wrap items-center justify-end gap-1.5 lg:order-none lg:basis-auto lg:flex-nowrap [grid-area:act]">
          <span className="mr-auto lg:hidden">
            <PeopleStack owner={job.owner} assignee={job.assignee} />
          </span>
          <CaptureButton jobId={job.id} label="" variant="outline" size="icon-sm" className="text-rose-600 dark:text-rose-400" />
          {target && (
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="inline-flex">
                  <NextStageButton
                    jobId={job.id}
                    stage={job.stage}
                    className={cn(
                      "h-8 gap-1.5 px-3 text-xs [&>svg:first-child]:hidden",
                      // desktop: jen barevná šipka (popisek zůstává pro čtečky, název kroku v bublině)
                      "lg:w-8 lg:gap-0 lg:px-0 lg:text-[0px]",
                    )}
                  />
                </span>
              </TooltipTrigger>
              <TooltipContent>Posunout: {stageMeta(target).label}</TooltipContent>
            </Tooltip>
          )}
        </div>
      </div>
    </li>
  );
}
