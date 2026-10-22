import Link from "next/link";
import { Calculator, Inbox, MessageSquareQuote, Mail } from "lucide-react";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { listJobs, getJobFormOptions } from "@/lib/data/jobs";
import { getEmails } from "@/lib/data/queries";
import type { EmailItem } from "@/lib/data/types";
import { Button } from "@/components/ui/button";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { BookLink, FlowEmpty, FlowHeader, FlowHint, FlowSection } from "@/components/flow/flow-header";
import { FlowJobList } from "@/components/flow/flow-job-list";
import { FlowMailList } from "@/components/flow/flow-mail-list";
import { toFlowEmails } from "@/components/flow/flow-data";
import { QuickInquiryDialog } from "@/components/flow/quick-inquiry-dialog";
import { bookHref, todayPrague } from "@/components/flow/flow-utils";

export const dynamic = "force-dynamic";

/** Poptávky — první krok toku: co zákazníci poptali (kniha + pošta). */
export default async function InquiriesPage() {
  await requireFeature("workflow");
  const { can } = await getAccess();
  const mail = can("mail");
  const [jobs, options, emails] = await Promise.all([
    listJobs({ stages: ["poptavka"], sort: "deadline", dir: "asc" }),
    getJobFormOptions(),
    mail ? getEmails() : Promise.resolve([] as EmailItem[]),
  ]);
  const today = todayPrague();
  const inbox = toFlowEmails(emails, ["Poptávka"]);
  const waiting = inbox.filter((e) => !e.jobId).length;

  return (
    <div className="space-y-5">
      <FlowHeader
        tone="sky"
        icon={MessageSquareQuote}
        title="Poptávky"
        count={jobs.length}
        description={
          <>Zákazník chce díl — tady je každá poptávka, kterou je potřeba nacenit. Přijde e-mailem (AI ji pozná sama), vyfotíš ji, nebo ji zadáš ručně.</>
        }
        step="poptavka"
        actions={
          <>
            <CaptureButton label="Vyfotit poptávku" variant="send" className="flex-1 shadow-md shadow-primary/20 sm:flex-none" />
            <QuickInquiryDialog customers={options.customers} label="Nová poptávka" className="flex-1 sm:flex-none" />
            <BookLink href={bookHref("poptavky", ["poptavka"])} className="w-full sm:w-auto" />
          </>
        }
      />

      <FlowHint>
        <strong>Jak dál:</strong> klikni na poptávku pro detail (výkresy, kontakt, termín) nebo rovnou{" "}
        <Link href="/pricing" className="font-semibold text-amber-700 underline-offset-2 hover:underline dark:text-amber-300">Nacenit</Link>.
        Po nacenění vytvoříš jedním klikem nabídku. Nic se nikam neodesílá, dokud to sám nepotvrdíš.
      </FlowHint>

      <FlowSection
        icon={MessageSquareQuote}
        iconClass="bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300"
        title="Čeká na nacenění"
        description="Seřazeno podle termínu — nahoře to, co nejvíc spěchá."
        count={jobs.length}
      >
        {jobs.length === 0 ? (
          <FlowEmpty
            icon={Inbox}
            iconClass="bg-sky-100 text-sky-600 dark:bg-sky-500/15 dark:text-sky-300"
            title="Žádná poptávka nečeká 🎉"
            actions={<QuickInquiryDialog customers={options.customers} label="Zadat poptávku ručně" variant="outline" />}
          >
            Nové poptávky sem přijdou samy z pošty. Máš poptávku na papíře? Vyfoť ji tlačítkem „Vyfotit poptávku“ — AI ji přečte a založí.
          </FlowEmpty>
        ) : (
          <FlowJobList
            jobs={jobs}
            today={today}
            renderAction={(j) => (
              <Button asChild size="sm" className="w-full bg-amber-500 text-white shadow-sm hover:bg-amber-500/90 sm:w-auto">
                <Link href={`/pricing?job=${j.id}`}>
                  <Calculator className="h-4 w-4" /> Nacenit
                </Link>
              </Button>
            )}
          />
        )}
      </FlowSection>

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
