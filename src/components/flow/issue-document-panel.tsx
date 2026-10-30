"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, CheckCircle2, Eye, FileOutput, Loader2, ReceiptText, Send, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { generateJobDocument, type JobDocumentKind } from "@/app/actions/job-documents";
import { listDeliveryNotes, type DeliveryNoteListItem } from "@/app/actions/delivery-notes";
import { FILE_KINDS } from "@/lib/jobs/file-kinds";
import { stageMeta } from "@/lib/jobs/stages";
import type { JobStage } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { DocumentSendDialog } from "./document-send-dialog";
import { FlowCombo, type ComboItem } from "./flow-combo";
import { ISSUABLE_KINDS } from "./flow-utils";

export interface IssueJob {
  id: string;
  number: string;
  title: string;
  customerName: string | null;
  stage: JobStage;
  hasQuote: boolean;
  /** Číslo faktury zakázky (vystavená → v kartě jen poslat znovu). */
  invoiceNumber?: string | null;
  /** Fakturu jde vystavit (dodáno vše, faktura ještě není) — stejné pravidlo jako karta. */
  invoiceable?: boolean;
  /** Vystavená faktura má PDF v Dokumentech (false = zapsaná mimo systém, PDF z aplikace není). */
  invoiceHasPdf?: boolean;
}

/**
 * Text u faktury v panelu Dokumenty: faktura z aplikace (otevřeš / pošleš znovu v kartě), faktura zapsaná
 * mimo systém (PDF z aplikace není — nic neslibovat), nebo kdy ji jde vystavit.
 */
export function invoiceLinkText(job: Pick<IssueJob, "invoiceNumber" | "invoiceable" | "invoiceHasPdf">): string {
  if (job.invoiceNumber) {
    return job.invoiceHasPdf === false
      ? `Zakázka má fakturu ${job.invoiceNumber} vystavenou mimo systém — PDF z aplikace k ní není (druhá faktura nevznikne). Další krok je „Zadat platbu“ v kartě zakázky.`
      : `Zakázka už má fakturu ${job.invoiceNumber} — v kartě zakázky ji otevřeš nebo pošleš znovu (druhá faktura nevznikne).`;
  }
  return job.invoiceable
    ? "Fakturu vystavíš v kartě zakázky — vznikne PDF s QR platbou a rovnou ji pošleš zákazníkovi."
    : "Fakturu vystavíš po dodání všeho zboží (Zapsat dodání a dodací list) — v kartě zakázky.";
}

/** Jaký doklad se k zakázce v daném stavu nejspíš hodí. */
export function suggestedKind(stage: JobStage, job?: Pick<IssueJob, "invoiceNumber" | "invoiceable">): JobDocumentKind {
  // faktura jen tam, kde jde vystavit nebo už je (jinak by panel nabízel fakturu poptávce)
  if (job && (job.invoiceable || job.invoiceNumber)) return "faktura";
  if (stage === "poptavka" || stage === "naceneni" || stage === "nabidka") return "nabidka";
  if (stage === "objednavka" || stage === "potvrzeno") return "potvrzeni";
  if (!job && (stage === "dodano_zakaznikovi" || stage === "fakturovano" || stage === "dokonceno")) return "faktura";
  return "dodaci_list";
}

const ACCUSATIVE: Record<JobDocumentKind, string> = {
  nabidka: "nabídku", potvrzeni: "potvrzení objednávky", dodaci_list: "dodací list", faktura: "fakturu",
};

const SELECTED: Record<JobDocumentKind, string> = {
  nabidka: "border-violet-400 ring-2 ring-violet-400/40 dark:border-violet-500",
  potvrzeni: "border-indigo-400 ring-2 ring-indigo-400/40 dark:border-indigo-500",
  dodaci_list: "border-green-400 ring-2 ring-green-400/40 dark:border-green-500",
  faktura: "border-emerald-500 ring-2 ring-emerald-500/40 dark:border-emerald-500",
};

