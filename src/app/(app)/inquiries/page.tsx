import Link from "next/link";
import { Calculator, EyeOff, FilePlus, Inbox, MessageSquareQuote, Mail, MessagesSquare } from "lucide-react";
import { FlowScopeBar } from "@/components/flow/flow-scope-bar";
import { scopeBarData } from "@/components/flow/flow-scope-copy";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { listJobs, getJobFormOptions } from "@/lib/data/jobs";
import { getEmails } from "@/lib/data/queries";
import { getFlowCounts } from "@/lib/data/flow-status";
import { getFlowJobStates, listFlowStateJobIds } from "@/lib/data/flow-pages";
import { flowWhoFrom, getFlowScope } from "@/lib/data/flow-scope";
import { mineParam } from "@/lib/auth/flow-scope";
import type { EmailItem } from "@/lib/data/types";
import { INQUIRY_ORDER, INQUIRY_STATES, OPEN_INQUIRY, chipsForTab } from "@/lib/jobs/flow-status";
import { Button } from "@/components/ui/button";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { ToastProvider } from "@/components/jobs/detail/toast";
import { BookLink, FlowEmpty, FlowHeader, FlowHint, FlowSection } from "@/components/flow/flow-header";
import { FlowJobList } from "@/components/flow/flow-job-list";
import { FlowMailList } from "@/components/flow/flow-mail-list";
import { FlowStateFilter } from "@/components/flow/flow-state-filter";
import { FlowRowState } from "@/components/flow/flow-row-state";
import { FlowActionBar } from "@/components/flow/flow-actions";
import { toFlowEmails } from "@/components/flow/flow-data";
import { QuickInquiryDialog } from "@/components/flow/quick-inquiry-dialog";
import { bookHref, todayPrague } from "@/components/flow/flow-utils";
import { CLOSED_JOB_KEYS, STATE_PARAM, actionPalette, parseStateParam } from "@/components/flow/flow-state";
import { getAnonPending, getAnonReviewList, getJobAnonBadges } from "@/lib/data/anonymize";
import { AnonymizeToolButton } from "@/components/anonymize/anonymize-tool-dialog";
import { JobAnonBadge } from "@/components/anonymize/anon-badge";
import { AnonReviewChip, AnonReviewList, type AnonReviewRowView } from "@/components/anonymize/anon-review-section";
import type { AnonUiStatus } from "@/components/anonymize/anon-status";

export const dynamic = "force-dynamic";

/** Stavy, ve kterých může být otevřená poptávka (zbytek načte jen výběr uzavřených). */
const OPEN_STAGES = ["poptavka", "naceneni", "pozastaveno", "reklamace"] as const;

