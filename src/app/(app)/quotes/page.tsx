import Link from "next/link";
import { ArrowRight, BrainCircuit, FileText } from "lucide-react";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { listQuotes } from "@/lib/data/jobs";
import { Button } from "@/components/ui/button";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { BookLink, FlowHeader, FlowHint } from "@/components/flow/flow-header";
import { QuotesBoard } from "@/components/flow/quotes-board";
import { toFlowQuote } from "@/components/flow/flow-data";
import { bookHref, isQuoteExpired, todayPrague } from "@/components/flow/flow-utils";

export const dynamic = "force-dynamic";

/** Nabídky — všechny nabídky všech zakázek: kdo zadal, kdo schválil, kdy odešla, platnost. */
export default async function QuotesPage() {
  await requireFeature("workflow");
  const { can } = await getAccess();
  const quotes = (await listQuotes({ includeArchived: true })).map(toFlowQuote);
  const today = todayPrague();
  const active = quotes.filter((q) => !q.archived);
  const toApprove = active.filter((q) => (q.status === "ke_schvaleni" || q.status === "navrh_ai") && !q.approvedBy).length;
  const waiting = active.filter((q) => q.status === "odeslano").length;
  const expired = active.filter((q) => isQuoteExpired(q, today)).length;

  return (
    <div className="space-y-5">
      <FlowHeader
        tone="violet"
        icon={FileText}
        title="Nabídky"
        count={active.length}
        description={
          <>
            Každá nabídka zákazníkovi na jednom místě — kdo ji připravil, kdo schválil, kdy odešla a do kdy platí.
            {toApprove || waiting || expired ? " " : ""}
            {toApprove ? <><strong>{toApprove}</strong> čeká na schválení. </> : null}
            {waiting ? <><strong>{waiting}</strong> čeká na odpověď zákazníka. </> : null}
            {expired ? <><strong className="text-red-600 dark:text-red-400">{expired}</strong> už po platnosti.</> : null}
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
        <strong>Postup:</strong> nabídku <em>Schválit</em> → <em>Odeslat</em> (PDF se vytvoří samo a odejde z tvé schránky) →
        až zákazník odpoví, klikni <em>Přijata</em> (zakázka se posune do Objednávek) nebo <em>Zamítl</em>.
        Starší verze nabídek jsou v archivu.
      </FlowHint>

      <QuotesBoard quotes={quotes} today={today} />

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
