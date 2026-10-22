import { BadgeCheck, Mail, PackageCheck, ShoppingCart } from "lucide-react";
import { requireFeature, getAccess } from "@/lib/auth/session";
import { getJob, listJobs } from "@/lib/data/jobs";
import { getEmails } from "@/lib/data/queries";
import type { EmailItem } from "@/lib/data/types";
import type { JobDetail } from "@/lib/jobs/types";
import { ToastProvider } from "@/components/jobs/detail/toast";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { BookLink, FlowEmpty, FlowHeader, FlowHint, FlowSection } from "@/components/flow/flow-header";
import { FlowJobList } from "@/components/flow/flow-job-list";
import { FlowMailList } from "@/components/flow/flow-mail-list";
import { ConfirmOrderButton } from "@/components/flow/confirm-order-dialog";
import { toConfirmJob, toFlowEmails } from "@/components/flow/flow-data";
import { bookHref, todayPrague } from "@/components/flow/flow-utils";

export const dynamic = "force-dynamic";

const MAX_JOBS = 40;

/** Potvrzení objednávek — objednávky čekající na potvrzení termínu zákazníkovi. */
export default async function ConfirmationsPage() {
  await requireFeature("workflow");
  const { can } = await getAccess();
  const mail = can("mail");
  const [orders, recent, emails] = await Promise.all([
    listJobs({ stages: ["objednavka"], sort: "deadline", dir: "asc" }),
    listJobs({ stages: ["potvrzeno"], sort: "updated", dir: "desc", limit: 5 }),
    mail ? getEmails() : Promise.resolve([] as EmailItem[]),
  ]);
  const details = (await Promise.all(orders.slice(0, MAX_JOBS).map((j) => getJob(j.id)))).filter(Boolean) as JobDetail[];
  const confirmById = new Map(details.map((d) => [d.id, toConfirmJob(d)]));
  const shown = orders.filter((j) => confirmById.has(j.id));
  const today = todayPrague();
  const inbox = toFlowEmails(emails, ["Objednávka", "Potvrzení objednávky"]);
  const waiting = inbox.filter((e) => !e.jobId).length;

  return (
    <div className="space-y-5">
      <FlowHeader
        tone="indigo"
        icon={PackageCheck}
        title="Potvrzení objednávek"
        count={orders.length}
        description={
          <>Zákazník objednal — potvrď mu termín dodání. Jedním klikem se vystaví PDF potvrzení, odejde zákazníkovi a zakázka se posune do stavu <strong>Potvrzená objednávka</strong>.</>
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
        <strong>Přišla objednávka na papíře nebo v PDF?</strong> Vyfoť ji — AI ji spáruje se správnou nabídkou a zakázkou
        (nového zákazníka založí). Pak tu stačí kliknout <em>Potvrdit objednávku</em>, zkontrolovat termín a odeslat.
      </FlowHint>

      <ToastProvider>
        <FlowSection
          icon={ShoppingCart}
          iconClass="bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300"
          title="Čeká na potvrzení"
          description="Seřazeno podle požadovaného termínu zákazníka."
          count={orders.length}
        >
          {shown.length === 0 ? (
            <FlowEmpty
              icon={BadgeCheck}
              iconClass="bg-indigo-100 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300"
              title="Všechny objednávky jsou potvrzené 👍"
            >
              Jakmile zákazník objedná (přijatá nabídka, objednávka z pošty nebo z fotky), objeví se tady k potvrzení.
            </FlowEmpty>
          ) : (
            <FlowJobList
              jobs={shown}
              today={today}
              renderAction={(j) => {
                const job = confirmById.get(j.id);
                return job ? <ConfirmOrderButton job={job} className="w-full sm:w-auto" /> : null;
              }}
            />
          )}
          {orders.length > shown.length && (
            <p className="text-center text-xs text-muted-foreground">Zobrazeno {shown.length} z {orders.length} — další v Knize zakázek.</p>
          )}
        </FlowSection>
      </ToastProvider>

      {recent.length > 0 && (
        <FlowSection
          icon={BadgeCheck}
          iconClass="bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"
          title="Naposledy potvrzené"
          description="Další krok je výroba — stav změníš přímo v řádku nebo v kartě zakázky."
        >
          <FlowJobList jobs={recent} today={today} />
        </FlowSection>
      )}

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
