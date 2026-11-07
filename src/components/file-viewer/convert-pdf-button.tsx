"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, FileDown, Loader2, X } from "lucide-react";
import { convertDrawingToPdf } from "./convert-pdf";
import { openFileViewer } from "./viewer-bus";

/**
 * Hlavička prohlížeče u výkresu DXF / DWG zakázky: „Převést na PDF" → server vytvoří PDF (nový dokument
 * zakázky) a prohlížeč ho rovnou otevře; stránka pod prohlížečem se obnoví (nový řádek v Dokumentech).
 */
export function ConvertPdfButton({ fileId }: { fileId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);

  async function run() {
    if (busy) return;
    setBusy(true);
    setError(null);
    const r = await convertDrawingToPdf(fileId);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return;
    }
    router.refresh();
    openFileViewer({ href: `/api/jobs/files/${r.file.id}`, filename: r.file.filename });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => void run()}
        disabled={busy}
        className="inline-flex h-11 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-sm font-medium hover:bg-accent disabled:opacity-60 sm:px-3"
        title="Převést výkres na PDF (uloží se k zakázce jako nový dokument)"
        aria-label="Převést na PDF"
        data-testid="viewer-convert-pdf"
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileDown className="h-4 w-4" />}
        <span className="hidden sm:inline">{busy ? "Převádím…" : "Převést na PDF"}</span>
        <span className="sm:hidden">PDF</span>
      </button>
      {error && (
        <div
          role="alert"
          className="fixed inset-x-3 top-16 z-[70] mx-auto flex max-w-lg items-start gap-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 shadow-lg dark:border-amber-500/40 dark:bg-amber-950 dark:text-amber-100"
          data-testid="viewer-convert-pdf-error"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span className="min-w-0 flex-1">{error}</span>
          <button type="button" onClick={() => setError(null)} aria-label="Zavřít" className="rounded p-0.5 hover:bg-amber-100 dark:hover:bg-amber-900"><X className="h-4 w-4" /></button>
        </div>
      )}
    </>
  );
}
