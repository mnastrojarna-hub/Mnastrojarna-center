import { BadgeCheck, Eye, FileOutput, FileText, FolderOpen, Lock, ReceiptText, Truck, type LucideIcon } from "lucide-react";
import { getAccess, requireFeature } from "@/lib/auth/session";
import { FlowScopeBar } from "@/components/flow/flow-scope-bar";
import { scopeBarData } from "@/components/flow/flow-scope-copy";
import { PRICE_DOCS_NOTE } from "@/components/flow/file-lock";
import { listJobFiles, listJobs } from "@/lib/data/jobs";
import { getFileFlowInfo } from "@/lib/data/flow-pages";
import { flowWhoFrom, getFlowScope } from "@/lib/data/flow-scope";
import { CLOSED_STAGES } from "@/lib/jobs/stages";
import { Button } from "@/components/ui/button";
import { CaptureButton } from "@/components/jobs/capture/capture-button";
import { BookLink, FlowHeader, FlowHint, FlowSection } from "@/components/flow/flow-header";
import { DocumentsBrowser } from "@/components/flow/documents-browser";
import { IssueDocumentPanel } from "@/components/flow/issue-document-panel";
import { toFlowFile, toIssueJob } from "@/components/flow/flow-data";
import { bookHref, todayPrague } from "@/components/flow/flow-utils";

export const dynamic = "force-dynamic";

const SAMPLES: { type: string; title: string; desc: string; icon: LucideIcon; tone: string }[] = [
  { type: "nabidka", title: "Cenová nabídka", desc: "Položky, platnost, dodací lhůta, kdo vypracoval a schválil.", icon: FileText, tone: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300" },
  { type: "potvrzeni", title: "Potvrzení objednávky", desc: "Potvrzený termín dodání, číslo objednávky zákazníka.", icon: BadgeCheck, tone: "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300" },
  { type: "dodaci-list", title: "Dodací list", desc: "Položky a množství s podpisovými poli, bez cen.", icon: Truck, tone: "bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300" },
  { type: "faktura", title: "Faktura — daňový doklad", desc: "DUZP, VS, rekapitulace DPH a QR platba.", icon: ReceiptText, tone: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300" },
];

/** Dokumenty — vše, co je u zakázek (doklady, výkresy, 3D modely, fotky) + vystavení dokladu. */
export default async function DocumentsPage(props: {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
}) {
  await requireFeature("documents");
  const { can } = await getAccess();
  // #25: dokumenty jen „moje" (super admin všichni, nebo „Jen moje"); obsah nákupních dokladů zamčený
  const scope = await getFlowScope(await flowWhoFrom((await props?.searchParams) ?? {}));
  const [files, jobs] = await Promise.all([
    listJobFiles({ includeArchived: true, limit: 2000 }, { scope }),
    listJobs({ sort: "updated", dir: "desc" }, { scope }),
  ]);
  const info = await getFileFlowInfo(files.map((f) => f.id));
  const flowFiles = files.map((f) => toFlowFile(f, info[f.id] ?? null));
  const current = flowFiles.filter((f) => !f.archived).length;
  // aktivní zakázky nahoře, uzavřené na konci výběru
  const issueJobs = [...jobs]
    .sort((a, b) => Number(CLOSED_STAGES.includes(a.stage)) - Number(CLOSED_STAGES.includes(b.stage)))
    .map(toIssueJob);
  const today = todayPrague();

  return (
    <div className="space-y-5">
      <FlowHeader
        tone="emerald"
        icon={FolderOpen}
        title="Dokumenty"
        count={current}
        description={
          <>Všechny dokumenty ze všech zakázek na jednom místě — poptávky, nabídky, objednávky, potvrzení, výkresy, 3D modely, fotky, dodací listy i faktury. Každý dokument patří k jedné zakázce; starší verze jsou v archivu.</>
        }
        actions={
          <>
            <CaptureButton label="Vyfotit doklad" variant="send" className="flex-1 shadow-md shadow-primary/20 sm:flex-none" />
            <Button asChild variant="outline" className="flex-1 sm:flex-none">
              <a href="#vystavit"><FileOutput className="h-4 w-4 text-emerald-600" /> Vystavit doklad</a>
            </Button>
            <BookLink href={bookHref("vse")} className="w-full sm:w-auto" />
          </>
        }
      >
        <FlowScopeBar scope={scopeBarData(scope)} />
      </FlowHeader>

      <FlowHint>
        <strong>Tip:</strong> klikni na barevný druh nahoře a uvidíš jen faktury, jen výkresy… Číslo zakázky u dokumentu tě
        vezme rovnou do její karty. Nový doklad z mobilu? Stačí <em>Vyfotit doklad</em> — AI ho přečte a zařadí ke správné zakázce.
      </FlowHint>
      {!can("margins") && (
        <p className="flex items-start gap-2 rounded-xl border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
          <Lock className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {PRICE_DOCS_NOTE}
        </p>
      )}

      {scope?.error ? null : <DocumentsBrowser files={flowFiles} today={today} />}

      <FlowSection
        id="vystavit"
        className="scroll-mt-20"
        icon={FileOutput}
        iconClass="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
        title="Vystavit doklad ze zakázky"
        description="Nabídka, potvrzení, dodací list nebo faktura — údaje se vezmou ze zakázky, PDF se uloží k ní a můžeš ho rovnou poslat."
      >
        <IssueDocumentPanel jobs={issueJobs} />
      </FlowSection>

      <details className="group rounded-2xl border bg-card shadow-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2.5 p-4 [&::-webkit-details-marker]:hidden">
          <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
            <Eye className="h-4 w-4" />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block font-semibold">Vzory dokladů</span>
            <span className="block text-xs text-muted-foreground">Jak vypadají naše doklady s firemními údaji z Nastavení (ukázková data).</span>
          </span>
          <span className="text-xs text-muted-foreground group-open:hidden">Rozbalit</span>
        </summary>
        <div className="grid gap-3 border-t p-4 sm:grid-cols-2 lg:grid-cols-4">
          {SAMPLES.map((d) => (
            <div key={d.type} className="flex flex-col gap-2 rounded-xl border p-3">
              <div className="flex items-center gap-2">
                <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${d.tone}`}>
                  <d.icon className="h-4 w-4" />
                </span>
                <span className="text-sm font-semibold">{d.title}</span>
              </div>
              <p className="flex-1 text-xs text-muted-foreground">{d.desc}</p>
              <Button asChild size="sm" variant="outline">
                <a href={`/api/pdf/${d.type}`} target="_blank" rel="noopener noreferrer">
                  <Eye className="h-4 w-4" /> Náhled vzoru
                </a>
              </Button>
            </div>
          ))}
        </div>
      </details>
    </div>
  );
}