/** Poptávky — první krok toku: Přijatá → V řešení / Čeká na podklady → Zpracovaná / Odmítnutá / Stažená. */
export default async function InquiriesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireFeature("workflow");
  const sp = (await searchParams) ?? {};
  const { can } = await getAccess();
  const mail = can("mail");
  // #25: Nacenění zatím jen super admin — ostatní nabídku vytvoří ručně v kartě zakázky
  const canPrice = can("pricing");
  const selected = parseStateParam(sp[STATE_PARAM], INQUIRY_ORDER, OPEN_INQUIRY);
  const withClosed = selected.some((k) => CLOSED_JOB_KEYS.includes(k));
  // #25: obchodní tok jen „moje" (super admin všichni, nebo „Jen moje")
  const scope = await getFlowScope(await flowWhoFrom(sp));
  const [counts, ids, all, options, allEmails] = await Promise.all([
    getFlowCounts({ mine: mineParam(scope) }),
    listFlowStateJobIds([{ phase: "inquiry", keys: selected }], { scope }),
    listJobs(withClosed ? { sort: "deadline", dir: "asc" } : { stages: [...OPEN_STAGES], sort: "deadline", dir: "asc" }, { scope }),
    getJobFormOptions(),
    mail ? getEmails() : Promise.resolve([] as EmailItem[]),
  ]);
  // pošta je už podle schránek; super admin v „Jen moje" jen své schránky
  const emails = scope && scope.canToggle && !scope.all
    ? allEmails.filter((e) => Boolean(e.mailboxId && scope.mailboxIds.includes(e.mailboxId)))
    : allEmails;
  // bez podrobných stavů (DB je nemá) aspoň poptávky podle hlavního stavu
  const jobs = ids ? all.filter((j) => ids.has(j.id)) : all.filter((j) => j.stage === "poptavka");
  const [states, anonBadges, anonReview, anonPending] = await Promise.all([
    getFlowJobStates(jobs.map((j) => j.id)),
    getJobAnonBadges(jobs.map((j) => j.id)),
    getAnonReviewList({ scope, limit: 30 }),
    getAnonPending(scope),
  ]);
  const reviewRows: AnonReviewRowView[] = anonReview.map((r) => ({
    id: r.id, jobId: r.jobId, jobNumber: r.jobNumber, jobTitle: r.jobTitle, filename: r.filename, anonFilename: r.anonFilename,
    status: r.status as AnonUiStatus, reason: r.reason, counts: (r.summary?.counts ?? {}) as Record<string, number>, at: r.at,
    total: typeof r.summary?.total === "number" ? r.summary.total : null, crop: r.crop, page: r.page,
  }));
  // „Ke kontrole anonymizace": s položkami nahoře (nad seznamem poptávek), jen čekající → dole
  const anonSection = (reviewRows.length > 0 || anonPending.count > 0) ? (
    <FlowSection
      id="anonymizace"
      icon={EyeOff}
      iconClass="bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300"
      title="Ke kontrole anonymizace"
      description="Výkresy pro dodavatele, u kterých si AI nebyla jistá (nebo se anonymizace nepovedla). Zkontroluj náhled a schval."
      count={reviewRows.length}
    >
      <AnonReviewList items={reviewRows} pendingFileIds={anonPending.fileIds} pendingCount={anonPending.count} />
    </FlowSection>
  ) : null;
  const chips = chipsForTab("inquiries", counts);
  const openCount = Object.keys(counts).length ? OPEN_INQUIRY.reduce((s, k) => s + (counts[`inquiry.${k}`] ?? 0), 0) : jobs.length;
  const isDefault = selected.length === OPEN_INQUIRY.length && OPEN_INQUIRY.every((k) => selected.includes(k));
  const today = todayPrague();
  const inbox = toFlowEmails(emails, ["Poptávka"]);
  const waiting = inbox.filter((e) => !e.jobId).length;
  // Pošta B: komunikace k rozpracovaným poptávkám (přiřazená pošta „K zakázce")
  const inquiryIds = new Set(jobs.map((j) => j.id));
  const talk = toFlowEmails(emails.filter((e) => e.jobId && inquiryIds.has(e.jobId)), ["K zakázce"], 20);

  return (
    <div className="space-y-5">
      <FlowHeader
        tone="sky"
        icon={MessageSquareQuote}
        title="Poptávky"
        count={openCount}
        countLabel="otevřených"
        description={
          <>Zákazník chce díl — tady je každá poptávka: kdo ji převzal, co chybí a jak dopadla. Přijde e-mailem (AI ji pozná sama), vyfotíš ji, nebo ji zadáš ručně.</>
        }
        step="poptavka"
        canPrice={canPrice}
        actions={
          <>
            <CaptureButton label="Vyfotit poptávku" variant="send" className="flex-1 shadow-md shadow-primary/20 sm:flex-none" />
            <QuickInquiryDialog customers={options.customers} label="Nová poptávka" className="flex-1 sm:flex-none" />
            <AnonymizeToolButton className="flex-1 sm:flex-none" />
            <BookLink href={bookHref("poptavky", ["poptavka"])} className="w-full sm:w-auto" />
          </>
        }
      >
        <FlowScopeBar scope={scopeBarData(scope)} />
        {reviewRows.length > 0 && <AnonReviewChip count={reviewRows.length} />}
      </FlowHeader>

      {canPrice ? (
        <FlowHint>
          <strong>Jak dál:</strong> novou poptávku <em>Převezmi</em> (budeš její řešitel), chybí-li výkres nebo množství, dej{" "}
          <em>Čeká na podklady</em> — až podklady přijdou, stav skončí sám. Pak{" "}
          <Link href="/pricing" className="font-semibold text-amber-700 underline-offset-2 hover:underline dark:text-amber-300">Nacenit</Link>.
          U každého stavu vidíš, kdo ho nastavil.
        </FlowHint>
      ) : (
        <FlowHint>
          <strong>Jak dál:</strong> novou poptávku <em>Převezmi</em> (budeš ji zpracovávat), chybí-li výkres nebo množství, dej{" "}
          <em>Čeká na podklady</em>. Pak <em>Vytvoř nabídku</em> v kartě zakázky — super admin ji schválí a ty ji odešleš.
          U každého stavu vidíš, kdo ho nastavil.
        </FlowHint>
      )}

      {reviewRows.length > 0 && anonSection}

      <ToastProvider>
        <FlowSection
          icon={MessageSquareQuote}
          iconClass="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
          title={isDefault ? "Otevřené poptávky" : selected.map((k) => INQUIRY_STATES[k as keyof typeof INQUIRY_STATES]?.label ?? k).join(", ")}
          description="Seřazeno podle termínu — nahoře to, co nejvíc spěchá. Uzavřené stavy ukazují posledních 30 dní."
          count={jobs.length}
        >
          <FlowStateFilter chips={chips} selected={selected} fallback={OPEN_INQUIRY} label="Stav poptávky" />
          {scope?.error ? null : jobs.length === 0 ? (
            <FlowEmpty
              icon={Inbox}
              iconClass="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300"
              title={isDefault ? "Žádná poptávka nečeká 🎉" : "Ve vybraných stavech nic není"}
              actions={<QuickInquiryDialog customers={options.customers} label="Zadat poptávku ručně" variant="outline" />}
            >
              Nové poptávky sem přijdou samy z pošty. Máš poptávku na papíře? Vyfoť ji tlačítkem „Vyfotit poptávku“ — AI ji přečte a založí.
            </FlowEmpty>
          ) : (
            <FlowJobList
              jobs={jobs}
              today={today}
              renderState={(j) => (states[j.id] ? <FlowRowState state={states[j.id]} tab="inquiries" /> : null)}
              renderBadge={(j) => <JobAnonBadge badge={anonBadges[j.id]} />}
              renderAction={(j) => {
                const st = states[j.id];
                if (!st) {
                  return canPrice ? (
                    <Button asChild size="sm" className="min-h-11 w-full bg-amber-500 text-amber-950 shadow-sm hover:bg-amber-500/90 sm:min-h-9 sm:w-auto">
                      <Link href={`/pricing?job=${j.id}`}><Calculator className="h-4 w-4" /> Nacenit</Link>
                    </Button>
                  ) : (
                    <Button asChild size="sm" className="min-h-11 w-full bg-violet-700 text-white shadow-sm hover:bg-violet-800 sm:min-h-9 sm:w-auto">
                      <Link href={`/orders/${j.id}?tab=nabidky&nova=1`}><FilePlus className="h-4 w-4" /> Vytvořit nabídku</Link>
                    </Button>
                  );
                }
                return (
                  <FlowActionBar
                    target={{
                      jobId: j.id, jobNumber: j.number, facts: st.facts, quotes: st.quotes, quote: st.snapshot.activeQuote,
                      today, onlyOpenQuote: st.quotes.filter((q) => !q.archived && q.status !== "zamitnuto").length === 1,
                      quoteAuthor: st.quoteAuthor ?? null,
                    }}
                    next={st.next}
                    menu={st.menu}
                    palette={st.next ? actionPalette(st.next.key) : undefined}
                    canPrice={canPrice}
                  />
                );
              }}
            />
          )}
        </FlowSection>
      </ToastProvider>

      {reviewRows.length === 0 && anonSection}

      {mail && talk.length > 0 && (
        <FlowSection
          icon={MessagesSquare}
          iconClass="bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300"
          title="Komunikace k poptávkám"
          description="Doplnění a změny k rozpracovaným poptávkám — AI je přiřadila samy, technické změny jsou v historii a v záložce Komunikace."
          count={talk.length}
        >
          <FlowMailList emails={talk} />
        </FlowSection>
      )}

      {mail && (
        <FlowSection
          icon={Mail}
          iconClass="bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300"
          title="Poptávky v poště"
          description={
            waiting
              ? `${waiting} ${waiting === 1 ? "e-mail ještě nemá" : waiting < 5 ? "e-maily ještě nemají" : "e-mailů ještě nemá"} zakázku — jedním klikem ji založíš.`
              : "E-maily, které AI poznala jako poptávku (jen z tvé schránky)."
          }
          count={inbox.length}
        >
          {inbox.length === 0 ? (
            <FlowEmpty icon={Mail} iconClass="bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300" title="V poště žádná poptávka">
              Jakmile AI v tvé poště rozpozná poptávku, objeví se tady s tlačítkem „Založit zakázku“.
            </FlowEmpty>
          ) : (
            <FlowMailList emails={inbox} />
          )}
        </FlowSection>
      )}
    </div>
  );
}
