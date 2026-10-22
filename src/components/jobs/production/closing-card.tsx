"use client";

import * as React from "react";
import {
  Banknote, Camera, Check, CircleCheckBig, ExternalLink, FileCheck2, FileUp, Loader2, PartyPopper, Pencil, ReceiptText,
  Truck, Undo2, UserRound, type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  confirmDeliveryNote, markJobPaid, setInvoiceInfo, unconfirmDeliveryNote, unmarkJobPaid,
} from "@/app/actions/production";
import { uploadJobFile, type UploadPhase } from "@/lib/jobs/upload-client";
import { czDay, dueDateFor, dueText, DEFAULT_PAYMENT_TERMS } from "@/lib/jobs/production";
import type { JobClosingInfo } from "@/lib/jobs/production-types";
import type { JobDetail } from "@/lib/jobs/types";
import { UPLOAD_PHASE_LABELS, useJobDetail } from "@/components/jobs/detail/detail-context";
import { formatMoney, parseDecimal } from "@/components/jobs/detail/detail-helpers";
import { todayInPrague } from "@/components/jobs/book/book-params";
import { cn } from "@/lib/utils";
import { useRunner } from "./production-context";
import {
  CONFIRMED_DL_TITLE, INVOICE_TONE, closingProgress, closingStamp, confirmedDeliveryFile, invoiceTone, stampLabel,
} from "./production-helpers";

/**
 * Konec toku zakázky jako tři velké kroky: potvrzený dodací list → naše faktura
 * (splatnost) → zaplaceno. Po zaplacení je zakázka dokončená.
 */

type StepState = "done" | "current" | "todo";

