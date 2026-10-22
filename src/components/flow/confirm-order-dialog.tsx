"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, BadgeCheck, ExternalLink, Loader2, Mail, Send } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { useNotify } from "@/components/jobs/detail/toast";
import { setJobStage, updateJob } from "@/app/actions/jobs";
import { draftJobDocumentEmail, generateJobDocument, sendJobDocument } from "@/app/actions/job-documents";
import { cn } from "@/lib/utils";
import { AttachmentChip, MailFields, mailDraftError, type MailDraft } from "./document-send-dialog";
import { czDay } from "./flow-utils";

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
}

type Step = "form" | "working" | "unpriced" | "mail" | "sending";

/**
 * „Potvrdit objednávku": potvrzený termín (výchozí = požadovaný zákazníkem), poznámka,
 * volitelně e-mail zákazníkovi. Uloží termín → vystaví PDF potvrzení → (pošle) →
 * zakázka do stavu „Potvrzená objednávka".
 */
export function ConfirmOrderButton({ job, className }: { job: ConfirmJob; className?: string }) {
  const router = useRouter();
  const notify = useNotify();
  const [open, setOpen] = React.useState(false);
  const [step, setStep] = React.useState<Step>("form");
  const [date, setDate] = React.useState(job.dueDate ?? job.customerRequiredDate ?? "");
  const [note, setNote] = React.useState("");
  const [sendMail, setSendMail] = React.useState(Boolean(job.email));
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<{ id: string; filename: string; number: string } | null>(null);
  const [mail, setMail] = React.useState<MailDraft>({ to: "", cc: "", subject: "", body: "" });

  function reset() {
    setStep("form");
    setDate(job.dueDate ?? job.customerRequiredDate ?? "");
    setNote("");
    setSendMail(Boolean(job.email));
    setError(null);
    setWarning(null);
    setFile(null);
    setMail({ to: "", cc: "", subject: "", body: "" });
  }

  async function finish(f: { id: string; number: string } | null, sentTo?: string) {
    const st = await setJobStage(job.id, "potvrzeno");
    if (!st.ok) {
      setError(st.error ?? "Potvrzení je vystavené, ale stav zakázky se nepodařilo změnit.");
      setStep(sentTo ? "mail" : "form");
      return;
    }
    setOpen(false);
    notify(
      "success",
      sentTo
        ? `Objednávka ${job.number} potvrzena — potvrzení ${f?.number ?? ""} odešlo na ${sentTo}.`
        : `Objednávka ${job.number} potvrzena — potvrzení ${f?.number ?? ""} je v Dokumentech.`,
      f ? { label: "Otevřít PDF", href: `/api/jobs/files/${f.id}`, external: true } : undefined,
    );
    router.refresh();
  }

  async function confirm(force = false) {
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
      if (!sendMail) return void (await finish(f));

      const draft = await draftJobDocumentEmail(job.id, f.id);
      setMail({
        to: (draft.ok && draft.to) || job.email || "",
        cc: "",
        subject: (draft.ok && draft.subject) || `Potvrzení objednávky ${f.number}`,
        body: (draft.ok && draft.body) || "",
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
      await finish(file, mail.to.trim());
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
      setStep("mail");
    }
  }

  const busy = step === "working" || step === "sending";

  return (
    <>
      <Button
        type="button"
        size="sm"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className={cn("bg-indigo-600 text-white shadow-sm hover:bg-indigo-600/90", className)}
      >
        <BadgeCheck className="h-4 w-4" /> Potvrdit objednávku
      </Button>
      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent aria-describedby={undefined} className="top-[3%] max-h-[94vh] w-[calc(100%-1rem)] overflow-y-auto sm:top-[6%] sm:max-w-2xl">
          <DialogHead
            icon={step === "mail" || step === "sending" ? Send : BadgeCheck}
            tone={step === "mail" || step === "sending" ? "bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400" : "bg-indigo-100 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300"}
            title={step === "mail" || step === "sending" ? `Poslat potvrzení zakázky ${job.number}` : `Potvrdit objednávku ${job.number}`}
            subtitle={
              <>
                {job.customerName ?? "Zákazník neuveden"}
                {job.customerOrderNumber ? <> · obj. zák. <span className="font-mono">{job.customerOrderNumber}</span></> : null}
              </>
            }
          />
          {step === "mail" || step === "sending" ? (
            <form onSubmit={send} className="space-y-4 p-4 sm:p-5" noValidate>
              <ErrorBox error={error} />
              {file && <AttachmentChip fileId={file.id} filename={file.filename} />}
              <MailFields mail={mail} onChange={setMail} disabled={step === "sending"} />
              <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button type="button" variant="ghost" disabled={step === "sending"} onClick={() => void finish(file)}>
                  Neposílat, jen potvrdit
                </Button>
                <Button type="submit" variant="send" disabled={step === "sending"}>
                  {step === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Odeslat potvrzení
                </Button>
              </div>
            </form>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void confirm();
              }}
              className="space-y-4 p-4 sm:p-5"
              noValidate
            >
              <ErrorBox error={error} />
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
                    <Button type="button" onClick={() => void confirm(true)}>Přesto vystavit</Button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="block space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Potvrzený termín dodání *</span>
                      <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} disabled={busy} className="h-10" autoFocus />
                      <span className="block text-[11px] text-muted-foreground">
                        {job.customerRequiredDate ? <>Zákazník požaduje {czDay(job.customerRequiredDate)}.</> : "Zákazník termín neuvedl."}
                      </span>
                    </label>
                    <div className="space-y-1">
                      <span className="text-xs font-medium text-muted-foreground">Poslat zákazníkovi</span>
                      <label className="flex h-10 cursor-pointer items-center gap-2.5 rounded-md border px-3 text-sm">
                        <Switch checked={sendMail} onCheckedChange={setSendMail} disabled={busy} aria-label="Poslat potvrzení zákazníkovi e-mailem" />
                        <Mail className="h-4 w-4 text-muted-foreground" />
                        <span className="truncate">{sendMail ? "Poslat potvrzení e-mailem" : "Jen vystavit PDF"}</span>
                      </label>
                      <span className="block truncate text-[11px] text-muted-foreground">
                        {job.email ? <>na {job.email} (před odesláním uvidíš text)</> : "E-mail zákazníka neznáme — doplníš ho v dalším kroku."}
                      </span>
                    </div>
                  </div>
                  <label className="block space-y-1">
                    <span className="text-xs font-medium text-muted-foreground">Poznámka do potvrzení (nepovinné)</span>
                    <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} disabled={busy} placeholder="Např. dodání ve 2 dávkách, doprava naším autem…" />
                  </label>
                  <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                    <Button type="button" variant="ghost" onClick={() => setOpen(false)} disabled={busy}>Zrušit</Button>
                    <Button type="submit" disabled={busy} className="bg-indigo-600 text-white hover:bg-indigo-600/90">
                      {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BadgeCheck className="h-4 w-4" />}
                      {sendMail ? "Vystavit a pokračovat k e-mailu" : "Potvrdit objednávku"}
                    </Button>
                  </div>
                </>
              )}
            </form>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
