"use client";

import * as React from "react";
import {
  Banknote, Camera, Check, CircleCheckBig, ExternalLink, FileCheck2, FileText, FileUp, Loader2, PartyPopper, Pencil, ReceiptText,
  Truck, Undo2, UserRound, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { confirmDeliveryNote, unconfirmDeliveryNote } from "@/app/actions/production";
import { uploadJobFile, type UploadPhase } from "@/lib/jobs/upload-client";
import { czDay, dueText } from "@/lib/jobs/production";
import type { JobClosingInfo } from "@/lib/jobs/production-types";
import type { JobDetail } from "@/lib/jobs/types";
import { UPLOAD_PHASE_LABELS, useJobDetail } from "@/components/jobs/detail/detail-context";
import { useFlowActions } from "@/components/jobs/detail/flow-actions";
import { formatMoney } from "@/components/jobs/detail/detail-helpers";
import { todayInPrague } from "@/components/jobs/book/book-params";
import { cn } from "@/lib/utils";
import { ActorStamp } from "@/components/flow-status/actor-stamp";
import { ProgressPill } from "@/components/flow-status/progress-pill";
import { deleteJobPayment } from "@/app/actions/flow-status";
import { flowRank, type ChangeStamp, type JobStamps } from "@/lib/jobs/flow-status";
import type { JobPayment } from "@/lib/data/flow-status";
import { currentDeliveryNotes } from "@/lib/jobs/delivery-notes";
import { useRunner } from "./production-context";
import { PaymentDialog } from "./payment-dialog";
import { InvoiceInfoDialog, ownInvoiceFile } from "./invoice-dialog";
import { PrintButton } from "@/components/print/print-button";
import {
  CONFIRMED_DL_TITLE, INVOICE_TONE, closingStamp, confirmedDeliveryFile, invoiceTone, stampLabel,
} from "./production-helpers";

/**
 * Konec toku zakázky jako tři kroky: dodací list (dodání; potvrzený DL od zákazníka je NEPOVINNÝ)
 * → naše faktura (PDF + odeslání = hlavní tlačítko „Vystavit fakturu") → zaplaceno („Zadat platbu",
 * jeden dialog pro zálohy, dílčí úhrady i doplatek). Po zaplacení je zakázka dokončená.
 */

type StepState = "done" | "current" | "todo";

function Step({
  n, icon: Icon, title, state, last, children, aside,
}: {
  n: number;
  icon: LucideIcon;
  title: React.ReactNode;
  state: StepState;
  last?: boolean;
  children: React.ReactNode;
  aside?: React.ReactNode;
}) {
  return (
    <li className="relative flex gap-3" aria-current={state === "current" ? "step" : undefined}>
      <div className="flex flex-col items-center">
        <span
          className={cn(
            "flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-sm font-bold shadow-sm ring-4 ring-card",
            state === "done" && "bg-green-500 text-white",
            state === "current" && "bg-sky-600 text-white",
            state === "todo" && "bg-muted text-muted-foreground",
          )}
        >
          {state === "done" ? <Check className="h-4 w-4" strokeWidth={3} /> : n}
        </span>
        {!last && <span aria-hidden className={cn("my-1 w-1 flex-1 rounded-full", state === "done" ? "bg-green-500" : "bg-border")} />}
      </div>
      <div className={cn("min-w-0 flex-1", !last && "pb-4")}>
        <div className="flex min-h-9 items-center gap-2">
          <Icon className={cn("h-4 w-4 shrink-0", state === "done" ? "text-green-600 dark:text-green-400" : state === "current" ? "text-sky-600 dark:text-sky-400" : "text-muted-foreground")} />
          <h4 className={cn("min-w-0 flex-1 text-sm font-semibold", state === "todo" && "text-muted-foreground")}>{title}</h4>
          {aside}
        </div>
        <div className="mt-1 space-y-2">{children}</div>
      </div>
    </li>
  );
}

function DoneBox({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-green-200 bg-green-50 px-3 py-2 text-sm text-green-900 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-200">
      {children}
    </div>
  );
}

/**
 * „Potvrdil · 20. 10. 14:05 · Petr Novák" — kdo krok zapsal. Přednost má razítko ze sloupců
 * zakázky (DB, i AI / foto / automatika), jinak poslední událost historie.
 */
function ByLine({ job, kind, prefix, stamp: col }: { job: JobDetail; kind: "delivery_note" | "invoice" | "paid"; prefix: string; stamp?: ChangeStamp | null }) {
  if (col) return <ActorStamp stamp={col} verb={prefix} className="mt-1 max-w-full opacity-90" />;
  const stamp = closingStamp(job.events, kind);
  if (!stamp) return null;
  return (
    <p className="mt-1 flex min-w-0 items-center gap-1 text-[11px] opacity-80">
      <UserRound className="h-3 w-3 shrink-0" />
      <span className="truncate">{stampLabel(prefix, stamp, todayInPrague())}</span>
    </p>
  );
}

function UndoButton({ onClick, busy, label = "Zrušit" }: { onClick: () => void; busy: boolean; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={busy}
      className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
    >
      {busy ? <Loader2 className="h-3 w-3 animate-spin" /> : <Undo2 className="h-3 w-3" />} {label}
    </button>
  );
}

// ── 1) Dodací list (+ nepovinně potvrzený DL) ───────────────
function DeliveryStep({
  job, closing, state, delivered, stamp, invoiced,
}: { job: JobDetail; closing: JobClosingInfo; state: StepState; delivered: "all" | "part" | null; stamp?: ChangeStamp | null; invoiced: boolean }) {
  const { notify } = useJobDetail();
  // po faktuře (Vyfakturováno, Dokončeno) je nepovinný potvrzený DL jen malý odkaz — rozbalí se na klik
  const [expanded, setExpanded] = React.useState(false);
  const collapsed = !expanded && (invoiced || flowRank(closing.stage) >= 10);
  const { run, isBusy } = useRunner();
  const [date, setDate] = React.useState(() => todayInPrague());
  const [phase, setPhase] = React.useState<UploadPhase | null>(null);
  const photoRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const dateId = React.useId();
  const photoId = React.useId();
  const fileId = React.useId();
  const file = confirmedDeliveryFile(job.files);
  const confirmed = closing.deliveryNoteConfirmedAt;
  const busy = phase !== null || isBusy("dl");
  // čísla DL z delivery_notes (jediný zdroj čísla DL, jako Přehled); starší data bez řádku → ze souborů
  const notes: { id: string | null; number: string }[] = job.deliveryNotes?.length
    ? job.deliveryNotes
    : currentDeliveryNotes(job.files ?? []);

  async function upload(f: File | undefined) {
    if (!f) return;
    setPhase("nahravani");
    try {
      const up = await uploadJobFile(f, { jobId: job.id, kind: "dodaci_list", title: CONFIRMED_DL_TITLE, onPhase: setPhase });
      if (!up.ok || !up.file) {
        notify("error", up.error ?? "Nahrání se nepovedlo — zkus to znovu.");
        return;
      }
      const fileId = up.file.id;
      await run("dl", () => confirmDeliveryNote(job.id, { fileId, date }), { success: "Potvrzený dodací list uložen ✓" });
    } finally {
      setPhase(null);
    }
  }

  const pickHandler = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = "";
    void upload(f);
  };

  return (
    <Step
      n={1}
      icon={Truck}
      title="Dodací list"
      state={state}
      aside={confirmed ? <UndoButton busy={isBusy("dl-undo")} label="Zrušit potvrzení" onClick={() => void run("dl-undo", () => unconfirmDeliveryNote(job.id), { success: "Potvrzení dodacího listu zrušeno." })} /> : null}
    >
      {notes.length > 0 ? (
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground" data-testid="closing-delivery-notes">
          <span>{delivered === "all" ? "Dodáno —" : delivered === "part" ? "Dodáno částečně —" : "Vystaveno —"}</span>
          {notes.map((n, i) => n.id ? (
            <span key={n.id} className="inline-flex items-center gap-0.5">
              <a href={`/api/jobs/files/${n.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-mono font-medium text-foreground underline-offset-2 hover:underline">
                <FileText className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden /> {n.number}
              </a>
              <PrintButton href={`/api/jobs/files/${n.id}`} label={`Tisknout ${n.number}`} className="h-7 w-7" iconClassName="h-3.5 w-3.5" />
            </span>
          ) : (
            // DL bez PDF v Dokumentech (smazaný soubor) — číslo zůstává, odkaz ne
            <span key={`${n.number}-${i}`} className="inline-flex items-center gap-1 font-mono font-medium text-foreground">
              <FileText className="h-3.5 w-3.5 text-green-600 dark:text-green-400" aria-hidden /> {n.number}
            </span>
          ))}
        </p>
      ) : (
        <p className="text-xs text-muted-foreground">
          {delivered ? "Dodáno." : "Po dodání: „Zapsat dodání a dodací list“ — vystaví DL s dodanými kusy."}
        </p>
      )}
      {confirmed ? (
        <DoneBox>
          <p className="font-semibold">Zákazník potvrdil převzetí {czDay(confirmed)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {closing.deliveryNoteNumber && <span>DL č. <strong className="font-mono">{closing.deliveryNoteNumber}</strong></span>}
            {file ? (
              <span className="inline-flex items-center gap-0.5">
                <a href={`/api/jobs/files/${file.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-green-800 underline-offset-2 hover:underline dark:text-green-300">
                  <FileCheck2 className="h-3.5 w-3.5" /> Otevřít potvrzený DL <ExternalLink className="h-3 w-3" />
                </a>
                <PrintButton href={`/api/jobs/files/${file.id}`} filename={file.filename} label="Tisknout potvrzený DL" className="h-7 w-7" iconClassName="h-3.5 w-3.5" />
              </span>
            ) : (
              <span className="opacity-80">bez skenu</span>
            )}
          </p>
          <ByLine job={job} kind="delivery_note" prefix="DL potvrzen" stamp={stamp} />
          {file?.uploadedBy && (
            <p className="flex min-w-0 items-center gap-1 text-[11px] opacity-80">
              <FileCheck2 className="h-3 w-3 shrink-0" /> <span className="truncate">Sken nahrál {file.uploadedBy.name}</span>
            </p>
          )}
        </DoneBox>
      ) : collapsed ? (
        <button
          type="button"
          onClick={() => setExpanded(true)}
          className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:underline"
          data-testid="confirmed-dl-optional-link"
        >
          <FileUp className="h-3.5 w-3.5" /> Nahrát potvrzený DL (nepovinné)
        </button>
      ) : (
        // potvrzený DL od zákazníka je nepovinný — fakturu jde vystavit hned po dodání
        <div className="space-y-2 rounded-lg border border-dashed p-2.5" data-testid="confirmed-dl-optional">
          <p className="text-xs text-muted-foreground">
            <span className="font-medium text-foreground">Potvrzený DL od zákazníka</span> · nepovinné — vyfoť nebo nahraj podepsaný dodací list.
          </p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[9.5rem] flex-1 sm:flex-none">
              <label htmlFor={dateId} className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Převzato dne</label>
              <Input id={dateId} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10" disabled={busy} />
            </div>
          </div>
          <div className="grid gap-2 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap">
            {/* <label for> — výběr/fotoaparát otevře prohlížeč nativně (spolehlivé i na iOS a ve vestavěných prohlížečích) */}
            <Button asChild variant="outline" className={cn("h-11 cursor-pointer sm:hidden", busy && "pointer-events-none opacity-50")}>
              <label htmlFor={photoId} aria-disabled={busy || undefined}>
                {phase ? <Loader2 className="animate-spin" /> : <Camera className="text-emerald-600" />} Vyfotit DL
              </label>
            </Button>
            <Button asChild variant="outline" className={cn("h-11 cursor-pointer sm:hidden", busy && "pointer-events-none opacity-50")}>
              <label htmlFor={fileId} aria-disabled={busy || undefined}>
                <FileUp className="text-emerald-600" /> Ze souboru
              </label>
            </Button>
            <Button asChild variant="outline" className={cn("hidden h-10 cursor-pointer sm:inline-flex", busy && "pointer-events-none opacity-50")}>
              <label htmlFor={fileId} aria-disabled={busy || undefined}>
                {phase ? <Loader2 className="animate-spin" /> : <FileUp className="text-emerald-600" />} Nahrát potvrzený DL
              </label>
            </Button>
          </div>
          {phase && <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400" aria-live="polite">{UPLOAD_PHASE_LABELS[phase]}</p>}
          <button
            type="button"
            onClick={() => void run("dl", () => confirmDeliveryNote(job.id, { date }), { success: `Dodací list potvrzen (${czDay(date)}).` })}
            disabled={busy || !date}
            className="inline-flex min-h-9 items-center gap-1 text-xs font-medium text-sky-700 hover:underline disabled:opacity-50 dark:text-sky-400"
          >
            {isBusy("dl") && !phase ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Potvrdit bez souboru
          </button>
          <input ref={photoRef} id={photoId} type="file" accept="image/*" capture="environment" className="sr-only" tabIndex={-1} aria-hidden disabled={busy} onChange={pickHandler} />
          <input ref={fileRef} id={fileId} type="file" accept="image/*,application/pdf" className="sr-only" tabIndex={-1} aria-hidden disabled={busy} onChange={pickHandler} />
        </div>
      )}
    </Step>
  );
}

// ── 2) Faktura a splatnost (přehled; vystavení = „Vystavit fakturu") ─────
function InvoiceStep({
  job, closing, state, invoiced, margins, stamp, delivered,
}: {
  job: JobDetail; closing: JobClosingInfo; state: StepState; invoiced: boolean; margins: boolean; stamp?: ChangeStamp | null;
  delivered: "all" | "part" | null;
}) {
  const flow = useFlowActions();
  const { notify, refresh } = useJobDetail();
  const [editing, setEditing] = React.useState(false);
  const terms = closing.paymentTermsDays ?? job.customerDetail?.paymentTermsDays ?? null;
  const tone = invoiceTone(closing);
  const text = dueText(closing);
  // PDF naší faktury jen pro finance (zaměstnanec fakturu neotevře — stejně jako Přehled a Dokumenty)
  const pdf = margins ? ownInvoiceFile(job.files ?? []) : null;
  // hlavní tlačítko v hlavičce už je „Vystavit fakturu" → v kartě jen odkaz na něj (žádné druhé tlačítko vedle)
  const headerHasInvoice = flow?.next?.key === "payment.invoice";
  // vystavit jde, jen když to karta nabízí (dodáno vše, faktura ještě není) — tentýž dialog
  const offered = Boolean(flow) && margins && Boolean(flow?.menu.includes("payment.invoice"));

  return (
    <Step
      n={2}
      icon={ReceiptText}
      title="Naše faktura"
      state={state}
      aside={invoiced && margins ? (
        <button type="button" onClick={() => setEditing(true)} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          <Pencil className="h-3 w-3" /> Upravit splatnost
        </button>
      ) : null}
    >
      {invoiced && (
        <div className={cn(
          "rounded-lg border px-3 py-2 text-sm",
          tone === "overdue" ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10" : "bg-background",
        )}>
          <p className="flex flex-wrap items-center gap-x-2 font-semibold">
            <span>Faktura {closing.invoiceNumber ? <span className="font-mono">{closing.invoiceNumber}</span> : <span className="font-normal text-muted-foreground">(bez čísla)</span>}</span>
            {pdf ? (
              <span className="inline-flex items-center gap-0.5">
                <a href={`/api/jobs/files/${pdf.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-400">
                  PDF <ExternalLink className="h-3 w-3" />
                </a>
                <PrintButton href={`/api/jobs/files/${pdf.id}`} filename={pdf.filename} label="Tisknout fakturu" className="h-7 w-7" iconClassName="h-3.5 w-3.5" />
              </span>
            ) : margins && !ownInvoiceFile(job.files ?? []) ? (
              <span className="text-xs font-normal text-muted-foreground">vystavená mimo systém</span>
            ) : null}
          </p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            {closing.invoiceDate && <span>vystavena {czDay(closing.invoiceDate)}</span>}
            {closing.invoiceDueDate && <span>· splatnost {czDay(closing.invoiceDueDate)}</span>}
          </p>
          {tone && text && (
            <span className={cn("mt-1.5 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-bold", INVOICE_TONE[tone])}>
              {text}
            </span>
          )}
          <div className="text-muted-foreground">
            <ByLine job={job} kind="invoice" prefix="Fakturováno" stamp={stamp} />
          </div>
        </div>
      )}
      {!invoiced && margins && (
        headerHasInvoice ? (
          <p className="text-xs text-muted-foreground">Fakturu vystavíš tlačítkem <strong className="font-semibold text-foreground">Vystavit fakturu</strong> nahoře — PDF s QR platbou a rovnou e-mail zákazníkovi.</p>
        ) : offered ? (
          <Button type="button" variant="outline" className="h-11 sm:h-9" onClick={() => flow!.run("payment.invoice")}>
            <ReceiptText className="text-emerald-600" /> Vystavit fakturu
          </Button>
        ) : delivered === "part" ? (
          <p className="text-xs text-muted-foreground">Fakturu vystavíš, až bude dodáno vše (dílčí faktura na část dodávky zatím nejde) — potvrzený DL není podmínka.</p>
        ) : (
          <p className="text-xs text-muted-foreground">Fakturu vystavíš hned po dodání (dodací list) — potvrzený DL není podmínka.</p>
        )
      )}
      {!invoiced && !margins && <FinanceNote />}
      {invoiced && margins && (
        <InvoiceInfoDialog
          open={editing}
          onOpenChange={setEditing}
          jobId={job.id}
          mode="due"
          current={{ number: closing.invoiceNumber, date: closing.invoiceDate, due: closing.invoiceDueDate }}
          terms={terms}
          onDone={(m) => { notify("success", m); refresh(); }}
        />
      )}
    </Step>
  );
}

// ── 3) Zaplaceno ────────────────────────────────────────────
/** Seznam úhrad s autory (částky jen s právem na marže; v historii částky nejsou). „Odebrat" = jedna úhrada. */
function PaymentList({ payments, margins, currency }: { payments: JobPayment[]; margins: boolean; currency: string }) {
  const { run, isBusy } = useRunner();
  if (!payments.length) return null;
  return (
    <ul aria-label="Úhrady" className="divide-y rounded-lg border bg-background text-xs">
      {payments.map((p) => (
        <li key={p.id} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1.5">
          <span className="font-medium">{czDay(p.paidOn)}</span>
          <span className="tabular-nums">
            {p.amount !== null ? formatMoney(p.amount, currency) : p.whole ? "celá / zbývající částka" : "úhrada"}
          </span>
          {p.settles && <span className="rounded-full bg-emerald-100 px-1.5 text-[10px] font-medium text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300">vyrovnává</span>}
          <ActorStamp stamp={p.stamp} short className="max-w-[12rem]" />
          {margins && (
            <button
              type="button"
              onClick={() => void run(`del-${p.id}`, () => deleteJobPayment(p.id), { success: "Úhrada odebrána." })}
              disabled={isBusy(`del-${p.id}`)}
              className="ml-auto min-h-8 rounded px-1.5 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
              aria-label={`Odebrat úhradu ze dne ${czDay(p.paidOn)}`}
            >
              {isBusy(`del-${p.id}`) ? <Loader2 className="h-3 w-3 animate-spin" /> : "Odebrat"}
            </button>
          )}
        </li>
      ))}
    </ul>
  );
}

function PaidStep({
  job, closing, state, margins, invoiced, payments, stamp,
}: { job: JobDetail; closing: JobClosingInfo; state: StepState; margins: boolean; invoiced: boolean; payments: JobPayment[]; stamp?: ChangeStamp | null }) {
  const { notify, refresh } = useJobDetail();
  const [open, setOpen] = React.useState(false);
  const paidSoFar = job.flow?.paidSoFar ?? 0;
  const value = job.value;
  const pct = value && value > 0 && paidSoFar > 0 ? Math.min(100, Math.round((paidSoFar / value) * 100)) : null;
  const paidAt = closing.paidAt;
  const rank = flowRank(closing.stage);
  const deposits = rank >= 4;

  return (
    <Step n={3} icon={Banknote} title="Zaplaceno" state={state} last>
      {paidAt ? (
        <DoneBox>
          <p className="font-semibold">Zaplaceno {czDay(paidAt)}</p>
          {margins && (closing.paidAmount !== null || job.value !== null) && (
            <p className="mt-0.5 text-xs tabular-nums">
              {formatMoney(closing.paidAmount ?? job.value, job.currency)} bez DPH{closing.paidAmount === null ? " (hodnota zakázky)" : ""}
            </p>
          )}
          <ByLine job={job} kind="paid" prefix="Zaplaceno" stamp={stamp} />
          {/* oprava omylu = „Odebrat" u konkrétní úhrady (nikdy hromadné zrušení — zálohy zůstanou) */}
          <div className="mt-2"><PaymentList payments={payments} margins={margins} currency={job.currency} /></div>
        </DoneBox>
      ) : margins ? (
        <>
          {pct !== null && (
            <ProgressPill
              progress={{ done: paidSoFar, total: value ?? 0, pct, label: `${formatMoney(paidSoFar, job.currency)} z ${formatMoney(value, job.currency)}` }}
              hue="emerald"
              className="text-xs font-medium"
            />
          )}
          <PaymentList payments={payments} margins={margins} currency={job.currency} />
          {!invoiced && (state === "current" || payments.length > 0) && (
            <p className="text-xs text-amber-700 dark:text-amber-400">Faktura zatím není vystavená — zálohu zapíšeš, zakázka se dokončí po faktuře.</p>
          )}
          {/* záloha / dílčí platba i před fakturou — od potvrzené objednávky (tentýž dialog „Zadat platbu") */}
          {(state === "current" || invoiced || payments.length > 0 || paidSoFar > 0 || deposits) && (
            <Button type="button" variant={state === "current" ? "success" : "outline"} className="h-11 w-full sm:h-10 sm:w-auto" onClick={() => setOpen(true)}>
              <Banknote /> Zadat platbu
            </Button>
          )}
          {state !== "current" && !invoiced && payments.length === 0 && paidSoFar === 0 && (
            <p className="text-xs text-muted-foreground">
              {deposits ? "Zálohu nebo dílčí úhradu zapíšeš i před fakturou." : "Po potvrzení objednávky tu zapíšeš zálohu, po faktuře platbu."}
            </p>
          )}
          <PaymentDialog
            open={open}
            onOpenChange={setOpen}
            jobId={job.id}
            margins={margins}
            value={value}
            paidSoFar={paidSoFar}
            currency={job.currency}
            onDone={(m) => { notify("success", m); refresh(); }}
          />
        </>
      ) : (
        <FinanceNote />
      )}
    </Step>
  );
}

/** Zaměstnanec: fakturu a úhrady zapisuje obchodník nebo admin. */
function FinanceNote() {
  return <p className="text-xs text-muted-foreground">Fakturu a úhrady zapisuje obchodník nebo admin.</p>;
}

/** Dodáno vše / částečně / nic — z podrobného stavu dodání (karta), jinak podle hlavního stavu. */
function deliveredOf(job: JobDetail, closing: JobClosingInfo, delivery: string | null | undefined): "all" | "part" | null {
  if (delivery === "dodano" || delivery === "dl_potvrzen") return "all";
  if (delivery === "castecne") return "part";
  if (flowRank(closing.stage) >= 9 || closing.deliveryNoteConfirmedAt) return "all";
  return job.items.some((i) => Number(i.deliveredQuantity ?? 0) > 0) ? "part" : null;
}

export function ClosingCard({
  job, closing, margins, payments = [], stamps = null,
}: { job: JobDetail; closing: JobClosingInfo; margins: boolean; payments?: JobPayment[]; stamps?: JobStamps | null }) {
  const flow = useFlowActions();
  const finished = closing.stage === "dokonceno";
  const delivered = deliveredOf(job, closing, flow?.snapshot?.delivery);
  const invoiced = Boolean((closing.invoiceNumber ?? "").trim() || closing.invoiceDate);
  const paid = Boolean(closing.paidAt);
  // na řadě: po dodání faktura — potvrzený DL není podmínka; po faktuře platba
  const s1: StepState = delivered === "all" ? "done" : delivered === "part" ? "current" : "todo";
  // faktura je na řadě po dodání všeho (dílčí faktura na část dodávky zatím není)
  const s2: StepState = invoiced ? "done" : delivered === "all" ? "current" : "todo";
  const s3: StepState = paid ? "done" : invoiced ? "current" : "todo";
  const done = [delivered === "all", invoiced, paid].filter(Boolean).length;

  return (
    <section id="konec-toku" aria-label="Dodání, faktura a platba" className={cn("overflow-hidden rounded-2xl border bg-card shadow-sm", finished && "border-green-300 dark:border-green-500/40")}>
      <header className="flex items-center gap-2.5 border-b px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
          <ReceiptText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">Dodání, faktura a platba</h3>
          <p className="text-xs text-muted-foreground">dodací list → faktura → zaplaceno</p>
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums">{done}<span className="text-muted-foreground">/3</span></span>
      </header>
      {finished && (
        <div className="flex items-center gap-3 bg-gradient-to-r from-green-500 to-emerald-500 px-4 py-3 text-white">
          <CircleCheckBig className="h-7 w-7 shrink-0" />
          <div className="min-w-0">
            <p className="text-base font-bold leading-tight">Zakázka dokončena ✓</p>
            <p className="text-xs text-white/85">Dodáno, vyfakturováno a zaplaceno.</p>
          </div>
          <PartyPopper className="ml-auto h-6 w-6 shrink-0 opacity-80" />
        </div>
      )}
      <ol className="p-4">
        <DeliveryStep job={job} closing={closing} state={s1} delivered={delivered} stamp={stamps?.deliveryNote} invoiced={invoiced} />
        <InvoiceStep job={job} closing={closing} state={s2} invoiced={invoiced} margins={margins} stamp={stamps?.invoiced} delivered={delivered} />
        <PaidStep job={job} closing={closing} state={s3} margins={margins} invoiced={invoiced} payments={payments} stamp={stamps?.paid} />
      </ol>
    </section>
  );
}
