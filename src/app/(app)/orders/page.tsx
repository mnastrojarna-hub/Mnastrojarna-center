import { PageHeader } from "@/components/page-header";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { NewJobDialog } from "@/components/jobs/new-job-dialog";
import { BookNavProvider, BookPending } from "@/components/jobs/book/book-nav";
import { AccessBanner, BookHint } from "@/components/jobs/book/access-banner";
import { KpiStrip } from "@/components/jobs/book/kpi-strip";
import { SegmentTabs, StageChips } from "@/components/jobs/book/segment-tabs";
import { BookToolbar } from "@/components/jobs/book/book-toolbar";
import { JobRows, JobRowsHeader } from "@/components/jobs/book/job-rows";
import { JobBoard } from "@/components/jobs/book/job-board";
import { FlowFilterChips } from "@/components/jobs/book/flow-filter-chips";
import type { BookAccess } from "@/components/jobs/book/book-flow";
import { getFlowCounts } from "@/lib/data/flow-status";
import { BookEmpty } from "@/components/jobs/book/book-empty";
import { StageLegend } from "@/components/jobs/book/stage-legend";
import {
  ORDER_STAGES, bookKpis, bookParamsToFilters, bookSegment, boardStages, countLabel, defaultStageFor, firstParam,
  isFiltered, parseBookParams, segmentCounts, sumValue, todayInPrague,
} from "@/components/jobs/book/book-params";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { FEATURE_HINTS, FEATURE_LABELS, type Feature } from "@/lib/auth/permissions";
import { listJobs, getJobStageCounts, getJobFormOptions } from "@/lib/data/jobs";
import { listOperationLocations } from "@/lib/data/production";
import { paymentStateOf } from "@/lib/jobs/mapping";

/** Kolik řádků vykreslit najednou (víc = zpřesnit hledání). */
const ROW_LIMIT = 300;

// předání do výroby z Knihy: jedno odeslání = PDF objednávek + e-maily dodavatelům (akce běží ve funkci stránky)
export const maxDuration = 60;

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireFeature("orders");
  const sp = await searchParams;
  const params = parseBookParams(sp);
  const capture = firstParam(sp, "capture") === "1";
  const newJob = firstParam(sp, "new") === "1";
  const pristupKey = firstParam(sp, "pristup");
  const pristup = pristupKey && Object.prototype.hasOwnProperty.call(FEATURE_LABELS, pristupKey)
    ? FEATURE_LABELS[pristupKey as Feature]
    : null;

  const { can, features } = await getAccess();
  const margins = can("margins");
  const access: BookAccess = { features, userId: user.id, role: user.role };
  const chipSegment = params.segment === "objednavky" || params.segment === "poptavky";
  // objednávky v běhu: hodnota (jen s právem na marže) a faktury po splatnosti
  const [jobs, counts, options, running, production, flowCounts] = await Promise.all([
    listJobs(bookParamsToFilters(params)),
    getJobStageCounts(),
    getJobFormOptions(),
    listJobs({ stages: ORDER_STAGES }),
    listOperationLocations(),
    chipSegment ? getFlowCounts() : Promise.resolve({} as Record<string, number>),
  ]);

  const today = todayInPrague();
  const overdueInvoices = running.filter((j) => paymentStateOf(j, today) === "po_splatnosti").length;
  const filtered = isFiltered(params);
  const defaultStage = defaultStageFor(params.segment);
  // #25: obchodníka zakázky volí jen super admin — ostatním ho doplní server (obchodník zákazníka)
  const ownerEditable = user.role === "super_admin";
  const newJobInitial = { stage: defaultStage, ownerId: ownerEditable ? user.id : null };
  const segment = bookSegment(params.segment);
  const rows = jobs.slice(0, ROW_LIMIT);

  return (
    <BookNavProvider params={params}>
      <div className="space-y-5">
        {pristup && <AccessBanner label={pristup} hint={FEATURE_HINTS[pristupKey as Feature] ?? null} />}
        <BookHint />

        <PageHeader
          title="Kniha zakázek"
          description="Každá zakázka na jednom řádku — klikni pro detail. Vyfoť doklad a AI ho zařadí sama."
          actions={
            <>
              <CaptureButton autoOpen={capture} label="Vyfotit doklad" variant="send" className="flex-1 shadow-md shadow-primary/20 sm:flex-none" />
              <NewJobDialog options={options} initial={newJobInitial} autoOpen={newJob} className="flex-1 sm:flex-none" />
            </>
          }
        />

        <KpiStrip kpis={bookKpis(counts)} runningValue={margins ? sumValue(running) : null} overdueInvoices={overdueInvoices} />

        <section aria-label="Filtry knihy" className="space-y-3 rounded-2xl border bg-card p-2.5 shadow-sm sm:p-3">
          <SegmentTabs counts={segmentCounts(counts.byStage)} />
          <StageChips byStage={counts.byStage} />
          {chipSegment && <FlowFilterChips counts={flowCounts} />}
          <BookToolbar options={options} production={production} />
        </section>

        <BookPending className="space-y-2">
          {jobs.length > 0 && (
            <p className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 px-1 text-xs text-muted-foreground">
              <span>
                <strong className="text-foreground">{countLabel(jobs.length, "zakázka", "zakázky", "zakázek")}</strong>
                {" · "}
                {filtered ? "podle filtrů" : segment.hint}
              </span>
              {params.view === "radky" && jobs.length > rows.length && (
                <span className="font-medium text-amber-700 dark:text-amber-400">
                  Zobrazuji prvních {rows.length} — zpřesni hledání nebo filtry.
                </span>
              )}
            </p>
          )}

          {jobs.length === 0 ? (
            <BookEmpty segment={params.segment} filtered={filtered} options={options} defaultStage={defaultStage} userId={user.id} />
          ) : params.view === "tabule" ? (
            <JobBoard jobs={jobs} stages={boardStages(params)} today={today} access={access} />
          ) : (
            <>
              <JobRowsHeader />
              <JobRows jobs={rows} today={today} access={access} />
            </>
          )}
        </BookPending>

        <StageLegend />
      </div>
    </BookNavProvider>
  );
}
