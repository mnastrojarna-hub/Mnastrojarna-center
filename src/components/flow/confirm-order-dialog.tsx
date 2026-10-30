"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BadgeCheck, ExternalLink, GitCompare, Loader2, Mail, MailCheck, Send } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { useNotify } from "@/components/jobs/detail/toast";
import { updateJob } from "@/app/actions/jobs";
import { draftJobDocumentEmail, generateJobDocument, sendJobDocument } from "@/app/actions/job-documents";
import { setOrderStatus } from "@/app/actions/flow-status";
import type { OrderMismatch, OrderDocStatus } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { AttachmentChip, MailFields, mailDraftError, type MailDraft } from "./document-send-dialog";
import { czDay } from "./flow-utils";
import type { OrderRevisionView } from "./flow-state";

export interface ConfirmJob {
  id: string;
  number: string;
  title: string;
  customerName: string | null;
  customerOrderNumber: string | null;
  customerRequiredDate: string | null;
  dueDate: string | null;
  /** Kam potvrzení poslat (kontakt zakázky / e-mail zákazníka). */
  email: string | null;
  /** Doklad objednávky (null = zatím není). */
  orderStatus?: OrderDocStatus | null;
  orderRevision?: number;
}

/**
 * confirm = potvrdit doručenou objednávku (z rozporu „Přijmout, jak je“);
 * send = odeslat potvrzení už potvrzené objednávky (bez dokladu, po potvrzení změny).
 */
export type ConfirmMode = "confirm" | "send";

type Step = "form" | "working" | "unpriced" | "mail" | "sending";

/**
 * Potvrzení objednávky: potvrzený termín (výchozí = požadovaný zákazníkem), poznámka a PDF
 * potvrzení k aktuální revizi objednávky. Odeslání e-mailem potvrdí objednávku samo (DB podle
 * odeslané revize); bez e-mailu jde o „Potvrzeno jinak“ s poznámkou. Kdo potvrdil, zapíše DB.
 */
