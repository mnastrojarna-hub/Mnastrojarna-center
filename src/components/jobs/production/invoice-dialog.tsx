"use client";

import * as React from "react";
import { Check, FileSignature, Loader2 } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DialogHead, ErrorBox } from "@/components/jobs/detail/confirm-dialog";
import { DocumentSendDialog } from "@/components/flow/document-send-dialog";
import { setInvoiceInfo } from "@/app/actions/production";
import { todayInPrague } from "@/components/jobs/book/book-params";
import { czDay, dueDateFor, DEFAULT_PAYMENT_TERMS } from "@/lib/jobs/production";

export { ownInvoiceFile } from "@/lib/jobs/invoice-file";

/**
 * „Vystavit fakturu" — JEDINÁ cesta k faktuře zákazníkovi (hlavní tlačítko, ⋯, Doklady ▾, odkaz ?akce=):
 * tentýž dialog odeslání jako u nabídky (předvyplněný e-mail, náhled bez uložení). Otevření ani
 * „Zrušit" nic nevystaví — číslo z řady FV, PDF s QR platbou, evidence faktur a posun na Vyfakturováno
 * vzniknou až tlačítkem „Vystavit a odeslat" nebo „Vystavit, neposílat".
 * existing = faktura už je vystavená → jen poslat znovu (stejné PDF, nic nového nevzniká).
 */
export function InvoiceDialog({
  open, onOpenChange, jobId, existing, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  existing?: { fileId: string; filename: string; number: string | null } | null;
  /** Zpětná vazba + obnovení karty (vystaveno / odesláno). */
  onDone: (message: string) => void;
}) {
  /** Faktura vystavená v tomto otevření dialogu (ne dřívější). */
  const issued = React.useRef<{ number: string | null } | null>(null);
  const known = React.useRef<string | null>(existing?.number ?? null);
  const reported = React.useRef(false);
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      issued.current = null;
      known.current = existing?.number ?? null;
      reported.current = false;
    }
  }
  const label = (n: string | null) => (n ? `Faktura ${n}` : "Faktura");
  const report = (message: string) => {
    if (reported.current) return;
    reported.current = true;
    onDone(message);
  };

  return (
    <DocumentSendDialog
      open={open}
      onOpenChange={(o) => {
        // vystaveno, ale neodesláno (chyba odeslání, zavřeno): oznámit a obnovit kartu; jinak nic nevzniklo
        if (!o && issued.current) report(`${label(issued.current.number)} je vystavená a uložená v Dokumentech — poslat ji můžeš i později (Doklady ▾).`);
        onOpenChange(o);
      }}
      jobId={jobId}
      kind="faktura"
      fileId={existing?.fileId}
      filename={existing?.filename}
      issueOnSend={!existing}
      title={existing ? `Poslat fakturu ${existing.number ?? ""} zákazníkovi`.replace(/\s+/g, " ") : "Vystavit fakturu a poslat zákazníkovi"}
      subtitle={existing
        ? "Pošle se stejné PDF faktury — nic nového nevzniká."
        : "Zkontroluj adresu a text. Faktura (číslo, PDF s QR platbou) vznikne až tlačítkem — „Zrušit“ nic nevystaví."}
      onPrepared={({ number, existing: was }) => {
        known.current = number ?? known.current;
        if (!was) issued.current = { number };
      }}
      saveOnly={existing ? undefined : {
        label: "Vystavit, neposílat",
        onSaved: () => report(`${label(issued.current?.number ?? known.current)} je vystavená a uložená v Dokumentech zakázky.`),
      }}
      onSent={({ to }) => report(`${label(issued.current?.number ?? known.current)} odeslána na ${to}.`)}
    />
  );
}

/**
 * Údaje faktury bez PDF z aplikace: „Faktura vystavená mimo systém…" (číslo, datum, splatnost — zapíše
 * se i do evidence faktur) a „Upravit splatnost" u už vystavené faktury (číslo jen ke čtení).
 */
