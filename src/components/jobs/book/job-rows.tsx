import Link from "next/link";
import { StageSelect } from "@/components/jobs/stage-select";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { ActorStamp } from "@/components/flow-status/actor-stamp";
import { FlowStatusChip } from "@/components/flow-status/state-chip";
import { RowExceptionFlags } from "@/components/flow-status/exception-flag-chip";
import { QuoteApprovalFlag } from "@/components/flow-status/quote-approval-flag";
import { RowNextAction, RowProposal } from "@/components/jobs/book/row-flow";
import { rowFlowView, type BookAccess, type RowFlowView } from "@/components/jobs/book/book-flow";
import { actionPalette } from "@/components/flow/flow-state";
import {
  CustomerDocNumber, CustomerNoteMark, DeadlineBlock, DrawingChips, JobCounters, JobValue, PaymentMark, PeopleStack,
  PriorityMark, ProductionLine, SourceMark,
} from "@/components/jobs/book/job-cells";
import { stageMeta } from "@/lib/jobs/stages";
import type { JobListItem } from "@/lib/jobs/types";
import { cn } from "@/lib/utils";

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

export function JobRows({ jobs, today, access }: { jobs: JobListItem[]; today: string; access?: BookAccess | null }) {
  return (
    <ul role="list" className="space-y-2">
      {jobs.map((job) => (
        <JobRow key={job.id} job={job} today={today} access={access ?? null} />
      ))}
    </ul>
  );
}

/** Chip podrobného stavu (tabulka 1.11) nebo návrh změny s ✓ / ✕; pod chipem kdo dílčí stav změnil. */
export function RowStateChip({
  job, view, className, shortFlag,
}: { job: JobListItem; view: RowFlowView; className?: string; shortFlag?: boolean }) {
  const proposal = job.flow?.proposal;
  if (proposal) {
    return <RowProposal jobId={job.id} proposal={proposal} stamp={job.stamps?.proposal} canDecide={view.canDecideProposal} className={className} />;
  }
  if (!view.chip) return view.approval ? <QuoteApprovalFlag flag={view.approval} size="xs" short={shortFlag} className={className} /> : null;
  if (!view.chipStamp && !view.approval) return <FlowStatusChip chip={view.chip} size="xs" className={cn("max-w-full", className)} />;
  return (
    <span className={cn("inline-flex min-w-0 max-w-full flex-col items-start gap-0.5", className)}>
      {view.chipIsApproval ? (
        // #25: „Neschválená · NAB-…“ výrazně (jantarový štítek se štítem), ne fialový chip jako „Schválená“
        <QuoteApprovalFlag flag={view.approval} size="xs" short={shortFlag} withNumber />
      ) : (
        <FlowStatusChip chip={view.chip} size="xs" className="max-w-full" />
      )}
      {view.chipStamp && <ActorStamp stamp={view.chipStamp} short className="max-w-[10.5rem]" />}
      {/* #25: neschválená nabídka je vidět všem, ale výrazně označená */}
      {!view.chipIsApproval && <QuoteApprovalFlag flag={view.approval} size="xs" short={shortFlag} />}
    </span>
  );
}

/** Tlačítko dalšího kroku v barvě AKCE (stejná akce = stejná barva v každém řádku). */
export function RowAction({ job, view, className }: { job: JobListItem; view: RowFlowView; className?: string }) {
  const tone = view.next ? actionPalette(view.next.key) : null;
  const palette = tone && tone !== "ghost.proposal" ? tone : undefined;
  return (
    <RowNextAction
      jobId={job.id}
      action={view.next}
      quoteId={view.activeQuoteId}
      quoteUpdatedAt={(job.flowQuotes ?? []).find((q) => q.id === view.activeQuoteId)?.updatedAt ?? null}
      reopenOrderTo={job.flow?.orderConfirmedRevision ? "potvrzena" : "dorucena"}
      waitingNote={job.flow?.waitingNote ?? null}
      palette={palette}
      className={className}
    />
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

function JobRow({ job, today, access }: { job: JobListItem; today: string; access: BookAccess | null }) {
  const m = stageMeta(job.stage);
  const label = [job.number, job.customer?.name, job.title].filter(Boolean).join(" — ");
  const view = rowFlowView(job, access, today);
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
            <CustomerNoteMark note={job.customerNote} />
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
          <RowStateChip job={job} view={view} className="relative z-10 mt-1.5 lg:hidden" />
          {/* výjimky v toku: nová revize výkresu, bez objednávky, reklamace, opraveno */}
          <RowExceptionFlags flow={job.flow} stage={job.stage} today={today} className="relative z-10 mt-1.5 lg:hidden" />
          <ProductionLine job={job} today={today} className="mt-2 lg:hidden" />
        </div>

        {/* stav */}
        <div className="relative z-10 order-2 flex shrink-0 flex-col items-end gap-0.5 lg:order-none lg:min-w-0 lg:max-w-full lg:justify-self-end [grid-area:stage] xl:items-start xl:justify-self-start">
          <StageSelect jobId={job.id} stage={job.stage} size="sm" flow={job.flow} quotes={job.flowQuotes} exceptions />
          {/* kdo stav naposledy posunul — text na všech šířkách, ťuknutím detail */}
          <ActorStamp stamp={view.stamp} short className="max-w-[10.5rem] xl:max-w-[11rem]" />
          {/* dlouhý chip („Ohrožen konečný termín (o 8 dní)“) se zkrátí ve sloupci, nepřeteče do Termínu */}
          <RowStateChip job={job} view={view} shortFlag className="max-w-[10.5rem] xl:max-w-[11rem] hidden lg:inline-flex" />
          <RowExceptionFlags flow={job.flow} stage={job.stage} today={today} short className="hidden max-w-[10.5rem] lg:flex xl:max-w-[11rem]" />
          <ProductionLine job={job} compact today={today} className="hidden w-full max-w-[11rem] lg:flex" />
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
          <PaymentMark job={job} today={today} />
        </div>

        {/* rychlé akce */}
        <div className="relative z-10 order-6 flex basis-full flex-wrap items-center justify-end gap-1.5 lg:order-none lg:basis-auto lg:flex-nowrap [grid-area:act]">
          <span className="mr-auto lg:hidden">
            <PeopleStack owner={job.owner} assignee={job.assignee} />
          </span>
          <CaptureButton jobId={job.id} label="" variant="outline" size="icon-sm" className="text-rose-600 dark:text-rose-400" />
          <RowAction
            job={job}
            view={view}
            // desktop: jen barevná ikona (popisek zůstává pro čtečky i v bublině)
            className="lg:w-8 lg:gap-0 lg:px-0 lg:text-[0px]"
          />
        </div>
      </div>
    </li>
  );
}
