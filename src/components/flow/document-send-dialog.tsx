"use client";

import * as React from "react";
import { AlertTriangle, ExternalLink, Loader2, Paperclip, RotateCcw, Send } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import {
  draftJobDocumentEmail, generateJobDocument, sendJobDocument, type JobDocumentKind,
} from "@/app/actions/job-documents";
import { parseEmailList } from "@/lib/jobs/document-emails";

export interface MailDraft {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

const KIND_TEXT: Record<JobDocumentKind, { what: string; preparing: string }> = {
  nabidka: { what: "nabídku", preparing: "Připravuji PDF nabídky a návrh e-mailu…" },
  potvrzeni: { what: "potvrzení objednávky", preparing: "Připravuji PDF potvrzení a návrh e-mailu…" },
  dodaci_list: { what: "dodací list", preparing: "Připravuji PDF dodacího listu a návrh e-mailu…" },
  faktura: { what: "fakturu", preparing: "Připravuji PDF faktury a návrh e-mailu…" },
};

/** Kontrola adres a předmětu před odesláním (null = v pořádku). */
export function mailDraftError(mail: MailDraft): string | null {
  const to = parseEmailList(mail.to);
  const cc = parseEmailList(mail.cc);
  if (!to.valid.length && !to.invalid.length) return "Vyplň, komu e-mail půjde.";
  const bad = [...to.invalid, ...cc.invalid][0];
  if (bad) return `Neplatná e-mailová adresa: ${bad}`;
  if (!mail.subject.trim()) return "Doplň předmět e-mailu.";
  return null;
}

/** Komu / kopie / předmět / text — sdílí odeslání nabídky i potvrzení. */
export function MailFields({ mail, onChange, disabled }: { mail: MailDraft; onChange: (m: MailDraft) => void; disabled?: boolean }) {
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Komu</span>
          <Input type="text" inputMode="email" autoComplete="email" value={mail.to} disabled={disabled} onChange={(e) => onChange({ ...mail, to: e.target.value })} placeholder="nakup@zakaznik.cz" className="h-10" />
        </label>
        <label className="block space-y-1">
          <span className="text-xs font-medium text-muted-foreground">Kopie (nepovinné)</span>
          <Input type="text" inputMode="email" autoComplete="email" value={mail.cc} disabled={disabled} onChange={(e) => onChange({ ...mail, cc: e.target.value })} placeholder="kolega@mnastrojarna.cz" className="h-10" />
        </label>
      </div>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Předmět</span>
        <Input value={mail.subject} disabled={disabled} onChange={(e) => onChange({ ...mail, subject: e.target.value })} className="h-10" />
      </label>
      <label className="block space-y-1">
        <span className="text-xs font-medium text-muted-foreground">Text e-mailu</span>
        <Textarea rows={10} value={mail.body} disabled={disabled} onChange={(e) => onChange({ ...mail, body: e.target.value })} className="font-[inherit] leading-relaxed" />
      </label>
    </div>
  );
}

/** Odkaz na přílohu (PDF) — otevře náhled v novém panelu. */
export function AttachmentChip({ fileId, filename }: { fileId: string; filename: string }) {
  return (
    <a
      href={`/api/jobs/files/${fileId}`}
      target="_blank"
      rel="noopener noreferrer"
      className="flex items-center gap-2.5 rounded-lg border bg-violet-50 px-3 py-2 text-sm transition hover:brightness-95 dark:bg-violet-500/10"
    >
      <Paperclip className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
      <span className="min-w-0 flex-1 truncate font-medium">{filename}</span>
      <span className="inline-flex shrink-0 items-center gap-1 text-xs text-violet-700 dark:text-violet-300">
        Náhled <ExternalLink className="h-3 w-3" />
      </span>
    </a>
  );
}

type Step = "preparing" | "unpriced" | "form" | "sending";

/**
 * Odeslání dokladu zákazníkovi: (1) vytvoří PDF (uloží se do Dokumentů zakázky),
 * (2) předvyplní e-mail, (3) po kontrole odešle z mé schránky s PDF v příloze.
 * Položky bez ceny u nabídky / potvrzení / faktury → varování a „Přesto odeslat / vystavit".
 */