export function InvoiceInfoDialog({
  open, onOpenChange, jobId, mode, current, terms, onDone,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  jobId: string;
  mode: "external" | "due";
  current?: { number: string | null; date: string | null; due: string | null } | null;
  /** Splatnost zákazníka ve dnech (null = výchozí). */
  terms: number | null;
  onDone: (message: string) => void;
}) {
  const [number, setNumber] = React.useState(current?.number ?? "");
  const [date, setDate] = React.useState(current?.date ?? todayInPrague());
  const [due, setDue] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const ids = { n: React.useId(), d: React.useId(), due: React.useId() };
  const [wasOpen, setWasOpen] = React.useState(open);
  if (open !== wasOpen) {
    setWasOpen(open);
    if (open) {
      setNumber(current?.number ?? "");
      setDate(current?.date ?? todayInPrague());
      setDue(null);
      setError(null);
    }
  }
  const autoDue = date ? (current?.due && date === current?.date ? current.due : dueDateFor(date, terms)) : "";
  const shownDue = due ?? autoDue;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (mode === "external" && !number.trim()) return setError("Zadej číslo faktury.");
    if (!date) return setError("Zadej datum faktury.");
    if (shownDue && shownDue < date) return setError("Splatnost je před datem faktury.");
    setBusy(true);
    setError(null);
    try {
      const res = await setInvoiceInfo(jobId, {
        ...(mode === "external" ? { invoiceNumber: number.trim() } : {}),
        invoiceDate: date,
        ...(due !== null ? { invoiceDueDate: due || null } : {}),
      });
      if (!res.ok) return setError(res.error ?? "Fakturu se nepodařilo uložit.");
      onDone(mode === "external"
        ? `Faktura ${number.trim()} zapsaná${res.invoiceDueDate ? ` — splatná ${czDay(res.invoiceDueDate)}` : ""}.`
        : `Splatnost faktury: ${res.invoiceDueDate ? czDay(res.invoiceDueDate) : "—"}.`);
      onOpenChange(false);
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <DialogContent aria-describedby={undefined} className="top-[3%] w-[calc(100%-1rem)] sm:top-[12%] sm:max-w-md">
        <DialogHead
          icon={FileSignature}
          tone="bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300"
          title={mode === "external" ? "Faktura vystavená mimo systém" : `Upravit splatnost${current?.number ? ` — ${current.number}` : ""}`}
          subtitle={mode === "external"
            ? "Fakturu jsi vystavil jinde (účetní program, ručně). Zapíše se číslo a splatnost — PDF z aplikace nevznikne."
            : "Změna data nebo splatnosti vystavené faktury (hlídání „po splatnosti“)."}
        />
        <form onSubmit={submit} className="space-y-3 p-4 sm:p-5">
          <ErrorBox error={error} />
          <div className="grid gap-3 min-[420px]:grid-cols-2">
            {mode === "external" && (
              <div className="min-w-0 min-[420px]:col-span-2">
                <label htmlFor={ids.n} className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Číslo faktury</label>
                <Input id={ids.n} value={number} maxLength={120} onChange={(e) => setNumber(e.target.value)} placeholder="např. 2026-0142" className="h-11 font-mono sm:h-10" autoFocus />
              </div>
            )}
            <div className="min-w-0">
              <label htmlFor={ids.d} className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Vystavena</label>
              <Input id={ids.d} type="date" value={date} onChange={(e) => setDate(e.target.value)} className="h-11 sm:h-10" />
            </div>
            <div className="min-w-0">
              <label htmlFor={ids.due} className="mb-0.5 block text-[11px] font-medium text-muted-foreground">Splatná</label>
              <Input id={ids.due} type="date" value={shownDue} onChange={(e) => setDue(e.target.value)} className="h-11 sm:h-10" />
            </div>
          </div>
          <p className="text-[11px] text-muted-foreground">
            {due === null
              ? `Splatnost se dopočítá: ${terms ?? DEFAULT_PAYMENT_TERMS} dní${terms !== null ? " dle zákazníka" : " (výchozí)"}.`
              : "Splatnost zadaná ručně."}
          </p>
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={() => onOpenChange(false)} disabled={busy}>Zpět</Button>
            <Button type="submit" variant="success" className="h-11 sm:h-9" disabled={busy}>
              {busy ? <Loader2 className="animate-spin" /> : <Check />} {mode === "external" ? "Zapsat fakturu" : "Uložit splatnost"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