export function ConfirmOrderDialog({
  open, onOpenChange, job, mode = "confirm", mismatch, revision, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  job: ConfirmJob;
  mode?: ConfirmMode;
  /** Rozdíly proti nabídce — potvrzení = „Přijmout, jak je“. */
  mismatch?: OrderMismatch["items"] | null;
  /** Poslední změna objednávky (rozdíl proti předchozí revizi). */
  revision?: OrderRevisionView | null;
  onDone?: () => void;
}) {
  const router = useRouter();
  const notify = useNotify();
  const [step, setStep] = React.useState<Step>("form");
  const [date, setDate] = React.useState(job.dueDate ?? job.customerRequiredDate ?? "");
  const [note, setNote] = React.useState("");
  const [sendMail, setSendMail] = React.useState(mode === "send" || Boolean(job.email));
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<{ id: string; filename: string; number: string } | null>(null);
  const [mail, setMail] = React.useState<MailDraft>({ to: "", cc: "", subject: "", body: "" });

  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setStep("form");
      setDate(job.dueDate ?? job.customerRequiredDate ?? "");
      setNote("");
      setSendMail(mode === "send" || Boolean(job.email));
      setError(null);
      setWarning(null);
      setFile(null);
      setMail({ to: "", cc: "", subject: "", body: "" });
    }
  }

  const rev = job.orderRevision && job.orderRevision > 1 ? job.orderRevision : null;
  const accepting = Boolean(mismatch?.length) && mode === "confirm";

  function done(text: string, f: { id: string } | null) {
    onOpenChange(false);
    notify("success", text, f ? { label: "Otevřít PDF", href: `/api/jobs/files/${f.id}`, external: true } : undefined);
    onDone?.();
    router.refresh();
  }

  /**
   * Bez e-mailu: objednávku potvrdíme, ale potvrzení zatím NEODEŠLO (žádný falešný fakt „odesláno");
   * další krok pak je „Odeslat potvrzení". Předání telefonem / osobně je menu „Potvrzeno jinak…".
   */
  async function confirmOther(f: { id: string; number: string } | null) {
    if (mode === "send") return done(`Potvrzení ${f?.number ?? ""} je vystavené v Dokumentech — odešleš ho později.`, f);
    const why = [accepting ? "přijato, jak je (rozpor s nabídkou)" : null, "potvrzení zatím neodesláno", note.trim() || null].filter(Boolean).join(" — ");
    const res = await setOrderStatus(job.id, "potvrzena", { note: why, confirmationSent: false });
    if (!res.ok) {
      setError(res.error ?? "Potvrzení je vystavené, ale objednávku se nepodařilo potvrdit.");
      setStep(file ? "mail" : "form");
      return;
    }
    done(`Objednávka ${job.number} potvrzena — potvrzení ${f?.number ?? ""} je v Dokumentech, zatím neodeslané.`, f);
  }

  async function issue(force = false) {
    if (!date) return setError("Zadej termín dodání, který zákazníkovi potvrzujeme.");
    setStep("working");
    setError(null);
    try {
      if (date !== (job.dueDate ?? "")) {
        const up = await updateJob(job.id, { dueDate: date });
        if (!up.ok) {
          setError(up.error ?? "Termín se nepodařilo uložit.");
          setStep("form");
          return;
        }
      }
      const gen = await generateJobDocument(job.id, "potvrzeni", { note: note.trim() || undefined, ...(force ? { force: true } : {}) });
      if (!gen.ok || !gen.fileId) {
        if (gen.unpriced) {
          setWarning(gen.error ?? "Některé položky nemají cenu.");
          setStep("unpriced");
          return;
        }
        setError(gen.error ?? "PDF potvrzení se nepodařilo vytvořit.");
        setStep("form");
        return;
      }
      const f = { id: gen.fileId, filename: gen.filename ?? "Potvrzeni.pdf", number: gen.number ?? "" };
      setFile(f);
      if (!sendMail) return void (await confirmOther(f));

      const draft = await draftJobDocumentEmail(job.id, f.id);
      setMail({
        to: (draft.ok && draft.to) || job.email || "",
        cc: (draft.ok && draft.cc) || "",
        subject: (draft.ok && draft.subject) || `Potvrzení objednávky ${f.number}`,
        body: (draft.ok && draft.body) || "",
        reason: (draft.ok && draft.to && draft.recipientReason) || undefined,
      });
      setStep("mail");
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
      setStep("form");
    }
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!file || step !== "mail") return;
    const bad = mailDraftError(mail);
    if (bad) return setError(bad);
    setStep("sending");
    setError(null);
    try {
      const res = await sendJobDocument(job.id, file.id, {
        to: mail.to.trim(), cc: mail.cc.trim() || undefined, subject: mail.subject.trim(), body: mail.body,
      });
      if (!res.ok) {
        setError(res.error ?? "E-mail se nepodařilo odeslat.");
        setStep("mail");
        return;
      }
      done(
        mode === "send"
          ? `Potvrzení ${file.number} odešlo na ${mail.to.trim()}.`
          : `Objednávka ${job.number} potvrzena — potvrzení ${file.number} odešlo na ${mail.to.trim()}.`,
        file,
      );
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
      setStep("mail");
    }
  }

  const busy = step === "working" || step === "sending";
  const mailStep = step === "mail" || step === "sending";
  const title = mailStep
    ? `Poslat potvrzení zakázky ${job.number}`
    : mode === "send" ? `Odeslat potvrzení ${job.number}` : accepting ? `Přijmout objednávku ${job.number}, jak je` : `Potvrdit objednávku ${job.number}`;

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className="top-[3%] max-h-[94dvh] w-[calc(100%-1rem)] overflow-y-auto sm:top-[6%] sm:max-w-2xl">
        <DialogHead
          icon={mailStep ? Send : mode === "send" ? MailCheck : BadgeCheck}
          tone={mailStep ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400" : "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"}
          title={title}
          subtitle={
            <>
              {job.customerName ?? "Zákazník neuveden"}
              {job.customerOrderNumber ? <> · obj. zák. <span className="font-mono">{job.customerOrderNumber}</span></> : null}
              {rev ? <> · rev {rev}</> : null}
            </>
          }
        />
        {mailStep ? (
          <form onSubmit={send} className="space-y-4 p-4 sm:p-5" noValidate>
            <ErrorBox error={error} />
            {file && <AttachmentChip fileId={file.id} filename={file.filename} />}
            <MailFields mail={mail} onChange={setMail} disabled={step === "sending"} context={{ jobId: job.id }} />
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" disabled={step === "sending"} onClick={() => void confirmOther(file)}>
                {mode === "send" ? "Neposílat teď" : "Neposílat, jen potvrdit"}
              </Button>
              <Button type="submit" variant="send" className="min-h-11 sm:min-h-9" disabled={step === "sending"}>
                {step === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                Odeslat potvrzení
              </Button>
            </div>
          </form>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void issue();
            }}
            className="space-y-4 p-4 sm:p-5"
            noValidate
          >
            <ErrorBox error={error} />
            {accepting && mismatch && <MismatchList items={mismatch} title="Objednávka se liší od nabídky — potvrdíme ji tak, jak přišla:" />}
            {revision && revision.changes.length > 0 && (
              <RevisionDiff revision={revision} />
            )}
            {step === "unpriced" ? (
              <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
                <p className="flex items-start gap-2 font-medium">
                  <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> {warning}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" variant="outline" onClick={() => setStep("form")}>Zpět</Button>
                  <Button asChild type="button" variant="ghost">
                    <a href={`/orders/${job.id}?tab=polozky`}>Doplnit ceny v zakázce <ExternalLink className="h-3.5 w-3.5" /></a>
                  </Button>
                  <Button type="button" onClick={() => void issue(true)}>Přesto vystavit</Button>
                </div>
              </div>
            ) : (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Potvrzený termín dodání *</span>
                    <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} className="h-11 sm:h-10" autoFocus />
                    <span className="block text-[11px] text-muted-foreground">
                      {job.customerRequiredDate ? <>Zákazník požaduje {czDay(job.customerRequiredDate)}.</> : "Zákazník termín neuvedl."}
                    </span>
                  </label>
                  {mode === "confirm" ? (
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Poslat zákazníkovi</span>
                      <label className="flex min-h-11 cursor-pointer items-center gap-2.5 rounded-md border px-3 text-sm sm:min-h-10">
                        <Switch checked={sendMail} onCheckedChange={setSendMail} disabled={busy} aria-label="Poslat potvrzení zákazníkovi e-mailem" />
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{sendMail ? "Poslat potvrzení e-mailem" : "Jen vystavit PDF — předám jinak"}</span>
                      </label>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {sendMail
                          ? job.email ? <>na {job.email} (před odesláním uvidíš text)</> : "E-mail zákazníka neznáme — doplníš ho v dalším kroku."
                          : "Zapíše se „Potvrzeno jinak“ s tvým jménem."}
                      </span>
                    </div>
                  ) : (
                    <p className="self-end text-xs text-muted-foreground">
                      Vystaví se PDF k aktuální revizi{rev ? ` ${rev}` : ""} a před odesláním uvidíš text e-mailu.
                    </p>
                  )}
                </div>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Poznámka do potvrzení (nepovinné)</span>
                  <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="Např. dodání ve 2 dávkách, doprava naším autem…" />
                </label>
                <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                  <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => onOpenChange(false)} disabled={busy}>Zrušit</Button>
                  <Button type="submit" disabled={busy} className="min-h-11 bg-indigo-600 text-white hover:bg-indigo-600/90 sm:min-h-9">
                    {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                    {sendMail ? "Vystavit a pokračovat k e-mailu" : accepting ? "Přijmout, jak je" : "Potvrdit objednávku"}
                  </Button>
                </div>
              </>
            )}
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Seznam rozdílů objednávky proti nabídce. */
export function MismatchList({ items, title }: { items: OrderMismatch["items"]; title?: string }) {
  return (
    <div className="space-y-1.5 rounded-xl border border-rose-200 bg-rose-50/70 p-3 text-sm dark:border-rose-500/30 dark:bg-rose-500/10">
      <p className="flex items-center gap-1.5 font-medium text-rose-800 dark:text-rose-200">
        <GitCompare className="h-4 w-4 shrink-0" aria-hidden /> {title ?? "Rozdíly proti nabídce"}
      </p>
      <ul className="space-y-1">
        {items.map((i, n) => (
          <li key={`${i.kind}-${n}`} className="flex flex-wrap gap-x-2 text-rose-900 dark:text-rose-100">
            <span className="font-medium">{i.label}</span>
            {(i.quote || i.order) && (
              <span className="text-rose-800/80 dark:text-rose-200/80">
                nabídka {i.quote ?? "—"} → objednávka {i.order ?? "—"}
              </span>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Rozdíl revize objednávky proti předchozí („rev 2 · změnu zapsal X“). */
export function RevisionDiff({ revision, className }: { revision: OrderRevisionView; className?: string }) {
  return (
    <div className={cn("space-y-1.5 rounded-xl border border-indigo-200 bg-indigo-50/60 p-3 text-sm dark:border-indigo-500/30 dark:bg-indigo-500/10", className)}>
      <p className="font-medium text-indigo-900 dark:text-indigo-100">
        Změna rev {revision.revision} proti rev {revision.revision - 1}
        {revision.customerOrderNumber ? <> · obj. <span className="font-mono">{revision.customerOrderNumber}</span></> : null}
      </p>
      {revision.changes.length > 0 ? (
        <ul className="space-y-0.5">
          {revision.changes.map((c, i) => (
            <li key={`${c.field}-${i}`} className="flex flex-wrap gap-x-2">
              <span className="font-medium">{c.label}:</span>
              <span className="text-muted-foreground line-through">{c.from ?? "—"}</span>
              <span>→ {c.to ?? "—"}</span>
            </li>
          ))}
        </ul>
      ) : null}
      {revision.note && <p className="whitespace-pre-wrap text-xs text-indigo-900/80 dark:text-indigo-100/80">{revision.note}</p>}
    </div>
  );
}
