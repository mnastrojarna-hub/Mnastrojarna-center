"use client";

import * as React from "react";
import { AlertTriangle, Send, Loader2, FileText, ExternalLink, RotateCcw, Paperclip } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { generateJobDocument, sendJobDocument, draftJobDocumentEmail } from "@/app/actions/job-documents";
import { useJobDetail } from "./detail-context";
import { DialogHead, ErrorBox } from "./confirm-dialog";

interface MailDraft {
  to: string;
  cc: string;
  subject: string;
  body: string;
}

type Step = "preparing" | "unpriced" | "form" | "sending";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** „a@b.cz; c@d.cz" → první neplatná adresa nebo null. */
function invalidAddress(list: string): string | null {
  for (const raw of list.split(/[,;]/)) {
    const a = raw.trim();
    if (a && !EMAIL_RE.test(a)) return a;
  }
  return null;
}

/**
 * Odeslání nabídky zákazníkovi: připraví PDF (beze změny obsahu poslední vystavené),
 * předvyplní e-mail (komu / předmět / text — vše jde upravit) a po potvrzení odešle.
 * Položky bez ceny → varování s „Zpět — doplním ceny" / „Přesto odeslat".
 */
export function QuoteSendDialog({
  open, onOpenChange, quote, fallback,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  quote: { id: string; number: string; status: string };
  /** Předvyplnění, když návrh e-mailu ze serveru selže. */
  fallback: { to: string; jobNumber: string; title: string; contact: string | null };
}) {
  const { jobId, notify, refresh } = useJobDetail();
  const [step, setStep] = React.useState<Step>("preparing");
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<{ id: string; filename: string } | null>(null);
  const [mail, setMail] = React.useState<MailDraft>({ to: "", cc: "", subject: "", body: "" });
  const run = React.useRef(0);

  const fallbackMail = React.useCallback((): MailDraft => {
    const hello = fallback.contact ? `Dobrý den, ${fallback.contact},` : "Dobrý den,";
    return {
      to: fallback.to,
      cc: "",
      subject: `Nabídka ${quote.number} — ${fallback.title}`,
      body: `${hello}\n\nv příloze posíláme nabídku ${quote.number} k Vaší poptávce (${fallback.title}).\nV případě dotazů jsme Vám k dispozici.\n\nS pozdravem\nMnástrojárna s.r.o.`,
    };
  }, [fallback.to, fallback.title, fallback.contact, quote.number]);

  const prepare = React.useCallback(async (force = false) => {
    const token = ++run.current;
    setStep("preparing");
    setError(null);
    // výchozí text hned — i když PDF selže, uživatel nepíše od nuly
    setMail((m) => (m.subject || m.body ? m : fallbackMail()));
    try {
      const gen = await generateJobDocument(jobId, "nabidka", { quoteId: quote.id, reuse: true, ...(force ? { force: true } : {}) });
      if (token !== run.current) return;
      if (!gen.ok && gen.unpriced) {
        setWarning(gen.error ?? "Některé položky nemají cenu.");
        setStep("unpriced");
        return;
      }
      if (!gen.ok || !gen.fileId) {
        setError(gen.error ?? "PDF nabídky se nepodařilo vytvořit.");
        setStep("form");
        return;
      }
      setFile({ id: gen.fileId, filename: gen.filename ?? `${quote.number}.pdf` });
      const draft = await draftJobDocumentEmail(jobId, gen.fileId);
      if (token !== run.current) return;
      if (draft.ok && (draft.subject || draft.body)) {
        setMail((m) => ({ to: draft.to || m.to || fallback.to, cc: m.cc, subject: draft.subject ?? "", body: draft.body ?? "" }));
      }
      setStep("form");
    } catch {
      if (token !== run.current) return;
      setError("Spojení se nepovedlo — zkus to znovu.");
      setStep("form");
    }
  }, [jobId, quote.id, quote.number, fallback.to, fallbackMail]);

  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFile(null);
      setWarning(null);
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
      run.current += 1; // rozběhnutá příprava už nic nepřepíše
      return;
    }
    if (started.current) return; // StrictMode spouští efekt dvakrát
    started.current = true;
    void prepareRef.current();
  }, [open]);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!file) return;
    const to = mail.to.trim();
    if (!to) return setError("Vyplň, komu nabídka půjde.");
    const bad = invalidAddress(to) ?? invalidAddress(mail.cc);
    if (bad) return setError(`Neplatná e-mailová adresa: ${bad}`);
    if (!mail.subject.trim()) return setError("Doplň předmět e-mailu.");
    setStep("sending");
    setError(null);
    try {
      const res = await sendJobDocument(jobId, file.id, {
        to, cc: mail.cc.trim() || undefined, subject: mail.subject.trim(), body: mail.body,
      });
      if (!res.ok) {
        setError(res.error ?? "E-mail se nepodařilo odeslat.");
        setStep("form");
        return;
      }
      // stav nabídky „odesláno" a posun zakázky dělá sendJobDocument (PDF nese quote_id)
      notify("success", `Nabídka ${quote.number} odeslána na ${to}.`);
      onOpenChange(false);
      refresh();
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
      setStep("form");
    }
  }

  const busy = step !== "form";

  return (
    <Dialog open={open} onOpenChange={(o) => step !== "sending" && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className="top-[4%] max-h-[92vh] w-[calc(100%-1rem)] overflow-y-auto sm:top-[8%] sm:max-w-2xl">
        <DialogHead
          icon={Send}
          tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
          title={`Odeslat nabídku ${quote.number} zákazníkovi`}
          subtitle="Zkontroluj adresu a text — e-mail odejde z tvé schránky s PDF v příloze."
        />
        <form onSubmit={send} className="space-y-4 p-4 sm:p-5" noValidate>
          <ErrorBox error={error} />
          {step === "preparing" ? (
            <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
              Připravuji PDF nabídky a návrh e-mailu…
            </div>
          ) : step === "unpriced" ? (
            <div role="alert" className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              <p className="flex items-start gap-2 font-medium">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden /> {warning}
              </p>
              <p className="text-amber-800/90 dark:text-amber-200/80">
                Položky bez ceny budou mít v nabídce „—“. Ceny doplníš v Nacenění nebo v úpravě nabídky.
              </p>
              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" className="min-h-11 sm:min-h-9" onClick={() => onOpenChange(false)}>Zpět — doplním ceny</Button>
                <Button type="button" variant="default" className="min-h-11 sm:min-h-9" onClick={() => void prepare(true)}>Přesto odeslat</Button>
              </div>
            </div>
          ) : (
            <>
              {file ? (
                <a
                  href={`/api/jobs/files/${file.id}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-2.5 rounded-lg border bg-violet-50 px-3 py-2 text-sm hover:brightness-95 dark:bg-violet-500/10"
                >
                  <Paperclip className="h-4 w-4 text-violet-600" />
                  <FileText className="h-4 w-4 text-violet-600" />
                  <span className="min-w-0 flex-1 truncate font-medium">{file.filename}</span>
                  <span className="inline-flex items-center gap-1 text-xs text-violet-700 dark:text-violet-300">Náhled <ExternalLink className="h-3 w-3" /></span>
                </a>
              ) : (
                <Button type="button" variant="outline" onClick={() => void prepare()}>
                  <RotateCcw className="h-4 w-4" /> Zkusit PDF vytvořit znovu
                </Button>
              )}
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Komu</span>
                  <Input type="email" value={mail.to} onChange={(e) => setMail({ ...mail, to: e.target.value })} placeholder="zakaznik@firma.cz" autoFocus />
                </label>
                <label className="block space-y-1">
                  <span className="text-xs font-medium text-muted-foreground">Kopie (nepovinné)</span>
                  <Input type="email" value={mail.cc} onChange={(e) => setMail({ ...mail, cc: e.target.value })} placeholder="kolega@mnastrojarna.cz" />
                </label>
              </div>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Předmět</span>
                <Input value={mail.subject} onChange={(e) => setMail({ ...mail, subject: e.target.value })} />
              </label>
              <label className="block space-y-1">
                <span className="text-xs font-medium text-muted-foreground">Text e-mailu</span>
                <Textarea rows={9} value={mail.body} onChange={(e) => setMail({ ...mail, body: e.target.value })} />
              </label>
            </>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)} disabled={step === "sending"}>Zrušit</Button>
            <Button type="submit" variant="send" disabled={busy || !file}>
              {step === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              Odeslat zákazníkovi
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
