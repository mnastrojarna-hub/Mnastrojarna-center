import { BadgeCheck, Mail, PackageCheck, ShoppingCart } from "lucide-react";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { getJob, listJobs } from "@/lib/data/jobs";
import { getEmails } from "@/lib/data/queries";
import { getFlowCounts } from "@/lib/data/flow-status";
import { getFlowJobStates, getLatestOrderRevisions, listFlowStateJobIds } from "@/lib/data/flow-pages";
import type { EmailItem } from "@/lib/data/types";
import type { JobDetail } from "@/lib/jobs/types";
import { CONFIRM_QUEUE, FLOW_ACTIONS, ORDER_TAB_CHIPS, chipsForTab, stateMeta } from "@/lib/jobs/flow-status";
import { ToastProvider } from "@/components/jobs/detail/toast";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { BookLink, FlowEmpty, FlowHeader, FlowHint, FlowSection } from "@/components/flow/flow-header";
import { FlowJobList } from "@/components/flow/flow-job-list";
import { FlowMailList } from "@/components/flow/flow-mail-list";
import { FlowStateFilter } from "@/components/flow/flow-state-filter";
import { FlowRowState } from "@/components/flow/flow-row-state";
import { FlowActionBar } from "@/components/flow/flow-actions";
import { toConfirmJob, toFlowEmails, withJobMatches } from "@/components/flow/flow-data";
import { bookHref, todayPrague } from "@/components/flow/flow-utils";
import { STATE_PARAM, actionPalette, parseStateParam } from "@/components/flow/flow-state";

export const dynamic = "force-dynamic";

/** Kolik zakázek načíst i s detailem pro dialog potvrzení. */
const MAX_DETAILS = 40;
const ALL_KEYS = ORDER_TAB_CHIPS.map((c) => c.key);
const ORDER_KEYS = ORDER_TAB_CHIPS.filter((c) => c.phase === "order").map((c) => c.key);

/**
 * Potvrzení objednávek — akční seznam „K potvrzení“ (doručené, v rozporu, aktualizované);
 * další chipy (Potvrzené · Ve výrobě · Částečně dodané · Dokončené · Stornované) filtrují.
 */
