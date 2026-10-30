"use client";

import * as React from "react";
import { AlertTriangle, Eye, ExternalLink, Loader2, Paperclip, RotateCcw, Save, Send } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import {
  draftInvoiceEmail, draftJobDocumentEmail, generateJobDocument, sendJobDocument, type JobDocumentKind,
} from "@/app/actions/job-documents";
import { INVOICE_NUMBER_PLACEHOLDER, fillInvoicePlaceholders, parseEmailList } from "@/lib/jobs/document-emails";

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
 * issueOnSend (faktura): otevření ani „Zrušit" nic nevystaví — nejdřív návrh e-mailu a náhled bez
 * uložení, doklad (číslo, PDF, posun stavu) vznikne až tlačítkem „Vystavit a odeslat" / „Vystavit,
 * neposílat". Vystavená faktura (fileId / server ji najde) se jen pošle znovu.
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
  subtitle,
  onSent,
  onPrepared,
  saveOnly,
  issueOnSend,
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
  /** Podnadpis místo výchozího „Zkontroluj adresu a text…". */
  subtitle?: string;
  onSent?: (info: { to: string }) => void;
  /** PDF je hotové (vystavené / znovu použité) — číslo dokladu pro zpětnou vazbu (faktura posune stav). */
  onPrepared?: (info: { fileId: string; filename: string; number: string | null; existing: boolean }) => void;
  /** Volba „Jen uložit, neposílat" (doklad zůstane v Dokumentech zakázky, e-mail neodejde). */
  saveOnly?: { label?: string; onSaved: (info: { fileId: string; filename: string }) => void };
  /** Faktura: vystavit až tlačítkem (ne při otevření). */
  issueOnSend?: boolean;
}) {
  const deferred = Boolean(issueOnSend) && kind === "faktura" && !givenFileId;
  const [step, setStep] = React.useState<Step>("preparing");
  const [error, setError] = React.useState<string | null>(null);
  const [warning, setWarning] = React.useState<string | null>(null);
  const [file, setFile] = React.useState<{ id: string; filename: string } | null>(null);
  /** Doklad vznikne až odesláním (název přílohy předem) — jen issueOnSend. */
  const [pending, setPending] = React.useState<{ filename: string; force: boolean } | null>(null);
  const [blocked, setBlocked] = React.useState(false);
  const [mail, setMail] = React.useState<MailDraft>({ to: "", cc: "", subject: "", body: "" });
  const run = React.useRef(0);
  const onPreparedRef = React.useRef(onPrepared);
  onPreparedRef.current = onPrepared;

  const prepare = React.useCallback(async (force = false) => {
    const token = ++run.current;
    setStep("preparing");
    setError(null);
    try {
      if (deferred) {
        // jen návrh e-mailu + kontrola, že fakturu jde vystavit — nic se nevystaví
        const d = await draftInvoiceEmail(jobId);
        if (token !== run.current) return;
        if (!d.ok) {
          setBlocked(d.code === "rights" || d.code === "delivery" || d.code === "invoiced");
          setError(d.error ?? "Fakturu teď nejde vystavit.");
          setStep("form");
          return;
        }
        if (d.existing) {
          // mezitím vystavená (jiná záložka, kolega) → jen poslat znovu, nic nového nevzniká
          setFile({ id: d.existing.fileId, filename: d.existing.filename });
          onPreparedRef.current?.({ fileId: d.existing.fileId, filename: d.existing.filename, number: d.existing.number, existing: true });
        } else {
          if ((d.unpriced ?? 0) > 0 && !force) {
            setWarning(`${d.unpriced} ${d.unpriced === 1 ? "položka nemá" : d.unpriced! < 5 ? "položky nemají" : "položek nemá"} cenu — doplň ceny v kartě zakázky (záložka Položky), nebo fakturu přesto vystav.`);
            setStep("unpriced");
            return;
          }
          setPending({ filename: d.filename ?? "Faktura.pdf", force });
        }
        setMail((m) => ({ to: d.to || m.to, cc: m.cc, subject: d.subject ?? m.subject, body: d.body ?? m.body }));
        setStep("form");
        return;
      }
      let f = givenFileId ? { id: givenFileId, filename: givenFilename ?? "doklad.pdf" } : null;
      let number: string | null = null;
      let existing = Boolean(givenFileId);
      if (!f) {
        const gen = await generateJobDocument(jobId, kind, { ...(quoteId ? { quoteId } : {}), ...(force ? { force: true } : {}), reuse: true });
        if (token !== run.current) return;
        if (!gen.ok || !gen.fileId) {
          if (gen.unpriced) {
            setWarning(gen.error ?? "Některé položky nemají cenu.");
            setStep("unpriced");
            return;
          }
          // #25: neschválená nabídka / bez práva / DL bez dodání — znovu to zkoušet nemá smysl, jen vysvětlit
          setBlocked(gen.code === "approval" || gen.code === "rights" || gen.code === "delivery" || gen.code === "invoiced");
          setError(gen.error ?? "PDF se nepodařilo vytvořit.");
          setStep("form");
          return;
        }
        f = { id: gen.fileId, filename: gen.filename ?? "doklad.pdf" };
        number = gen.number ?? null;
        existing = Boolean(gen.existing);
      }
      setFile(f);
      onPreparedRef.current?.({ fileId: f.id, filename: f.filename, number, existing });
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
  }, [jobId, kind, quoteId, givenFileId, givenFilename, deferred]);

  const [wasOpen, setWasOpen] = React.useState(false);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setFile(null);
      setPending(null);
      setWarning(null);
      setError(null);
      setBlocked(false);
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

  /** issueOnSend: vystaví doklad teď (číslo, PDF, stav) → soubor + e-mail s přiděleným číslem. */
  async function issueNow(draft: MailDraft): Promise<{ file: { id: string; filename: string }; mail: MailDraft } | null> {
    const gen = await generateJobDocument(jobId, kind, { ...(pending?.force ? { force: true } : {}), reuse: true });
    if (!gen.ok || !gen.fileId) {
      if (gen.code === "delivery" || gen.code === "invoiced" || gen.code === "rights") setBlocked(true);
      setError(gen.error ?? "Fakturu se nepodařilo vystavit.");
      return null;
    }
    const f = { id: gen.fileId, filename: gen.filename ?? "doklad.pdf" };
    const filled: MailDraft = {
      ...draft,
      subject: fillInvoicePlaceholders(draft.subject, gen.number),
      body: fillInvoicePlaceholders(draft.body, gen.number),
    };
    setFile(f);
    setPending(null);
    setMail(filled);
    onPreparedRef.current?.({ fileId: f.id, filename: f.filename, number: gen.number ?? null, existing: Boolean(gen.existing) });
    return { file: f, mail: filled };
  }

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if ((!file && !pending) || step !== "form") return;
    const bad = mailDraftError(mail);
    if (bad) return setError(bad);
    setStep("sending");
    setError(null);
    try {
      let target = file;
      let out = mail;
      if (!target) {
        const issued = await issueNow(mail);
        if (!issued) {
          setStep("form");
          return;
        }
        target = issued.file;
        out = issued.mail;
      }
      const res = await sendJobDocument(jobId, target.id, {
        to: out.to.trim(), cc: out.cc.trim() || undefined, subject: out.subject.trim(), body: out.body,
      });
      if (!res.ok) {
        setError(res.error ?? "E-mail se nepodařilo odeslat.");
        setStep("form");
        return;
      }
      onSent?.({ to: out.to.trim() });
      onOpenChange(false);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
      setStep("form");
    }
  }

  async function saveOnlyNow() {
    if (!saveOnly || step !== "form") return;
    let target = file;
    if (!target) {
      setStep("sending");
      setError(null);
      try {
        const issued = await issueNow(mail);
        if (!issued) {
          setStep("form");
          return;
        }
        target = issued.file;
      } catch {
        setError("Spojení se nepovedlo — zkus to znovu.");
        setStep("form");
        return;
      }
    }
    saveOnly.onSaved({ fileId: target.id, filename: target.filename });
    onOpenChange(false);
  }

  const text = KIND_TEXT[kind];
  const hasPlaceholder = pending !== null && (mail.subject.includes(INVOICE_NUMBER_PLACEHOLDER) || mail.body.includes(INVOICE_NUMBER_PLACEHOLDER));

  return (
    <Dialog open={open} onOpenChange={(o) => step !== "sending" && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className="top-[3%] max-h-[94vh] w-[calc(100%-1rem)] overflow-y-auto sm:top-[6%] sm:max-w-2xl">
        <DialogHead
          icon={Send}
          tone="bg-red-100 text-red-600 dark:bg-red-500/15 dark:text-red-400"
          title={title}
          subtitle={subtitle ?? "Zkontroluj adresu a text — e-mail odejde z tvé schránky s PDF v příloze."}
        />
        <form onSubmit={send} className="space-y-4 p-4 sm:p-5" noValidate>
          <ErrorBox error={error} />
          {step === "preparing" && (
            <div className="flex flex-col items-center gap-3 py-10 text-center text-sm text-muted-foreground">
              <Loader2 className="h-6 w-6 animate-spin text-violet-500" />
              {deferred ? "Připravuji návrh e-mailu…" : text.preparing}
            </div>
          )}
          {step === "unpriced" && (
            <div className="space-y-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
              <p className="flex items-start gap-2 font-medium">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" /> {warning}
              </p>
              <p className="text-amber-800/90 dark:text-amber-200/80">
                {kind === "nabidka"
                  ? "Položky bez ceny budou mít v dokladu „—“. Ceny doplníš v úpravě nabídky (karta zakázky → Nabídky)."
                  : "Položky bez ceny budou mít v dokladu „—“. Ceny doplníš v kartě zakázky (záložka Položky)."}
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
              ) : pending ? (
                // doklad ještě neexistuje: příloha vznikne při vystavení, náhled bez uložení
                <div className="flex flex-wrap items-center gap-2.5 rounded-lg border border-dashed bg-violet-50/60 px-3 py-2 text-sm dark:bg-violet-500/5" data-testid="send-pending-attachment">
                  <Paperclip className="h-4 w-4 shrink-0 text-violet-600 dark:text-violet-400" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-medium">PDF faktury s QR platbou</span>
                    <span className="block text-xs text-muted-foreground">vznikne a přiloží se při vystavení — číslo přidělí řada faktur</span>
                  </span>
                  <a
                    href={`/api/pdf/job/${jobId}?type=faktura`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-violet-700 hover:underline dark:text-violet-300"
                  >
                    <Eye className="h-3.5 w-3.5" /> Náhled bez uložení
                  </a>
                </div>
              ) : blocked ? null : (
                <Button type="button" variant="outline" onClick={() => void prepare()}>
                  <RotateCcw className="h-4 w-4" /> Zkusit PDF vytvořit znovu
                </Button>
              )}
              {!blocked && <MailFields mail={mail} onChange={setMail} disabled={step === "sending"} />}
              {hasPlaceholder && (
                <p className="text-[11px] text-muted-foreground">„{INVOICE_NUMBER_PLACEHOLDER}“ se při vystavení nahradí přiděleným číslem faktury.</p>
              )}
            </>
          )}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className="h-11 sm:h-10" onClick={() => onOpenChange(false)} disabled={step === "sending"}>Zrušit</Button>
            {/* faktura: „Vystavit, neposílat" jen před vystavením (vystavenou zavře i Zrušit) */}
            {saveOnly && (pending || (file && !deferred)) && !blocked && (
              <Button
                type="button"
                variant="outline"
                className="h-11 sm:h-10"
                disabled={step !== "form"}
                onClick={() => void saveOnlyNow()}
              >
                <Save className="h-4 w-4" /> {saveOnly.label ?? "Jen uložit, neposílat"}
              </Button>
            )}
            <Button type="submit" variant="send" className="h-11 sm:h-10" disabled={step !== "form" || (!file && !pending) || blocked}>
              {step === "sending" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {deferred && !file ? "Vystavit a odeslat" : `Odeslat ${text.what}`}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