export function DocumentSendDialog({
  open,
  onOpenChange,
  jobId,
  kind,
  quoteId,
  fileId: givenFileId,
  filename: givenFilename,
  title,
  onSent,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  kind: JobDocumentKind;
  quoteId?: string;
  /** PDF už existuje (např. právě vystavené potvrzení) — negeneruje se znovu. */
  fileId?: string;
  filename?: string;
  title: string;
  onSent?: (info: { to: string }) => void;
}) {
  const [step, setStep] = React.useState<Step>("preparing");
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<{ id: string; filename: string } | null>(null);
  const [mail, setMail] = React.useState<MailDraft>({ to: "", cc: "", subject: "", body: "" });
  const run = React.useRef(0);

  const prepare = React.useCallback(async (force = false) => {
    const token = ++run.current;
    setStep("preparing");
    setError(null);
    try {
      let f = givenFileId ? { id: givenFileId, filename: givenFilename ?? "doklad.pdf" } : null;
      if (!f) {
        const gen = await generateJobDocument(jobId, kind, { ...(quoteId ? { quoteId } : {}), ...(force ? { force: true } : {}), reuse: true });
        if (token !== run.current) return;
        if (!gen.ok || !gen.fileId) {
          if (gen.unpriced) {
            setWarning(gen.error ?? "Některé položky nemají cenu.");
            setStep("unpriced");
            return;
          }
          setError(gen.error ?? "PDF se nepodařilo vytvořit.");
          setStep("form");
          return;
        }
        f = { id: gen.fileId, filename: gen.filename ?? "doklad.pdf" };
      }
      setFile(f);
      const draft = await draftJobDocumentEmail(jobId, f.id);
      if (token !== run.current) return;
      if (draft.ok) {
        setMail((m) => ({ to: draft.to || m.to, cc: m.cc, subject: draft.subject ?? m.subject, body: draft.body ?? m.body }));
      } else if (draft.error) {
        setError(`Návrh e-mailu se nepodařilo připravit: ${draft.error}`);
      }
      setStep("form");
    } catch {
      if (token !== run.current) return;
      setError("Spojení se nepovedlo — zkus to znovu.");
      setStep("form");
    }
  }, [jobId, kind, quoteId, givenFileId, givenFilename]);

  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFile(null);
      setWarning(null);
      setError(null);
      setMail({ to: "", cc: "", subject: "", body: "" });
      setStep("preparing");
    }
  }
  // PDF se připraví jednou na otevření; beze změny obsahu se použije poslední vystavený (reuse)
  const prepareRef = React.useRef(prepare);
  prepareRef.current = prepare;
  const started = React.useRef(false);
  React.useEffect(() => {
    if (!open) {
      started.current = false;
      run.current += 1;
      return;
    }
    if (started.current) return;
    started.current = true;
    void prepareRef.current();
  }, [open]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!file || step !== "form") return;
    const bad = mailDraftError(mail);
    if (bad) return setError(bad);
    setStep("sending");
    setError(null);
    try {
      const res = await sendJobDocument(jobId, file.id, {
        to: mail.to.trim(), cc: mail.cc.trim() || undefined, subject: mail.subject.trim(), body: mail.body,
      });
      if (!res.ok) {
        setError(res.error ?? "E-mail se nepodařilo odeslat.");
        setStep("form");
        return;
      }
      onSent?.({ to: mail.to.trim() });
      onOpenChange(false);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
      setStep("form");
    }
  }

  const text = KIND_TEXT[kind];

  return (
    <Dialog open={open} onOpenChange={(o) => step !== "sending" && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className="top-[3%] max-h-[94vh] w-[calc(100%-1rem)] overflow-y-auto sm:top-[6%] sm:max-w-2xl">
        <DialogHead
          icon={Send}
          tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
          title={title}
          subtitle="Zkontroluj adresu a text — e-mail odejde z tvé schránky s PDF v příloze."
        />
        <form onSubmit={send} className="space-y-4 p-4 sm:p-5" noValidate>
          <ErrorBox error={error} />
          {step === "preparing" && (
            <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
              {text.preparing}
            </div>
          )}
          {step === "unpriced" && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              <p className="flex items-start gap-2 font-medium">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> {warning}
              </p>
              <p className="text-amber-800/90 dark:text-amber-200/80">
                Položky bez ceny budou mít v dokladu „—“. Ceny doplníš v Nacenění nebo v kartě zakázky (záložka Položky).
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Zpět — doplním ceny</Button>
                <Button type="button" variant="default" onClick={() => void prepare(true)}>{kind === "nabidka" ? "Přesto odeslat" : "Přesto vystavit"}</Button>
              </div>
            </div>
          )}
          {(step === "form" || step === "sending") && (
            <>
              {file ? (
                <AttachmentChip fileId={file.id} filename={file.filename} />
              ) : (
                <Button type="button" variant="outline" onClick={() => void prepare()}>
                  <RotateCcw className="h-4 w-4" /> Zkusit PDF vytvořit znovu
                </Button>
              )}
              <MailFields mail={mail} onChange={setMail} disabled={step === "sending"} />
            </>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={step === "sending"}>Zrušit</Button>
            <Button type="submit" variant="send" disabled={step !== "form" || !file}>
              {step === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Odeslat {text.what}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
