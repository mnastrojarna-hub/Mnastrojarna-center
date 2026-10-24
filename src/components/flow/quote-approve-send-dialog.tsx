"use client";

import * as React from "react";
import { FileText, Loader2, Send } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { draftQuoteEmail } from "@/app/actions/job-documents";
import { approveAndSendQuote } from "@/app/actions/flow-status";
import { MailFields, mailDraftError, type MailDraft } from "./document-send-dialog";

/**
 * „Schválit a odeslat“ (#25, jen super admin): návrh e-mailu se připraví BEZ PDF (draftQuoteEmail),
 * po potvrzení server nabídku schválí, vystaví PDF a odešle (approveAndSendQuote) — jedním krokem.
 * Zavřením se nic neschválí.
 */
export function QuoteApproveSendDialog({
  open, onOpenChange, jobId, quoteId, number, onDone, updatedAt = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  quoteId: string;
  number: string | null;
  /** quotes.updated_at, jak ho uživatel viděl — změněnou nabídku server neschválí. */
  updatedAt?: string | null;
  onDone: (message: string) => void;
}) {
  const [mail, setMail] = React.useState<MailDraft>({ to: "", cc: "", subject: "", body: "" });
  const [filename, setFilename] = React.useState<string | null>(null);
  const [step, setStep] = React.useState<"preparing" | "form" | "sending">("preparing");
  const [error, setError] = React.useState<string | null>(null);
  const run = React.useRef(0);

  React.useEffect(() => {
    if (!open) {
      run.current += 1;
      return;
    }
    const token = ++run.current;
    setStep("preparing");
    setError(null);
    draftQuoteEmail(jobId, quoteId).then((d) => {
      if (token !== run.current) return;
      if (d.ok) {
        setMail({ to: d.to ?? "", cc: "", subject: d.subject ?? "", body: d.body ?? "" });
        setFilename(d.filename ?? null);
      } else {
        setError(d.error ?? "Návrh e-mailu se nepodařilo připravit.");
      }
      setStep("form");
    }).catch(() => {
      if (token !== run.current) return;
      setError("Spojení se nepovedlo — zkus to znovu.");
      setStep("form");
    });
  }, [open, jobId, quoteId]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (step !== "form") return;
    const bad = mailDraftError(mail);
    if (bad) return setError(bad);
    setStep("sending");
    setError(null);
    try {
      const res = await approveAndSendQuote(
        quoteId,
        { to: mail.to.trim(), cc: mail.cc.trim() || undefined, subject: mail.subject.trim(), body: mail.body },
        { expectedUpdatedAt: updatedAt },
      );
      if (!res.ok) {
        setError(res.error ?? "Nabídku se nepodařilo schválit a odeslat.");
        setStep("form");
        return;
      }
      onDone(`${number?.trim() ? `Nabídka ${number.trim()}` : "Nabídka"} schválena a odeslána na ${mail.to.trim()}.`);
      onOpenChange(false);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
      setStep("form");
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => step !== "sending" && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className="top-[3%] max-h-[94vh] w-[calc(100%-1rem)] overflow-y-auto sm:top-[6%] sm:max-w-2xl">
        <DialogHead
          icon={Send}
          tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
          title={`Schválit a odeslat nabídku ${number ?? ""}`.trim()}
          subtitle="Po potvrzení se nabídka schválí, vystaví se PDF a e-mail odejde z tvé schránky."
        />
        <form onSubmit={submit} className="space-y-4 p-4 sm:p-5" noValidate>
          <ErrorBox error={error} />
          {step === "preparing" ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" aria-hidden />
              Připravuji návrh e-mailu…
            </div>
          ) : (
            <>
              {filename && (
                <p className="flex items-center gap-2 rounded-lg border bg-violet-50 px-3 py-2 text-sm dark:bg-violet-500/10">
                  <FileText className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" aria-hidden />
                  <span className="min-w-0 flex-1 truncate font-medium">{filename}</span>
                  <span className="shrink-0 text-xs text-muted-foreground">vystaví se po schválení</span>
                </p>
              )}
              <MailFields mail={mail} onChange={setMail} disabled={step === "sending"} />
            </>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className="min-h-11 sm:min-h-9" onClick={() => onOpenChange(false)} disabled={step === "sending"}>Zrušit</Button>
            <Button type="submit" variant="send" className="min-h-11 sm:min-h-9" disabled={step !== "form"}>
              {step === "sending" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Send className="h-4 w-4" aria-hidden />}
              Schválit a odeslat
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