export default async function ConfirmationsPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireFeature("workflow");
  const sp = (await searchParams) ?? {};
  const { can } = await getAccess();
  const mail = can("mail");
  const selected = parseStateParam(sp[STATE_PARAM], ALL_KEYS, CONFIRM_QUEUE);
  const [counts, ids, all, emails] = await Promise.all([
    getFlowCounts(),
    listFlowStateJobIds([
      { phase: "order", keys: selected.filter((k) => ORDER_KEYS.includes(k)) },
      { phase: "fulfilment", keys: selected.filter((k) => !ORDER_KEYS.includes(k)) },
    ]),
    listJobs({ sort: "deadline", dir: "asc" }),
    mail ? getEmails() : Promise.resolve([] as EmailItem[]),
  ]);
  // bez podrobných stavů (DB je nemá) aspoň objednávky podle hlavního stavu
  const jobs = ids ? all.filter((j) => ids.has(j.id)) : all.filter((j) => j.stage === "objednavka");
  const states = await getFlowJobStates(jobs.map((j) => j.id));
  const needDialog = jobs.filter((j) => {
    const s = states[j.id]?.snapshot;
    return !s || (s.order && s.order !== "stornovana" && s.confirmation !== "odeslano");
  }).slice(0, MAX_DETAILS);
  const [details, revisions] = await Promise.all([
    Promise.all(needDialog.map((j) => getJob(j.id))),
    getLatestOrderRevisions(jobs.filter((j) => (states[j.id]?.facts.orderRevision ?? 0) > 1).map((j) => j.id)),
  ]);
  const confirmById = new Map((details.filter(Boolean) as JobDetail[]).map((d) => [d.id, toConfirmJob(d)]));
  const chips = chipsForTab("confirmations", counts);
  const queueCount = Object.keys(counts).length ? CONFIRM_QUEUE.reduce((s, k) => s + (counts[`order.${k}`] ?? 0), 0) : jobs.length;
  const isDefault = selected.length === CONFIRM_QUEUE.length && CONFIRM_QUEUE.every((k) => selected.includes(k));
  const title = isDefault
    ? "K potvrzení"
    : selected.map((k) => stateMeta(ORDER_KEYS.includes(k) ? "order" : "fulfilment", k)?.label ?? k).join(", ");
  const today = todayPrague();
  const inbox = withJobMatches(toFlowEmails(emails, ["Objednávka", "Potvrzení objednávky"]), all);
  const waiting = inbox.filter((e) => !e.jobId).length;

  return (
    <div className="space-y-5">
      <FlowHeader
        tone="indigo"
        icon={PackageCheck}
        title="Potvrzení objednávek"
        count={queueCount}
        countLabel="k potvrzení"
        description={
          <>Zákazník objednal — potvrď mu termín dodání. Jedním klikem se vystaví PDF potvrzení k aktuální revizi objednávky a odejde zákazníkovi. Změnu objednávky potvrdíš (nebo odmítneš) stejně snadno.</>
        }
        step="potvrzeni"
        actions={
          <>
            <CaptureButton label="Vyfotit objednávku" variant="send" className="flex-1 shadow-md shadow-primary/20 sm:flex-none" />
            <BookLink href={bookHref("objednavky", ["objednavka"])} className="flex-1 sm:flex-none" />
          </>
        }
      />

      <FlowHint>
        <strong>Přišla objednávka na papíře nebo v PDF?</strong> Vyfoť ji — AI ji spáruje s nabídkou a pozná rozdíly
        (rozpor s nabídkou). Pak stačí <em>Potvrdit objednávku</em>. U každého stavu je vidět, kdo ho nastavil;
        ✉ znamená, že potvrzení k dané revizi opravdu odešlo.
      </FlowHint>

      <ToastProvider>
        <FlowSection
          icon={ShoppingCart}
          iconClass="bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
          title={title}
          description="Seřazeno podle termínu. Dokončené a stornované ukazují posledních 30 dní."
          count={jobs.length}
        >
          <FlowStateFilter chips={chips} selected={selected} fallback={CONFIRM_QUEUE} label="Stav objednávky" />
          {jobs.length === 0 ? (
            <FlowEmpty
              icon={BadgeCheck}
              iconClass="bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
              title={isDefault ? "Všechny objednávky jsou potvrzené 👍" : "Ve vybraných stavech nic není"}
            >
              Jakmile zákazník objedná (přijatá nabídka, objednávka z pošty nebo z fotky), objeví se tady k potvrzení.
            </FlowEmpty>
          ) : (
            <FlowJobList
              jobs={jobs}
              today={today}
              renderState={(j) => (states[j.id] ? <FlowRowState state={states[j.id]} tab="confirmations" /> : null)}
              renderAction={(j) => {
                const st = states[j.id];
                if (!st) {
                  const c = confirmById.get(j.id);
                  return c ? (
                    <FlowActionBar
                      target={{ jobId: j.id, jobNumber: j.number, confirm: c, today }}
                      next={{ key: "order.confirm", label: FLOW_ACTIONS["order.confirm"].label }}
                      menu={[]}
                      palette="orange.action"
                    />
                  ) : null;
                }
                return (
                  <FlowActionBar
                    target={{
                      jobId: j.id, jobNumber: j.number, facts: st.facts, quotes: st.quotes, quote: st.snapshot.activeQuote,
                      confirm: confirmById.get(j.id) ? { ...confirmById.get(j.id)!, orderStatus: st.facts.orderStatus, orderRevision: st.facts.orderRevision } : null,
                      revision: revisions[j.id] ?? null, orderChangeStamp: st.stamps.orderChange,
                      proposal: st.facts.proposal ? { value: st.facts.proposal, stamp: st.stamps.proposal, canDecide: st.canDecideProposal } : null,
                      today,
                    }}
                    next={st.next}
                    menu={st.menu}
                    palette={st.next ? actionPalette(st.next.key) : undefined}
                  />
                );
              }}
            />
          )}
        </FlowSection>
      </ToastProvider>

      {mail && (
        <FlowSection
          icon={Mail}
          iconClass="bg-cyan-100 text-cyan-700 dark:bg-cyan-500/15 dark:text-cyan-300"
          title="Objednávky v poště"
          description={
            waiting
              ? `${waiting} ${waiting === 1 ? "e-mail ještě nemá" : waiting < 5 ? "e-maily ještě nemají" : "e-mailů ještě nemá"} zakázku — jedním klikem ji založíš.`
              : "E-maily, které AI poznala jako objednávku nebo potvrzení objednávky (jen z tvé schránky)."
          }
          count={inbox.length}
        >
          {inbox.length === 0 ? (
            <FlowEmpty icon={Mail} iconClass="bg-cyan-100 text-cyan-600 dark:bg-cyan-500/15 dark:text-cyan-300" title="V poště žádná objednávka">
              Jakmile AI v tvé poště rozpozná objednávku, objeví se tady s tlačítkem „Založit zakázku“.
            </FlowEmpty>
          ) : (
            <FlowMailList emails={inbox} />
          )}
        </FlowSection>
      )}
    </div>
  );
}
