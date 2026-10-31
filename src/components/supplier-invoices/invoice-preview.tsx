"use client";

import * as React from "react";
import { Download, FileText } from "lucide-react";
import type { SupplierInvoiceFileView } from "@/lib/supplier-invoices/types";
import { cn } from "@/lib/utils";
import { PrintButton } from "@/components/print/print-button";

/** Náhled faktury (fotka / PDF) vedle položek — soubory jdou přes route s kontrolou práv. */
export function InvoicePreview({ files, className, emptyText = "Bez souboru" }: { files: SupplierInvoiceFileView[]; className?: string; emptyText?: string }) {
  const [i, setI] = React.useState(0);
  const f = files[Math.min(i, files.length - 1)];
  if (!f) {
    return <div className={cn("flex items-center justify-center rounded-2xl border border-dashed p-4 text-center text-sm text-muted-foreground", className)}>{emptyText}</div>;
  }
  const pdf = (f.mimeType ?? "").includes("pdf") || /\.pdf$/i.test(f.filename);
  return (
    <div className={cn("flex flex-col overflow-hidden rounded-2xl border bg-muted/30", className)} data-testid="invoice-preview">
      {files.length > 1 && (
        <div className="flex gap-1 overflow-x-auto border-b bg-card p-1">
          {files.map((x, n) => (
            <button key={x.id} type="button" onClick={() => setI(n)} className={cn("shrink-0 rounded-md px-2 py-1 text-xs", n === i ? "bg-emerald-600 text-white" : "hover:bg-accent")}>
              str. {n + 1}
            </button>
          ))}
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {pdf ? (
          <iframe title={f.filename} src={`${f.href}#view=FitH`} className="h-full w-full bg-white" />
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={f.href} alt={f.filename} className="h-full w-full object-contain" />
        )}
      </div>
      <div className="flex items-center gap-2 border-t bg-card px-2.5 py-1.5 text-xs text-muted-foreground">
        <FileText className="h-3.5 w-3.5 shrink-0" />
        <span className="min-w-0 flex-1 truncate">{f.filename}</span>
        <a href={`${f.href}?download=1`} className="inline-flex min-h-8 items-center gap-1 font-medium text-foreground hover:underline"><Download className="h-3.5 w-3.5" /> Stáhnout</a>
        <PrintButton href={f.href} filename={f.filename} label="Tisknout" showLabel className="h-8 px-2 text-xs font-medium text-foreground" />
      </div>
    </div>
  );
}
