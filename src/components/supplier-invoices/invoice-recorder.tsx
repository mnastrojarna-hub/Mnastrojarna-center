"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle, Camera, CheckCircle2, ExternalLink, FileText, FileUp, Loader2, Mail, Paperclip, Plus, ReceiptText, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { discardCaptureQuietly, uploadCapturePage } from "@/components/jobs/capture/capture-client";
import { recordEmailAttachmentInvoiceAction } from "@/app/actions/supplier-invoice-record";
import { dateText, formatMoney } from "@/components/supplier-invoices/format";
import type { CaptureFileRef } from "@/lib/jobs/capture-review";
import {
  INVOICE_ACCEPT, ONLY_ONE_FILE, isAcceptedInvoiceFile, rejectTypeMessage, recordResultMessage, type RecordInvoiceResult,
} from "@/lib/supplier-invoices/record-types";
import { cn } from "@/lib/utils";

/** Příloha e-mailu nabídnutá k zapsání (Pošta → Zapsat fakturu dodavatele). */
export interface RecorderEmailSource {
  emailId: string;
  subject: string | null;
  from: string | null;
  attachments: { id: string; filename: string; mimeType: string | null; size: number | null; usable: boolean }[];
  preselectedId: string | null;
}

type Outcome = Exclude<RecordInvoiceResult, { ok: false }> & { message?: string };
type Busy = null | "upload" | "read";

const FMT = { money: (n: number, c: string) => formatMoney(n, c), date: (d: string) => dateText(d) };

function sizeText(n: number | null | undefined): string {
  if (!n) return "";
  return n > 1024 * 1024 ? `${(n / 1024 / 1024).toLocaleString("cs-CZ", { maximumFractionDigits: 1 })} MB` : `${Math.max(1, Math.round(n / 1024))} kB`;
}

/**
 * „Zanést fakturu" (31. 10.): jeden účetní doklad (PDF / fotka) → AI přečte vše a fakturu zapíše →
 * potvrzení s hlavičkou. Bez formuláře; duplicitu a „tohle není faktura" řekne hned. Z Pošty s přílohou
 * e-mailu předvybranou (jedno ťuknutí). Mobil: Vyfotit / Nahrát soubor.
 */
