import Link from "next/link";
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
import { ExceptionChips } from "@/components/jobs/book/exception-chips";
import { getFlowExceptionCounts } from "@/lib/data/flow-exceptions";
import type { BookAccess } from "@/components/jobs/book/book-flow";
import { getFlowCounts } from "@/lib/data/flow-status";
import { BookEmpty } from "@/components/jobs/book/book-empty";
import { StageLegend } from "@/components/jobs/book/stage-legend";
import {
  DEFAULT_PARAMS, bookKpis, bookParamsToFilters, bookQuery, bookSegment, boardStages, countLabel, defaultStageFor, firstParam,
  isFiltered, parseBookParams, segmentCounts, segmentStageCounts, sumValue, todayInPrague,
} from "@/components/jobs/book/book-params";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { FEATURE_HINTS, FEATURE_LABELS, type Feature } from "@/lib/auth/permissions";
import { listJobs, getJobStageCounts, getJobFormOptions, countOverdueInvoices } from "@/lib/data/jobs";
import { listQuoteApprovers } from "@/lib/data/current-user";
import { listOperationLocations } from "@/lib/data/production";

/**
 * Kolik řádků vykreslit napoprvé a o kolik přidat odkazem „Zobrazit další" (?radku=…). Každý řádek je
 * ~7 kB HTML + ~4 kB dat stránky — 300 řádků = 4,8 MB a 1,8 s serveru; 60 řádků pokryje první obrazovky.
 */
const ROW_PAGE = 60;
const ROW_STEP = 200;
const ROW_MAX = 2000;

/** Počet řádků z ?radku= (60…2000). */
function rowLimit(raw: string | null | undefined): number {
  const n = Math.floor(Number(raw));
  return Number.isFinite(n) && n > ROW_PAGE ? Math.min(n, ROW_MAX) : ROW_PAGE;
}

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
  const chipSegment = params.segment === "objednavky" || params.segment === "poptavky";
  const today = todayInPrague();
  // „Hodnota v běhu" (jen s právem na marže) = VŠECHNY objednávky v běhu (bez DL na vše) — stejné filtry jako
  // záložka Objednávky bez dalších filtrů, ne jen zobrazené řádky; dotaz do DB sdílí se seznamem (React cache).
  // „Po splatnosti" = vlastní dotaz přes celou knihu (vyfakturované jsou v Dokončených).
  const [jobs, counts, options, running, overdueInvoices, production, flowCounts, quoteApprovers, exceptionCounts] = await Promise.all([
    listJobs(bookParamsToFilters(params)),
    getJobStageCounts(),
    getJobFormOptions(),
    margins ? listJobs(bookParamsToFilters({ ...DEFAULT_PARAMS, segment: "objednavky" })) : Promise.resolve([]),
    countOverdueInvoices(today),
    listOperationLocations(),
    chipSegment ? getFlowCounts() : Promise.resolve({} as Record<string, number>),
    // 31. 10.: schvalovatelé (štítek „čeká na schválení (V. Volný nebo super admin)“)
    listQuoteApprovers(),
    // výjimky v toku (Bez objednávky, Reklamace, Pozastaveno, Nová revize výkresu, důvody prohry)
    getFlowExceptionCounts(),
  ]);
  const access: BookAccess = {
    features, userId: user.id, role: user.role, quoteNeedsApproval: user.quoteNeedsApproval !== false, quoteApprovers,
  };

  const filtered = isFiltered(params);
  const defaultStage = defaultStageFor(params.segment);
  // #25: obchodníka zakázky volí jen super admin — ostatním ho doplní server (obchodník zákazníka)
  const ownerEditable = user.role === "super_admin";
  const newJobInitial = { stage: defaultStage, ownerId: ownerEditable ? user.id : null };
  const segment = bookSegment(params.segment);
  const rows = jobs.slice(0, rowLimit(firstParam(sp, "radku")));
  const moreQuery = new URLSearchParams(bookQuery(params));
  moreQuery.set("radku", String(Math.min(rows.length + ROW_STEP, ROW_MAX)));

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
          <SegmentTabs counts={segmentCounts(counts.byStage, counts.deliveredByStage)} />
          <StageChips byStage={segmentStageCounts(counts.byStage, counts.deliveredByStage, params.segment)} />
          {chipSegment && <FlowFilterChips counts={flowCounts} />}
          <ExceptionChips counts={exceptionCounts} />
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
                  Zobrazuji prvních {rows.length} — zpřesni hledání nebo filtry, nebo zobraz další dole.
                </span>
              )}
            </p>
          )}

          {jobs.length === 0 ? (
            <BookEmpty segment={params.segment} filtered={filtered} options={options} defaultStage={defaultStage} userId={user.id} />
          ) : params.view === "tabule" ? (
            <JobBoard jobs={jobs} stages={boardStages(params, jobs)} today={today} access={access} />
          ) : (
            <>
              <JobRowsHeader />
              <JobRows jobs={rows} today={today} access={access} />
              {jobs.length > rows.length && rows.length < ROW_MAX && (
                <div className="flex justify-center pt-1">
                  <Link
                    href={`/orders?${moreQuery.toString()}`}
                    scroll={false}
                    prefetch={false}
                    className="rounded-full border bg-card px-4 py-1.5 text-sm font-medium shadow-sm hover:bg-muted"
                  >
                    Zobrazit další {Math.min(ROW_STEP, jobs.length - rows.length)} z {jobs.length - rows.length}
                  </Link>
                </div>
              )}
            </>
          )}
        </BookPending>

        <StageLegend />
      </div>
    </BookNavProvider>
  );
}