function Step({
  n, icon: Icon, title, state, last, children, aside,
}: {
  n: number;
  icon: LucideIcon;
  title: string;
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

/** „Potvrdil · 20. 10. 14:05 · Petr Novák" — kdo krok zapsal. */
function ByLine({ job, kind, prefix }: { job: JobDetail; kind: "delivery_note" | "invoice" | "paid"; prefix: string }) {
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

// ── 1) Potvrzený dodací list ────────────────────────────────
function DeliveryStep({ job, closing, state }: { job: JobDetail; closing: JobClosingInfo; state: StepState }) {
  const { notify } = useJobDetail();
  const { run, isBusy } = useRunner();
  const [date, setDate] = React.useState(() => todayInPrague());
  const [phase, setPhase] = React.useState<UploadPhase | null>(null);
  const photoRef = React.useRef<HTMLInputElement>(null);
  const fileRef = React.useRef<HTMLInputElement>(null);
  const dateId = React.useId();
  const file = confirmedDeliveryFile(job.files);
  const confirmed = closing.deliveryNoteConfirmedAt;
  const busy = phase !== null || isBusy("dl");

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
      title="Potvrzený dodací list"
      state={state}
      aside={confirmed ? <UndoButton busy={isBusy("dl-undo")} onClick={() => void run("dl-undo", () => unconfirmDeliveryNote(job.id), { success: "Potvrzení dodacího listu zrušeno." })} /> : null}
    >
      {confirmed ? (
        <DoneBox>
          <p className="font-semibold">Zákazník potvrdil převzetí {czDay(confirmed)}</p>
          <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
            {closing.deliveryNoteNumber && <span>DL č. <strong className="font-mono">{closing.deliveryNoteNumber}</strong></span>}
            {file ? (
              <a href={`/api/jobs/files/${file.id}`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold text-green-800 underline-offset-2 hover:underline dark:text-green-300">
                <FileCheck2 className="h-3.5 w-3.5" /> Otevřít potvrzený DL <ExternalLink className="h-3 w-3" />
              </a>
            ) : (
              <span className="opacity-80">bez skenu</span>
            )}
          </p>
          <ByLine job={job} kind="delivery_note" prefix="Potvrdil" />
          {file?.uploadedBy && (
            <p className="flex min-w-0 items-center gap-1 text-[11px] opacity-80">
              <FileCheck2 className="h-3 w-3 shrink-0" /> <span className="truncate">Sken nahrál {file.uploadedBy.name}</span>
            </p>
          )}
        </DoneBox>
      ) : (
        <>
          <p className="text-xs text-muted-foreground">Po dodání vyfoť nebo nahraj dodací list podepsaný zákazníkem.</p>
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[9.5rem] flex-1 sm:flex-none">
              <label htmlFor={dateId} className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Převzato dne</label>
              <Input id={dateId} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10" disabled={busy} />
            </div>
          </div>
          <div className="grid gap-2 min-[420px]:grid-cols-2 sm:flex sm:flex-wrap">
            <Button type="button" variant="success" className="h-11 sm:hidden" onClick={() => photoRef.current?.click()} disabled={busy}>
              {phase ? <Loader2 className="animate-spin" /> : <Camera />} Vyfotit DL
            </Button>
            <Button type="button" variant="outline" className="h-11 sm:hidden" onClick={() => fileRef.current?.click()} disabled={busy}>
              <FileUp className="text-emerald-600" /> Ze souboru
            </Button>
            <Button type="button" variant="success" className="hidden h-10 sm:inline-flex" onClick={() => fileRef.current?.click()} disabled={busy}>
              {phase ? <Loader2 className="animate-spin" /> : <FileUp />} Nahrát potvrzený DL
            </Button>
          </div>
          {phase && <p className="text-xs font-medium text-emerald-700 dark:text-emerald-400" aria-live="polite">{UPLOAD_PHASE_LABELS[phase]}</p>}
          <button
            type="button"
            onClick={() => void run("dl", () => confirmDeliveryNote(job.id, { date }), { success: `Dodací list potvrzen (${czDay(date)}).` })}
            disabled={busy || !date}
            className="inline-flex items-center gap-1 text-xs font-medium text-sky-700 hover:underline disabled:opacity-50 dark:text-sky-400"
          >
            {isBusy("dl") && !phase ? <Loader2 className="h-3 w-3 animate-spin" /> : <Check className="h-3 w-3" />} Potvrdit bez souboru
          </button>
          <input ref={photoRef} type="file" accept="image/*" capture="environment" className="hidden" onChange={pickHandler} />
          <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={pickHandler} />
        </>
      )}
    </Step>
  );
}

// ── 2) Faktura a splatnost ──────────────────────────────────
function InvoiceStep({ job, closing, state, invoiced }: { job: JobDetail; closing: JobClosingInfo; state: StepState; invoiced: boolean }) {
  const { run, isBusy } = useRunner();
  const terms = closing.paymentTermsDays ?? job.customerDetail?.paymentTermsDays ?? null;
  const [editing, setEditing] = React.useState(false);
  const [number, setNumber] = React.useState(closing.invoiceNumber ?? "");
  const [date, setDate] = React.useState(closing.invoiceDate ?? todayInPrague());
  const [due, setDue] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const ids = { n: React.useId(), d: React.useId(), due: React.useId() };
  const busy = isBusy("inv");
  const autoDue = date
    ? closing.invoiceDueDate && date === closing.invoiceDate ? closing.invoiceDueDate : dueDateFor(date, terms)
    : "";
  const shownDue = due ?? autoDue;
  const tone = invoiceTone(closing);
  const text = dueText(closing);
  const showForm = editing || (!invoiced && state === "current");

  function startEdit() {
    setNumber(closing.invoiceNumber ?? "");
    setDate(closing.invoiceDate ?? todayInPrague());
    setDue(null);
    setError(null);
    setEditing(true);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!number.trim() && !date) {
      setError("Zadej číslo nebo datum faktury.");
      return;
    }
    if (date && shownDue && shownDue < date) {
      setError("Splatnost je před datem faktury.");
      return;
    }
    setError(null);
    const res = await run("inv", () => setInvoiceInfo(job.id, {
      invoiceNumber: number.trim() || null,
      invoiceDate: date || null,
      ...(due !== null ? { invoiceDueDate: due || null } : {}),
    }), {
      success: (r) => `Faktura uložena${r.invoiceDueDate ? ` — splatná ${czDay(r.invoiceDueDate)}` : ""}.`,
    });
    if (res) {
      setEditing(false);
      setDue(null);
    }
  }

  return (
    <Step
      n={2}
      icon={ReceiptText}
      title="Naše faktura"
      state={state}
      aside={invoiced && !editing ? (
        <button type="button" onClick={startEdit} className="inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground hover:bg-muted hover:text-foreground">
          <Pencil className="h-3 w-3" /> Upravit
        </button>
      ) : null}
    >
      {invoiced && !editing && (
        <div className={cn(
          "rounded-lg border px-3 py-2 text-sm",
          tone === "overdue" ? "border-red-300 bg-red-50 dark:border-red-500/40 dark:bg-red-500/10" : "bg-background",
        )}>
          <p className="font-semibold">
            Faktura {closing.invoiceNumber ? <span className="font-mono">{closing.invoiceNumber}</span> : <span className="font-normal text-muted-foreground">(bez čísla)</span>}
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
            <ByLine job={job} kind="invoice" prefix="Zapsal" />
          </div>
        </div>
      )}
      {!invoiced && !showForm && (
        <Button type="button" variant="outline" size="sm" onClick={startEdit}>
          <ReceiptText className="text-sky-600" /> Zapsat fakturu
        </Button>
      )}
      {showForm && (
        <form onSubmit={submit} className="space-y-2 rounded-lg border bg-background p-3">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="min-w-0">
              <label htmlFor={ids.n} className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Číslo faktury</label>
              <Input id={ids.n} value={number} maxLength={120} onChange={(e) => setNumber(e.target.value)} placeholder="FV-2026-…" className="h-10 font-mono" />
            </div>
            <div className="min-w-0">
              <label htmlFor={ids.d} className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Vystavena</label>
              <Input id={ids.d} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
            </div>
            <div className="min-w-0">
              <label htmlFor={ids.due} className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Splatná</label>
              <Input id={ids.due} type="date" value={shownDue} onChange={(e) => setDue(e.target.value)} className="h-10" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {due === null
              ? `Splatnost se dopočítá: ${terms ?? DEFAULT_PAYMENT_TERMS} dní${terms !== null ? " dle zákazníka" : " (výchozí)"}.`
              : "Splatnost zadaná ručně."}
          </p>
          {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <Button type="submit" variant="success" disabled={busy} className="h-10">
              {busy ? <Loader2 className="animate-spin" /> : <Check />} Uložit fakturu
            </Button>
            {(editing || invoiced) && (
              <Button type="button" variant="ghost" onClick={() => setEditing(false)} disabled={busy} className="h-10">Zpět</Button>
            )}
          </div>
        </form>
      )}
    </Step>
  );
}

// ── 3) Zaplaceno ────────────────────────────────────────────
function PaidStep({
  job, closing, state, margins, invoiced,
}: { job: JobDetail; closing: JobClosingInfo; state: StepState; margins: boolean; invoiced: boolean }) {
  const { run, isBusy } = useRunner();
  const [date, setDate] = React.useState(() => todayInPrague());
  const [amount, setAmount] = React.useState("");
  const [open, setOpen] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ids = { d: React.useId(), a: React.useId() };
  const busy = isBusy("paid");
  const paidAt = closing.paidAt;
  const showForm = open || state === "current";

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const n = amount.trim() ? parseDecimal(amount) : null;
    if (amount.trim() && (n === null || n < 0)) {
      setError("Zadej částku číslem (např. 48 000).");
      return;
    }
    setError(null);
    const res = await run("paid", () => markJobPaid(job.id, { date, ...(margins && n !== null ? { amount: n } : {}) }), {
      success: (r) => (r.stage === "dokonceno" ? "Zaplaceno ✓ — zakázka je dokončená." : `Zaplaceno ${czDay(date)}.`),
    });
    if (res) setOpen(false);
  }

  return (
    <Step
      n={3}
      icon={Banknote}
      title="Zaplaceno"
      state={state}
      last
      aside={paidAt && margins ? (
        <UndoButton busy={isBusy("unpaid")} label="Zrušit úhradu" onClick={() => void run("unpaid", () => unmarkJobPaid(job.id), { success: "Úhrada zrušena." })} />
      ) : null}
    >
      {paidAt ? (
        <DoneBox>
          <p className="font-semibold">Zaplaceno {czDay(paidAt)}</p>
          {margins && (closing.paidAmount !== null || job.value !== null) && (
            <p className="mt-0.5 text-xs tabular-nums">
              {formatMoney(closing.paidAmount ?? job.value, job.currency)} bez DPH{closing.paidAmount === null ? " (hodnota zakázky)" : ""}
            </p>
          )}
          <ByLine job={job} kind="paid" prefix="Zapsal" />
        </DoneBox>
      ) : showForm ? (
        <form onSubmit={submit} className="space-y-2">
          {!invoiced && <p className="text-xs text-amber-700 dark:text-amber-400">Faktura zatím není zapsaná — zakázka se dokončí, až ji doplníš.</p>}
          <div className="flex flex-wrap items-end gap-2">
            <div className="min-w-[9.5rem] flex-1 sm:flex-none">
              <label htmlFor={ids.d} className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Přišlo dne</label>
              <Input id={ids.d} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-10" />
            </div>
            {margins && (
              <div className="min-w-[8rem] flex-1">
                <label htmlFor={ids.a} className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Částka bez DPH</label>
                <Input
                  id={ids.a}
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={job.value !== null ? formatMoney(job.value, job.currency) : "hodnota zakázky"}
                  className="h-10 text-right tabular-nums"
                />
              </div>
            )}
          </div>
          {error && <p role="alert" className="text-xs text-red-600 dark:text-red-400">{error}</p>}
          <Button type="submit" variant="success" disabled={busy || !date} className="h-11 w-full text-base font-semibold sm:w-auto sm:px-6">
            {busy ? <Loader2 className="animate-spin" /> : <Banknote />} Zaplaceno
          </Button>
        </form>
      ) : (
        <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
          <Banknote className="text-green-600" /> Označit zaplaceno
        </Button>
      )}
    </Step>
  );
}

export function ClosingCard({ job, closing, margins }: { job: JobDetail; closing: JobClosingInfo; margins: boolean }) {
  const p = closingProgress(closing);
  const finished = closing.stage === "dokonceno";
  // na řadě je první nehotový krok a každý, jehož předchozí krok je hotový
  const done = [p.delivery, p.invoice, p.paid];
  const firstOpen = done.findIndex((d) => !d);
  const fixed: StepState[] = done.map((d, i) => (d ? "done" : i === firstOpen || done[i - 1] ? "current" : "todo"));

  return (
    <section aria-label="Dodání, faktura a platba" className={cn("overflow-hidden rounded-2xl border bg-card shadow-sm", finished && "border-green-300 dark:border-green-500/40")}>
      <header className="flex items-center gap-2.5 border-b px-4 py-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300">
          <ReceiptText className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold leading-tight">Dodání, faktura a platba</h3>
          <p className="text-xs text-muted-foreground">dodáme → potvrzený DL → faktura → zaplaceno</p>
        </div>
        <span className="shrink-0 text-sm font-bold tabular-nums">{p.done}<span className="text-muted-foreground">/3</span></span>
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
        <DeliveryStep job={job} closing={closing} state={fixed[0]} />
        <InvoiceStep job={job} closing={closing} state={fixed[1]} invoiced={p.invoice} />
        <PaidStep job={job} closing={closing} state={fixed[2]} margins={margins} invoiced={p.invoice} />
      </ol>
    </section>
  );
}
