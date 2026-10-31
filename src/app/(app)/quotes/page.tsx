import Link from "next/link";
import { ArrowRight, BrainCircuit, FileText, ShieldAlert } from "lucide-react";
import { listPendingQuoteApprovals } from "@/lib/data/queries";
import { listQuoteApprovers } from "@/lib/data/current-user";
import { quoteApproverWho } from "@/lib/jobs/flow-status";
import { FlowScopeBar } from "@/components/flow/flow-scope-bar";
import { scopeBarData } from "@/components/flow/flow-scope-copy";
import { QuoteApprovalList } from "@/components/flow/quote-approval-list";
import { czWaits } from "@/components/flow/quote-approval-copy";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { listQuotes } from "@/lib/data/jobs";
import { getFlowCounts } from "@/lib/data/flow-status";
import { getFlowQuoteInfo } from "@/lib/data/flow-pages";
import { flowWhoFrom, getFlowScope } from "@/lib/data/flow-scope";
import { mineParam } from "@/lib/auth/flow-scope";
import { Button } from "@/components/ui/button";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { BookLink, FlowHeader, FlowHint, FlowSection } from "@/components/flow/flow-header";
import { QuotesBoard } from "@/components/flow/quotes-board";
import { toFlowQuote } from "@/components/flow/flow-data";
import { bookHref, todayPrague } from "@/components/flow/flow-utils";
import { STATE_PARAM } from "@/components/flow/flow-state";

export const dynamic = "force-dynamic";

/**
 * Nabídky — všechny nabídky všech zakázek: Rozpracovaná → Čeká na schválení → Schválená →
 * Odeslaná → Přijatá / Zamítnutá; kdo zadal, schválil, odeslal (e-mailem / jinak) a kdy.
 */