/**
 * „Vystavit doklad ze zakázky": vyber zakázku a druh → PDF se uloží do Dokumentů
 * zakázky (nová verze, stará do archivu) a jde rovnou poslat zákazníkovi.
 */
export function IssueDocumentPanel({ jobs, canInvoice = true }: { jobs: IssueJob[]; canInvoice?: boolean }) {
  const router = useRouter();
  const [text, setText] = React.useState("");
  const [jobId, setJobId] = React.useState<string | null>(null);
  // faktura jen pro finance (marže) — ostatní ji tu ani nevidí (server ji stejně odmítne)
  const kinds = canInvoice ? ISSUABLE_KINDS : ISSUABLE_KINDS.filter((k) => k.kind !== "faktura");
  const suggest = (picked: IssueJob): JobDocumentKind => {
    const k = suggestedKind(picked.stage, picked);
    return k === "faktura" && !canInvoice ? "dodaci_list" : k;
  };
  // výchozí druh před výběrem zakázky (po výběru se navrhne podle stavu); faktura se vystavuje v kartě
  const [kind, setKind] = React.useState<JobDocumentKind>("potvrzeni");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  /** DL bez dodávky: chyba vede do karty na „Zapsat dodání a dodací list". */
  const [needsDelivery, setNeedsDelivery] = React.useState(false);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [done, setDone] = React.useState<{ fileId: string; filename: string; number: string; version: number; kind: JobDocumentKind; jobId: string; sentTo?: string } | null>(null);
  const [sending, setSending] = React.useState(false);
  // dodací listy dodávek vybrané zakázky (stáhnout; další DL = „Zapsat dodání" v kartě zakázky)
  const [notes, setNotes] = React.useState<{ jobId: string; list: DeliveryNoteListItem[] } | null>(null);

  const job = jobs.find((j) => j.id === jobId) ?? null;

  React.useEffect(() => {
    if (!jobId || kind !== "dodaci_list") return;
    if (notes?.jobId === jobId) return;
    let live = true;
    listDeliveryNotes(jobId)
      .then((res) => { if (live) setNotes({ jobId, list: res.ok ? res.notes ?? [] : [] }); })
      .catch(() => { if (live) setNotes({ jobId, list: [] }); });
    return () => { live = false; };
  }, [jobId, kind, notes?.jobId]);
  const jobNotes = kind === "dodaci_list" && notes && notes.jobId === jobId ? notes.list : [];
  const items: ComboItem[] = React.useMemo(
    () => jobs.map((j) => ({
      id: j.id,
      label: `${j.number} — ${j.title || "bez názvu"}`,
      sub: [j.customerName, stageMeta(j.stage).label].filter(Boolean).join(" · "),
      dot: stageMeta(j.stage).dot,
    })),
    [jobs],
  );

  async function issue(force = false) {
    if (!job || busy) return;
    if (kind === "nabidka" && !job.hasQuote) {
      setError("Zakázka zatím nemá nabídku — vytvoř ji v kartě zakázky (záložka Nabídky).");
      return;
    }
    setBusy(true);
    setError(null);
    setWarning(null);
    setDone(null);
    setNeedsDelivery(false);
    try {
      const res = await generateJobDocument(job.id, kind, force ? { force: true } : undefined);
      if (!res.ok || !res.fileId) {
        if (res.unpriced) setWarning(res.error ?? "Některé položky nemají cenu.");
        else setError(res.error ?? "Doklad se nepodařilo vystavit.");
        setNeedsDelivery(res.code === "delivery");
        return;
      }
      setDone({ fileId: res.fileId, filename: res.filename ?? "doklad.pdf", number: res.number ?? "", version: res.version ?? 1, kind, jobId: job.id });
      // nový DL (dodané zboží bez DL) → seznam DL zakázky načíst znovu
      if (kind === "dodaci_list") setNotes(null);
      router.refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  const previewType = ISSUABLE_KINDS.find((k) => k.kind === kind)?.preview ?? "faktura";

  return (
    <div className="space-y-4 rounded-2xl border bg-card p-4 shadow-sm">
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">1. Zakázka</span>
        <FlowCombo
          items={items}
          text={text}
          selectedId={jobId}
          onChange={(t, id) => {
            setText(t);
            setJobId(id);
            setDone(null);
            setWarning(null);
            setError(null);
            setNeedsDelivery(false);
            const picked = id ? jobs.find((j) => j.id === id) : null;
            if (picked) setKind(suggest(picked));
          }}
          placeholder="Hledej číslo zakázky, název nebo zákazníka…"
          max={10}
        />
      </label>

      <div className="space-y-1">
        <span className="text-xs font-medium text-muted-foreground">2. Druh dokladu</span>
        <div className={cn("grid grid-cols-2 gap-2", kinds.length === 4 ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
          {kinds.map((k) => {
            const m = FILE_KINDS[k.kind];
            const Icon = m.icon;
            const on = kind === k.kind;
            const noQuote = k.kind === "nabidka" && job !== null && !job.hasQuote;
            return (
              <button
                key={k.kind}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setKind(k.kind);
                  setDone(null);
                  setWarning(null);
                  setError(null);
                  setNeedsDelivery(false);
                }}
                className={cn(
                  "flex items-start gap-2 rounded-xl border bg-background p-2.5 text-left transition hover:bg-accent/50",
                  on && SELECTED[k.kind],
                )}
              >
                <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-lg", m.badge)}>
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-medium leading-tight">{k.label}</span>
                  <span className={cn("block text-[11px] leading-snug text-muted-foreground", noQuote && "text-amber-700 dark:text-amber-400")}>
                    {noQuote ? "zakázka nemá nabídku" : k.hint}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </div>

      {jobNotes.length > 0 && job && (
        <div className="space-y-2 rounded-xl border border-green-200 bg-green-50/60 p-3 text-sm dark:border-green-500/30 dark:bg-green-500/10" data-testid="issue-delivery-notes">
          <p className="font-medium text-green-900 dark:text-green-100">
            Zakázka má {jobNotes.length === 1 ? "dodací list k dodávce" : `${jobNotes.length} dodací listy k dodávkám`} — stáhni ho, nový DL nevzniká.
          </p>
          <ul className="space-y-1">
            {jobNotes.map((n) => (
              <li key={n.id} className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-xs font-semibold">{n.number}</span>
                <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
                  {n.lines.map((l) => `${l.description} ${new Intl.NumberFormat("cs-CZ", { maximumFractionDigits: 3 }).format(l.quantity)} ${l.unit}`).join(" · ")}
                </span>
                {n.fileId && (
                  <Button asChild size="sm" variant="outline" className="h-8">
                    <a href={`/api/jobs/files/${n.fileId}`} target="_blank" rel="noopener noreferrer">PDF <ExternalLink className="h-3.5 w-3.5" /></a>
                  </Button>
                )}
              </li>
            ))}
          </ul>
          <p className="text-xs text-muted-foreground">
            DL na zbývající položky vystavíš v kartě zakázky:{" "}
            <Link href={`/orders/${job.id}?tab=vyroba&akce=delivery.record`} className="font-medium text-foreground underline underline-offset-2">Zapsat dodání a dodací list</Link>.
          </p>
        </div>
      )}
      <ErrorBox error={error} />
      {needsDelivery && job && (
        <p className="text-sm">
          <Link href={`/orders/${job.id}?tab=vyroba&akce=delivery.record`} className="font-medium underline underline-offset-2">Otevřít kartu zakázky → Zapsat dodání a dodací list</Link>
        </p>
      )}
      {kind === "faktura" && job && (
        // A2: faktura má jednu cestu — karta zakázky „Vystavit fakturu" (PDF + odeslání jako u nabídky)
        <div className="rounded-xl border border-emerald-200 bg-emerald-50/60 p-3 text-sm dark:border-emerald-500/30 dark:bg-emerald-500/10" data-testid="issue-invoice-link">
          <p className="text-emerald-900 dark:text-emerald-100">{invoiceLinkText(job)}</p>
        </div>
      )}
      {warning && (
        <div className="space-y-2 rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          <p className="flex items-start gap-2 font-medium">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> {warning}
          </p>
          <div className="flex flex-wrap gap-2">
            {job && (
              <Button asChild size="sm" variant="outline">
                <Link href={`/orders/${job.id}?tab=polozky`}>Doplnit ceny</Link>
              </Button>
            )}
            <Button type="button" size="sm" onClick={() => void issue(true)} disabled={busy}>Přesto vystavit</Button>
          </div>
        </div>
      )}
      {done && (
        <div role="status" className="flex flex-col gap-2 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-100 sm:flex-row sm:items-center">
          <CheckCircle2 className="h-5 w-5 shrink-0 text-green-600" />
          <p className="min-w-0 flex-1">
            Hotovo: <span className="font-semibold">{ISSUABLE_KINDS.find((k) => k.kind === done.kind)?.label} {done.number}</span>
            {done.version > 1 ? ` (verze ${done.version}, starší je v archivu)` : ""} — uloženo v Dokumentech zakázky.
            {done.sentTo && <> <strong>Odesláno na {done.sentTo}.</strong></>}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="outline">
              <a href={`/api/jobs/files/${done.fileId}`} target="_blank" rel="noopener noreferrer">
                Otevřít PDF <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </Button>
            <Button type="button" size="sm" variant="send" onClick={() => setSending(true)}>
              <Send className="h-4 w-4" /> {done.sentTo ? "Poslat znovu" : "Poslat zákazníkovi"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
        {job && (
          <Button asChild variant="ghost">
            <a href={`/api/pdf/job/${job.id}?type=${previewType}`} target="_blank" rel="noopener noreferrer">
              <Eye className="h-4 w-4" /> Náhled bez uložení
            </a>
          </Button>
        )}
        {kind === "faktura" ? (
          <Button asChild={Boolean(job)} type="button" disabled={!job} className="bg-emerald-600 text-white shadow-sm hover:bg-emerald-600/90">
            {job ? (
              job.invoiceNumber ? (
                // vystavená → tentýž dialog jen k odeslání (stejné PDF, nic nového nevzniká)
                <Link href={`/orders/${job.id}?akce=payment.invoice`}>
                  <ReceiptText className="h-4 w-4" /> Poslat fakturu znovu v kartě zakázky
                </Link>
              ) : !job.invoiceable ? (
                <Link href={`/orders/${job.id}?tab=vyroba`}>
                  <ReceiptText className="h-4 w-4" /> Otevřít kartu zakázky
                </Link>
              ) : (
                <Link href={`/orders/${job.id}?akce=payment.invoice`}>
                  <ReceiptText className="h-4 w-4" /> Vystavit fakturu v kartě zakázky
                </Link>
              )
            ) : (
              <span><ReceiptText className="h-4 w-4" /> Vystavit fakturu v kartě zakázky</span>
            )}
          </Button>
        ) : (
          <Button type="button" onClick={() => void issue()} disabled={!job || busy} className="bg-emerald-600 text-white shadow-sm hover:bg-emerald-600/90">
            {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileOutput className="h-4 w-4" />}
            Vystavit PDF
          </Button>
        )}
      </div>

      {done && (
        <DocumentSendDialog
          open={sending}
          onOpenChange={setSending}
          jobId={done.jobId}
          kind={done.kind}
          fileId={done.fileId}
          filename={done.filename}
          title={`Poslat ${ACCUSATIVE[done.kind]} ${done.number} zákazníkovi`}
          onSent={({ to }) => {
            setSending(false);
            setDone((d) => (d ? { ...d, sentTo: to } : d));
            router.refresh();
          }}
        />
      )}
    </div>
  );
}