export function InvoiceRecorder({ email, canOpen }: { email?: RecorderEmailSource | null; canOpen: boolean }) {
  const usable = React.useMemo(() => (email?.attachments ?? []).filter((a) => a.usable), [email]);
  const [mode, setMode] = React.useState<"email" | "file">(usable.length ? "email" : "file");
  const [attId, setAttId] = React.useState<string | null>(email?.preselectedId ?? usable[0]?.id ?? null);
  const [file, setFile] = React.useState<{ file: File; url: string | null } | null>(null);
  const [ref, setRef] = React.useState<CaptureFileRef | null>(null);
  const [busy, setBusy] = React.useState<Busy>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [outcome, setOutcome] = React.useState<Outcome | null>(null);
  const [drag, setDrag] = React.useState(false);
  const camera = React.useRef<HTMLInputElement>(null);
  const picker = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => () => { if (file?.url) URL.revokeObjectURL(file.url); }, [file]);

  const choose = (list: FileList | File[] | null) => {
    const files = list ? [...list] : [];
    if (!files.length) return;
    setError(null);
    setOutcome(null);
    if (files.length > 1) { setError(ONLY_ONE_FILE); return; }
    const f = files[0];
    if (!isAcceptedInvoiceFile(f)) { setError(rejectTypeMessage(f.name)); return; }
    if (ref) discardCaptureQuietly({ paths: [ref.path] });
    setRef(null);
    setFile({ file: f, url: f.type.startsWith("image/") && !/hei[cf]/i.test(f.type) ? URL.createObjectURL(f) : null });
  };

  const reset = () => {
    setFile(null); setRef(null); setOutcome(null); setError(null); setBusy(null);
  };

  const finish = (j: Record<string, unknown>) => {
    if (!j.ok) { setError(typeof j.error === "string" ? j.error : "Zapsání se nepodařilo."); return; }
    setOutcome(j as unknown as Outcome);
  };

  const submitFile = async (force = false) => {
    if (!file || busy) return;
    setError(null);
    let r = ref;
    if (!r) {
      setBusy("upload");
      // faktura se neanonymizuje → bez masteru v plném rozlišení (mobilní data)
      const up = await uploadCapturePage(file.file, { sortPreview: false, master: false });
      if (!up.ok) { setBusy(null); setError(up.error); return; }
      r = up.ref;
      setRef(r);
    }
    setBusy("read");
    try {
      const res = await fetch("/api/supplier-invoices/upload", {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ files: [r], force }),
      });
      const j = (await res.json().catch(() => ({}))) as Record<string, unknown>;
      // soubor v capture/ server smazal (kromě „není faktura" — ten čeká na rozhodnutí)
      if (!(j.ok && j.kind === "not_invoice")) setRef(null);
      finish(j);
    } catch {
      setError("Spojení selhalo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };

  const submitEmail = async (force = false) => {
    if (!email || !attId || busy) return;
    setError(null);
    setBusy("read");
    try {
      finish((await recordEmailAttachmentInvoiceAction(email.emailId, attId, force)) as unknown as Record<string, unknown>);
    } catch {
      setError("Spojení selhalo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  };

  const cancelNotInvoice = () => {
    if (ref) discardCaptureQuietly({ paths: [ref.path] });
    reset();
  };

  const again = () => {
    reset();
    if (mode === "email") setMode("file");
  };

  // ── Výsledek ──
  if (outcome && outcome.kind !== "not_invoice") {
    const recorded = outcome.kind === "recorded";
    const head = outcome.head;
    const id = outcome.id ?? null;
    const message = outcome.message ?? recordResultMessage(outcome, FMT);
    // titulek: „Faktura zapsána ✓" (údaje v přehledu pod ním), bez AI / duplicita = celá věta
    const title = recorded && outcome.aiFilled ? "Faktura zapsána ✓" : message;
    return (
      <div
        className={cn(
          "space-y-4 rounded-2xl border p-5 sm:p-6",
          recorded ? "border-emerald-200 bg-emerald-50 dark:border-emerald-500/30 dark:bg-emerald-500/10" : "border-amber-200 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10",
        )}
        data-testid="invoice-upload-done" data-kind={outcome.kind} role="status"
      >
        <div className="flex items-start gap-3">
          {recorded ? <CheckCircle2 className="h-10 w-10 shrink-0 text-emerald-600" aria-hidden /> : <AlertTriangle className="h-10 w-10 shrink-0 text-amber-600" aria-hidden />}
          <div className="min-w-0">
            <p className="break-words text-lg font-semibold leading-tight" data-testid="invoice-upload-message">{title}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {!recorded ? "Nic nového se nezapsalo." : outcome.aiFilled ? "AI přečetla celou fakturu a zapsala ji do systému." : "Doklad je uložený, údaje z něj doplní účetní."}
            </p>
            <span className="sr-only">{message}</span>
          </div>
        </div>
        {head && (recorded ? outcome.aiFilled : true) && (
          <dl className="grid grid-cols-1 gap-x-4 gap-y-2 rounded-xl bg-background/70 p-3 text-sm sm:grid-cols-2" data-testid="invoice-upload-head">
            <Field label="Dodavatel" value={head.supplierName} />
            <Field label="Číslo faktury" value={head.number} />
            <Field label="Částka" value={head.amount !== null ? formatMoney(head.amount, head.currency) : null} strong />
            <Field label="Splatnost" value={head.dueDate ? dateText(head.dueDate) : null} />
          </dl>
        )}
        <div className="flex flex-col gap-2 sm:flex-row">
          <Button size="lg" variant="success" className="h-12 flex-1 text-base" onClick={again} data-testid="invoice-upload-again">
            <Plus /> Zanést další
          </Button>
          {canOpen && id && (
            <Button asChild size="lg" variant="outline" className="h-12"><Link href={`/supplier-invoices/${id}`}><ExternalLink /> Otevřít fakturu</Link></Button>
          )}
        </div>
      </div>
    );
  }

  const notInvoice = outcome?.kind === "not_invoice" ? outcome : null;
  const busyText = busy === "upload" ? "Nahrávám…" : "AI čte fakturu…";

  return (
    <div className="space-y-3" data-testid="invoice-uploader">
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { choose(e.target.files); e.target.value = ""; }} data-testid="invoice-camera-input" />
      <input ref={picker} type="file" accept={INVOICE_ACCEPT} className="hidden" onChange={(e) => { choose(e.target.files); e.target.value = ""; }} data-testid="invoice-file-input" />

      {notInvoice ? (
        <div className="space-y-3 rounded-2xl border border-amber-300 bg-amber-50 p-5 dark:border-amber-500/40 dark:bg-amber-500/10" data-testid="invoice-not-invoice" role="alert">
          <div className="flex items-start gap-3">
            <AlertTriangle className="h-8 w-8 shrink-0 text-amber-600" aria-hidden />
            <div className="min-w-0">
              <p className="text-base font-semibold">Tohle nevypadá jako faktura</p>
              <p className="mt-1 text-sm text-muted-foreground">
                AI v dokladu vidí <b className="text-foreground">{notInvoice.label}</b>
                {notInvoice.head?.supplierName ? ` od ${notInvoice.head.supplierName}` : ""}{notInvoice.head?.number ? ` (č. ${notInvoice.head.number})` : ""}.
                Zanést se má jen samotná faktura (účetní doklad).
              </p>
            </div>
          </div>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="lg" variant="outline" className="h-12 flex-1" disabled={Boolean(busy)}
              onClick={() => void (mode === "email" ? submitEmail(true) : submitFile(true))} data-testid="invoice-force">
              {busy ? <Loader2 className="animate-spin" /> : <ReceiptText />} {busy ? busyText : "Přesto zapsat jako fakturu"}
            </Button>
            <Button size="lg" variant="ghost" className="h-12" disabled={Boolean(busy)} onClick={cancelNotInvoice} data-testid="invoice-force-cancel">
              <X /> Zrušit
            </Button>
          </div>
        </div>
      ) : mode === "email" && email ? (
        <div className="space-y-3 rounded-2xl border bg-card p-4" data-testid="invoice-email-source">
          <div className="flex items-start gap-2 text-sm">
            <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <div className="min-w-0">
              <p className="truncate font-medium">{email.subject || "(bez předmětu)"}</p>
              {email.from && <p className="truncate text-xs text-muted-foreground">{email.from}</p>}
            </div>
          </div>
          <fieldset className="min-w-0 space-y-2">
            <legend className="mb-1 text-xs font-medium uppercase tracking-wide text-muted-foreground">Která příloha je faktura?</legend>
            {usable.map((a) => (
              <label key={a.id} className={cn(
                "flex min-h-12 cursor-pointer items-center gap-3 rounded-xl border px-3 py-2 transition",
                attId === a.id ? "border-emerald-400 bg-emerald-50 dark:border-emerald-500/50 dark:bg-emerald-500/10" : "hover:bg-accent",
              )} data-testid="invoice-email-attachment">
                <input type="radio" name="invoice-attachment" className="h-4 w-4 accent-emerald-600" checked={attId === a.id} onChange={() => setAttId(a.id)} />
                {/pdf/i.test(a.mimeType ?? a.filename) ? <FileText className="h-5 w-5 shrink-0 text-rose-600" aria-hidden /> : <Paperclip className="h-5 w-5 shrink-0 text-muted-foreground" aria-hidden />}
                <span className="min-w-0 flex-1 truncate text-sm font-medium">{a.filename}</span>
                <span className="shrink-0 text-xs text-muted-foreground">{sizeText(a.size)}</span>
              </label>
            ))}
          </fieldset>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button size="lg" variant="success" className="h-12 flex-1 text-base" disabled={!attId || Boolean(busy)} onClick={() => void submitEmail()} data-testid="invoice-email-submit">
              {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {busy ? busyText : "Zanést fakturu"}
            </Button>
            <Button size="lg" variant="ghost" className="h-12" disabled={Boolean(busy)} onClick={() => setMode("file")}>
              <FileUp /> Jiný soubor
            </Button>
          </div>
        </div>
      ) : !file ? (
        <div
          className={cn("grid grid-cols-1 gap-3 rounded-2xl sm:grid-cols-2", drag && "ring-2 ring-emerald-400 ring-offset-2 ring-offset-background")}
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); choose(e.dataTransfer.files); }}
        >
          <button type="button" onClick={() => camera.current?.click()} className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-rose-300 bg-rose-50 p-5 text-rose-800 transition hover:bg-rose-100 dark:border-rose-500/40 dark:bg-rose-500/10 dark:text-rose-200">
            <Camera className="h-9 w-9" /> <span className="text-base font-semibold">Vyfotit fakturu</span>
            <span className="text-xs opacity-80">jedna fotka = jedna faktura</span>
          </button>
          <button type="button" onClick={() => picker.current?.click()} className="flex min-h-36 flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-emerald-300 bg-emerald-50 p-5 text-emerald-800 transition hover:bg-emerald-100 dark:border-emerald-500/40 dark:bg-emerald-500/10 dark:text-emerald-200">
            <FileUp className="h-9 w-9" /> <span className="text-base font-semibold">Nahrát soubor</span>
            <span className="text-xs opacity-80">PDF nebo obrázek faktury · sem ho můžeš i přetáhnout</span>
          </button>
          {email && usable.length > 0 && (
            <Button variant="ghost" className="sm:col-span-2" onClick={() => setMode("email")}><Mail /> Zpět na přílohu e-mailu</Button>
          )}
        </div>
      ) : (
        <div className="space-y-3 rounded-2xl border bg-card p-4" data-testid="invoice-selected">
          <div className="flex items-center gap-3">
            {file.url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={file.url} alt="" className="h-16 w-16 shrink-0 rounded-lg border object-cover" />
            ) : (
              <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-lg border bg-muted/50"><ReceiptText className="h-7 w-7 text-muted-foreground" /></span>
            )}
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium">{file.file.name || "faktura"}</p>
              <p className="text-xs text-muted-foreground">{sizeText(file.file.size)}</p>
            </div>
            <Button variant="ghost" size="icon" aria-label="Vybrat jiný soubor" disabled={Boolean(busy)} onClick={reset}><X /></Button>
          </div>
          <Button size="lg" variant="success" className="h-12 w-full text-base" disabled={Boolean(busy)} onClick={() => void submitFile()} data-testid="invoice-upload-submit">
            {busy ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} {busy ? busyText : "Zanést fakturu"}
          </Button>
          {busy === "read" && <p className="text-center text-xs text-muted-foreground">AI čte dodavatele, částky, splatnost a položky — chvilku to trvá.</p>}
        </div>
      )}
      {error && <p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200" role="alert" data-testid="invoice-upload-error">{error}</p>}
    </div>
  );
}

function Field({ label, value, strong }: { label: string; value: string | null; strong?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className={cn("truncate", strong ? "text-base font-semibold" : "font-medium")}>{value ?? "—"}</dd>
    </div>
  );
}