export default async function QuotesPage({
  searchParams,
}: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireFeature("workflow");
  const sp = (await searchParams) ?? {};
  const { can, user } = await getAccess();
  // #25: nabídky jen „moje" (super admin všichni, nebo „Jen moje"); fronta „Ke schválení" vždy všech
  const scope = await getFlowScope(await flowWhoFrom(sp));
  const canPrice = can("pricing");
  const approver = can("quote_approval");
  // 31. 10.: schvalovatel, který není super admin (schvaluje cizí nabídky se schvalováním; své odesílá sám)
  const peerApprover = approver && user?.role !== "super_admin";
  // počty, fronta schvalování a schvalovatelé na seznamu nezávisí — běží souběžně s ním (o round-trip dřív)
  const countsP = getFlowCounts({ mine: mineParam(scope) });
  const pendingP = approver ? listPendingQuoteApprovals() : Promise.resolve([]);
  const approversP = listQuoteApprovers();
  const list = await listQuotes({ includeArchived: true }, { scope });
  const [info, counts, pending, approvers] = await Promise.all([getFlowQuoteInfo(list.map((q) => q.id)), countsP, pendingP, approversP]);
  // kdo schvaluje nabídky přihlášeného (schvalovatelé kromě něj + super admin)
  const myWho = quoteApproverWho(approvers, user?.id ?? null);
  const today = todayPrague();
  const openByJob = new Map<string, number>();
  for (const q of list) {
    if (q.job && !q.archived && (q.status === "navrh_ai" || q.status === "ke_schvaleni" || q.status === "odeslano")) {
      openByJob.set(q.job.id, (openByJob.get(q.job.id) ?? 0) + 1);
    }
  }
  const quotes = list.map((q) => toFlowQuote(q, info[q.id], { today, onlyOpen: Boolean(q.job && openByJob.get(q.job.id) === 1) }));
  const hasCounts = Object.keys(counts).length > 0;
  const n = (k: string) => (hasCounts ? counts[`quote.${k}`] ?? 0 : quotes.filter((q) => q.display === k).length);
  // #25: „čeká na schválení“ = stejné číslo jako sekce „Ke schválení“ a odznak (vrácené autorovi se nepočítají)
  const pendingMine = quotes.filter((q) => q.display === "ke_schvaleni" && !q.archived);
  const toApprove = approver ? pending.length : pendingMine.filter((q) => !q.facts.returnedAt).length;
  const returned = approver && !peerApprover ? 0 : pendingMine.filter((q) => q.facts.returnedAt && q.facts.createdBy === user?.id).length;
  const waiting = n("odeslana");
  const expired = n("vyprsela");
  const active = quotes.filter((q) => !q.archived && q.display !== "prijata" && q.display !== "zamitnuta").length;
  const raw = sp[STATE_PARAM];

  return (
    <div className="space-y-5">
      <FlowHeader
        tone="violet"
        icon={FileText}
        title="Nabídky"
        count={active}
        countLabel="otevřených"
        description={
          <>
            Každá nabídka zákazníkovi na jednom místě — kdo ji připravil, kdo schválil, kdy a jak odešla a do kdy platí.
            {toApprove || returned || waiting || expired ? " " : ""}
            {toApprove ? <><strong>{toApprove}</strong> {czWaits(toApprove)} {approver ? "na tvé schválení" : myWho ? `na schválení (${myWho})` : "na schválení super admina"}. </> : null}
            {returned ? <><strong>{returned}</strong> {returned === 1 ? "vrácena" : returned <= 4 ? "vráceny" : "vráceno"} k přepracování. </> : null}
            {waiting ? <><strong>{waiting}</strong> čeká na odpověď zákazníka. </> : null}
            {expired ? <><strong className="text-rose-700 dark:text-rose-300">{expired}</strong> už po platnosti.</> : null}
          </>
        }
        step="nabidka"
        canPrice={canPrice}
        actions={
          <>
            <CaptureButton label="Vyfotit doklad" variant="send" className="flex-1 shadow-md shadow-primary/20 sm:flex-none" />
            {canPrice ? (
              <Button asChild variant="outline" className="flex-1 sm:flex-none">
                <Link href="/pricing">Nacenit poptávku</Link>
              </Button>
            ) : (
              <Button asChild variant="outline" className="flex-1 sm:flex-none">
                <Link href="/inquiries">Vytvořit nabídku k poptávce</Link>
              </Button>
            )}
            <BookLink href={bookHref("poptavky", ["nabidka"])} className="w-full sm:w-auto" />
          </>
        }
      >
        <FlowScopeBar scope={scopeBarData(scope)} />
      </FlowHeader>

      {approver && !peerApprover ? (
        <FlowHint>
          <strong>Postup:</strong> nabídky od kolegů a od AI čekají na tvé schválení — <em>Schválit</em>, rovnou{" "}
          <em>Schválit a odeslat</em>, nebo <em>Vrátit k přepracování</em>. Tvoje vlastní nabídky schválení nepotřebují.
        </FlowHint>
      ) : peerApprover ? (
        <FlowHint>
          <strong>Postup:</strong> nabídky kolegů, kteří potřebují schválení, čekají na tvé schválení — <em>Schválit</em>,
          {can("margins") ? <> rovnou <em>Schválit a odeslat</em>,</> : null} nebo <em>Vrátit k přepracování</em>. Vlastní nabídku neschvaluješ —{" "}
          {user?.quoteNeedsApproval === false
            ? <>tvoje schválení nepotřebují; zákazníkovi je pošleš tlačítkem <em>Odeslat zákazníkovi</em>.</>
            : <>tvoje {myWho ? `schválí ${myWho}` : "schválí super admin"}.</>}
        </FlowHint>
      ) : (
        <FlowHint>
          <strong>Postup:</strong> nabídku vytvoříš v kartě zakázky (záložka Nabídky). Než odejde zákazníkovi, schválí ji{" "}
          {myWho ?? "super admin"} — do té doby je označená „Neschválená“ a odeslat ji nejde. Po schválení ji odešleš tlačítkem{" "}
          <em>Odeslat nabídku</em>.
        </FlowHint>
      )}

      {approver && (
        // #25: fronta super admina — vždy všech (i při „Jen moje“); 31. 10. schvalovatel jen cizí nabídky se schvalováním
        <FlowSection
          id="ke-schvaleni"
          icon={ShieldAlert}
          iconClass="bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300"
          title={`Ke schválení (${pending.length})`}
          description={peerApprover
            ? "Nabídky kolegů, které potřebují schválení. Bez schválení je nejde odeslat."
            : "Nabídky od kolegů a od AI. Bez schválení je nejde odeslat."}
        >
          <QuoteApprovalList items={pending} canSend={can("margins")} />
        </FlowSection>
      )}

      {scope?.error ? null : (
        <QuotesBoard
          quotes={quotes}
          today={today}
          counts={hasCounts ? counts : null}
          initialStates={Array.isArray(raw) ? raw.join(",") : raw ?? null}
          canPrice={canPrice}
          approver={approver}
        />
      )}

      {can("ai_pricing") && canPrice && (
        <Link
          href="/pricing"
          className="flex items-center gap-2.5 rounded-xl border border-dashed p-3 text-sm text-muted-foreground transition hover:bg-accent"
        >
          <BrainCircuit className="h-4 w-4 text-violet-500" />
          <span className="flex-1">AI návrh ceny (jen pro ladění) je v Nacenění — sekce dole.</span>
          <ArrowRight className="h-4 w-4" />
        </Link>
      )}
    </div>
  );
}
