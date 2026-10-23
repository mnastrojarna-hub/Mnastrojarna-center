import Link from "next/link";
import { ArrowRight, BrainCircuit, FileText } from "lucide-react";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { listQuotes } from "@/lib/data/jobs";
import { getFlowCounts } from "@/lib/data/flow-status";
import { getFlowQuoteInfo } from "@/lib/data/flow-pages";
import { flowWhoFrom, getFlowScope } from "@/lib/data/flow-scope";
import { mineParam } from "@/lib/auth/flow-scope";
import { Button } from "@/components/ui/button";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { BookLink, FlowHeader, FlowHint } from "@/components/flow/flow-header";
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
  const { can } = await getAccess();
  // #25: nabídky jen „moje" (super admin všichni, nebo „Jen moje"); fronta „Ke schválení" vždy všech
  const scope = await getFlowScope(await flowWhoFrom(sp));
  const list = await listQuotes({ includeArchived: true }, { scope });
  const [info, counts] = await Promise.all([getFlowQuoteInfo(list.map((q) => q.id)), getFlowCounts({ mine: mineParam(scope) })]);
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
  const toApprove = n("ke_schvaleni");
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
            {toApprove || waiting || expired ? " " : ""}
            {toApprove ? <><strong>{toApprove}</strong> čeká na schválení. </> : null}
            {waiting ? <><strong>{waiting}</strong> čeká na odpověď zákazníka. </> : null}
            {expired ? <><strong className="text-rose-700 dark:text-rose-300">{expired}</strong> už po platnosti.</> : null}
          </>
        }
        step="nabidka"
        actions={
          <>
            <CaptureButton label="Vyfotit doklad" variant="send" className="flex-1 shadow-md shadow-primary/20 sm:flex-none" />
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <Link href="/pricing">Nacenit poptávku</Link>
            </Button>
            <BookLink href={bookHref("poptavky", ["nabidka"])} className="w-full sm:w-auto" />
          </>
        }
      />

      <FlowHint>
        <strong>Postup:</strong> nabídku od AI (nebo nad limitem) nejdřív <em>Schval</em> — jinak ji nejde odeslat.
        Pak <em>Odeslat nabídku</em> (PDF se vytvoří samo a odejde z tvé schránky). Až zákazník odpoví:{" "}
        <em>Zákazník objednal</em>, <em>Připomínky</em> (nová verze), nebo <em>Zamítnout</em> s důvodem.
      </FlowHint>

      <QuotesBoard
        quotes={quotes}
        today={today}
        counts={hasCounts ? counts : null}
        initialStates={Array.isArray(raw) ? raw.join(",") : raw ?? null}
      />

      {can("ai_pricing") && (
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
