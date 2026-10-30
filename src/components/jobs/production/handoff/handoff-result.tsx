"use client";

import * as React from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, FileText, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ensureHandoffDocuments, sendStepPurchaseOrder } from "@/app/actions/production-handoff";
import type { HandoffKind, HandoffResult } from "@/lib/jobs/production-handoff-types";
import type { JobStage } from "@/lib/supabase/database.types";
import { cn } from "@/lib/utils";
import { doneToast } from "./handoff-model";

type PoRow = HandoffResult["purchaseOrders"][number];

/** Jedna objednávka výsledku: „OV-2026-012 · Frézy Novák · PDF ✓ · odesláno z obchod@…". */
export function resultLine(p: PoRow, senderEmail: string | null): string {
  const pdf = p.pdf === "ok" ? "PDF ✓" : "PDF se nepodařilo vytvořit";
  const send = p.send === "odeslano" ? `odesláno${senderEmail ? ` z ${senderEmail}` : ""}`
    : p.send === "ceka_na_schvaleni" ? "čeká na odeslání"
      : `neodesláno${p.sendError ? `: ${p.sendError}` : ""}`;
  return p.pdf === "ok" ? `${p.number} · ${p.supplierName} · ${pdf} · ${send}` : `${p.number} · ${p.supplierName} · ${pdf}`;
}

/** Výsledek předání (místo oznámení): objednávky, PDF, odeslání, upozornění — a [Hotovo]. */
export function HandoffResultView({
  jobId, kind, result, canSend, senderEmail, target, onClose,
}: {
  jobId: string;
  kind: HandoffKind;
  result: HandoffResult;
  canSend: boolean;
  senderEmail: string | null;
  target?: JobStage | null;
  onClose: () => void;
}) {
  const [rows, setRows] = React.useState(result.purchaseOrders);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  async function retry() {
    setBusy("retry");
    setError(null);
    try {
      const r = await ensureHandoffDocuments(jobId, result.handoffId);
      if (!r.ok) setError(r.error ?? "PDF se nepodařilo vytvořit.");
      else if (r.purchaseOrders) setRows((list) => list.map((x) => r.purchaseOrders!.find((y) => y.id === x.id) ?? x));
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  async function send(p: PoRow) {
    setBusy(p.id);
    setError(null);
    try {
      const r = await sendStepPurchaseOrder(p.id);
      if (!r.ok) setError(r.error ?? "Objednávku se nepodařilo odeslat.");
      else setRows((list) => list.map((x) => (x.id === p.id ? { ...x, send: "odeslano", sendError: undefined } : x)));
    } catch {
      setError("Spojení se nepovedlo — zkus to znovu.");
    } finally {
      setBusy(null);
    }
  }

  const warnings = result.issues.filter((x) => x.level === "warning");
  return (
    <div className="space-y-4 p-4 sm:p-5" data-testid="handoff-result">
      <div className="flex items-center gap-3">
        <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300">
          <CheckCircle2 className="h-6 w-6" />
        </span>
        <div>
          <p className="text-lg font-semibold">{doneToast(kind, target)}</p>
          {result.replayed && <p className="text-xs text-muted-foreground">Už jednou uloženo — nic se nezopakovalo.</p>}
        </div>
      </div>

      {rows.length > 0 && (
        <ul className="space-y-2" aria-label="Objednávky dodavatelům">
          {rows.map((p) => (
            <li key={p.id} className={cn("flex flex-wrap items-center gap-2 rounded-xl border px-3 py-2.5 text-sm", p.pdf === "chyba" && "border-amber-300 bg-amber-50 dark:border-amber-500/40 dark:bg-amber-500/10")}>
              {/* na mobilu text přes celou šířku, tlačítka pod ním */}
              <span className="flex min-w-0 basis-full items-start gap-2 sm:basis-0 sm:flex-1">
                <FileText className="mt-0.5 h-4 w-4 shrink-0 text-lime-600" />
                <span className="min-w-0 font-medium">{resultLine(p, senderEmail)}</span>
              </span>
              <span className="flex flex-wrap gap-1.5">
                {p.pdf === "ok" && p.fileId && canSend && (
                  <a href={`/api/jobs/files/${p.fileId}`} target="_blank" rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1 rounded-md border px-3 text-xs font-semibold hover:bg-accent">
                    <ExternalLink className="h-3.5 w-3.5" /> Otevřít PDF
                  </a>
                )}
                {p.pdf === "chyba" && (
                  <Button type="button" size="sm" variant="outline" onClick={() => void retry()} disabled={busy !== null}>
                    {busy === "retry" ? <Loader2 className="animate-spin" /> : <RefreshCw />} Zkusit znovu
                  </Button>
                )}
                {p.pdf === "ok" && p.send !== "odeslano" && (canSend ? (
                  <Button type="button" size="sm" variant="send" onClick={() => void send(p)} disabled={busy !== null}>
                    {busy === p.id ? <Loader2 className="animate-spin" /> : <Send />} Odeslat dodavateli
                  </Button>
                ) : (
                  <span className="inline-flex h-8 items-center rounded-md bg-muted px-2.5 text-xs text-muted-foreground">Odešle obchodník nebo admin</span>
                ))}
              </span>
            </li>
          ))}
        </ul>
      )}

      {result.stornos && result.stornos.length > 0 && (
        <ul className="space-y-1 text-sm">
          {result.stornos.map((s) => (
            <li key={s.id} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
              Storno objednávky {s.number}: {s.send === "odeslano" ? "odesláno dodavateli" : `čeká ve frontě${s.sendError ? ` (${s.sendError})` : ""}`}
            </li>
          ))}
        </ul>
      )}

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 dark:bg-amber-500/10 dark:text-amber-200">
          {warnings.map((w, i) => <li key={`${w.code}-${i}`}>{w.message}</li>)}
        </ul>
      )}

      {error && <p role="alert" className="text-sm text-red-600 dark:text-red-400">{error}</p>}

      <div className="flex justify-end">
        <Button type="button" variant="success" className="h-11 min-w-32 sm:h-10" onClick={onClose}>Hotovo</Button>
      </div>
    </div>
  );
}
