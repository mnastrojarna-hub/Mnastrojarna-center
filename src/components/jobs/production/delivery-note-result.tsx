"use client";

import * as React from "react";
import { CheckCircle2, Download, Loader2, Printer, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { DocumentSendDialog } from "@/components/flow/document-send-dialog";
import { printDocument } from "@/components/print/print-action";
import { cn } from "@/lib/utils";

export interface IssuedNote {
  number: string;
  fileId: string;
  filename: string;
  label?: string | null;
  /** Dodávka dodala vše (zakázka se posune na Dodáno zákazníkovi). */
  final?: boolean;
}

/** Odkaz na stažení PDF dokumentu zakázky pod jeho názvem. */
export function noteDownloadHref(fileId: string): string {
  return `/api/jobs/files/${fileId}?download=1`;
}

/**
 * Vytiskne PDF dokumentu zakázky — tisková stránka (strany jako obrázky, funguje i na telefonu:
 * AirPrint / tisk Androidu), na počítači bez opuštění stránky. Viz components/print.
 */
export async function printPdf(fileId: string, filename?: string | null): Promise<void> {
  await printDocument({ href: `/api/jobs/files/${fileId}`, filename: filename ?? null });
}

/**
 * Výsledek „Zapsat dodání a dodací list": číslo DL a tři kroky — stáhnout PDF, vytisknout
 * (podpis při předání), poslat zákazníkovi (návrh e-mailu, PDF v příloze, z mé schránky).
 */
export function DeliveryNoteResult({
  jobId, note, onClose, className,
}: {
  jobId: string;
  note: IssuedNote;
  onClose: () => void;
  className?: string;
}) {
  const [sending, setSending] = React.useState(false);
  const [sentTo, setSentTo] = React.useState<string | null>(null);
  const [printing, setPrinting] = React.useState(false);

  return (
    <div className={cn("space-y-4", className)} data-testid="delivery-note-result">
      <div role="status" className="flex items-start gap-3 rounded-xl border border-green-200 bg-green-50 p-3 text-sm text-green-900 dark:border-green-500/30 dark:bg-green-500/10 dark:text-green-100">
        <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-green-600 dark:text-green-400" />
        <div className="min-w-0 space-y-0.5">
          <p className="font-semibold">
            Dodací list <span className="font-mono">{note.number}</span> je vystavený
            {note.label ? <span className="font-normal"> · {note.label}</span> : null}
          </p>
          <p className="text-green-800/90 dark:text-green-200/80">
            {note.final === false
              ? "Dodání je zapsané — zbytek dodáš dalším dodacím listem."
              : "Dodání je zapsané — vše dodáno."}{" "}
            PDF bez cen je uložené v Dokumentech zakázky.
          </p>
          {sentTo && <p className="font-medium">Odesláno na {sentTo}.</p>}
        </div>
      </div>
      <div className="grid gap-2 sm:grid-cols-3">
        <Button asChild variant="outline" className="h-11 sm:h-10">
          <a href={noteDownloadHref(note.fileId)} download={note.filename}>
            <Download /> Stáhnout PDF
          </a>
        </Button>
        <Button
          type="button" variant="outline" className="h-11 sm:h-10" disabled={printing} data-testid="delivery-note-print"
          onClick={async () => {
            setPrinting(true);
            try { await printPdf(note.fileId, note.filename); } finally { setPrinting(false); }
          }}
        >
          {printing ? <Loader2 className="animate-spin" /> : <Printer />} Vytisknout
        </Button>
        <Button type="button" variant="send" className="h-11 sm:h-10" onClick={() => setSending(true)}>
          <Send /> {sentTo ? "Poslat znovu" : "Poslat zákazníkovi"}
        </Button>
      </div>
      <div className="flex justify-end">
        <Button type="button" variant="ghost" className="h-11 sm:h-9" onClick={onClose}>Hotovo</Button>
      </div>
      <DocumentSendDialog
        open={sending}
        onOpenChange={setSending}
        jobId={jobId}
        kind="dodaci_list"
        fileId={note.fileId}
        filename={note.filename}
        title={`Poslat dodací list ${note.number} zákazníkovi`}
        onSent={({ to }) => {
          setSending(false);
          setSentTo(to);
        }}
      />
    </div>
  );
}
