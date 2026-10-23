"use client";

import * as React from "react";
import Link from "next/link";
import {
  AlertTriangle, ArrowRight, Building2, Camera, CheckCircle2, ExternalLink, Loader2, Paperclip, PencilLine, RotateCcw,
  Sparkles, XCircle, Zap,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { StageBadge } from "@/components/jobs/stage-badge";
import { TONES, TypeChip } from "@/components/jobs/capture/capture-parts";
import { BATCH_TYPES, batchResultHeadline } from "@/lib/jobs/capture-batch";
import type { BatchResult } from "@/lib/jobs/capture-batch-types";
import { cn } from "@/lib/utils";

/**
 * Krok Hotovo dávky: nadpis, řádek per doklad s odkazy (Dokumenty, Nákup, zakázka),
 * u částečného uložení „Upravit a zkusit znovu" / „Zkusit znovu" / „Uložit jen jako soubor".
 */
export function CaptureBatchDone({
  result,
  onJobPage,
  busy,
  onEditRetry,
  onRetry,
  onFileOnly,
  onAnother,
  onClose,
  onLink,
}: {
  result: BatchResult;
  /** Dialog je otevřený v kartě této zakázky. */
  onJobPage: (jobId: string) => boolean;
  busy: boolean;
  onEditRetry: () => void;
  onRetry: () => void;
  /** U obchodního dokladu, který se neuložil: uložit ho jen jako soubor. */
  onFileOnly: (docId: string) => void;
  onAnother: () => void;
  onClose: () => void;
  /** Klik na odkaz (zakázka, Dokumenty, Nákup) — dialog se zavře, navigace pokračuje. */
  onLink: () => void;
}) {
  const partial = result.status === "partial" || result.pending.length > 0;
  const groups = result.groups.filter((g) => g.ok && g.jobId);
  const single = groups.length === 1 ? groups[0] : null;
  const shownDocs = result.docs.filter((d) => d.skipped !== "excluded");
  const excluded = result.docs.length - shownDocs.length;

  return (
    <div className="mx-auto flex min-h-full max-w-2xl flex-col items-center py-6 text-center">
      <span className={cn(
        "relative flex h-20 w-20 items-center justify-center rounded-full shadow-inner",
        partial ? "bg-amber-100 text-amber-600 dark:bg-amber-500/15 dark:text-amber-300" : "bg-emerald-100 text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-300",
      )}>
        {partial ? <AlertTriangle className="h-10 w-10" /> : <CheckCircle2 className="h-11 w-11" />}
        {result.aiUsed && (
          <span className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-fuchsia-500 text-white shadow">
            <Sparkles className="h-4 w-4" />
          </span>
        )}
      </span>
      <h3 className="mt-4 text-lg font-semibold" data-testid="capture-result-headline">{batchResultHeadline(result)}</h3>
      {partial && (
        <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
          {result.pending.length === 1 ? "1 doklad se neuložil" : `${result.pending.length} ${result.pending.length < 5 ? "doklady se neuložily" : "dokladů se neuložilo"}`} — oprav a zkus to znovu, nic se neztratí.
        </p>
      )}
      {result.autoApplied && (
        <p className={cn("mt-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium", TONES.fuchsia)}>
          <Zap className="h-3.5 w-3.5" /> Uloženo automaticky (plná automatika) — když něco nesedí, uprav to v zakázce.
        </p>
      )}

      {groups.map((g) => (
        <div key={g.key} className="mt-3 flex flex-wrap items-center justify-center gap-2 text-sm">
          {groups.length > 1 && <span className="font-mono font-semibold">{g.jobNumber}</span>}
          {g.stageFrom && g.stageTo && g.stageFrom !== g.stageTo ? (
            <>
              <StageBadge stage={g.stageFrom} />
              <ArrowRight className="h-4 w-4 text-muted-foreground" />
              <StageBadge stage={g.stageTo} size="md" />
            </>
          ) : g.stageTo || g.stageFrom ? <StageBadge stage={(g.stageTo ?? g.stageFrom)!} size="md" /> : null}
          {g.customerCreated && g.customerName && (
            <span className="flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
              <Building2 className="h-4 w-4" /> nový zákazník <strong>{g.customerName}</strong>
            </span>
          )}
        </div>
      ))}

      <ul className="mt-4 w-full space-y-1.5 text-left">
        {shownDocs.map((d) => {
          const canFileOnly = !d.ok && BATCH_TYPES[d.type].form === "business";
          return (
          <li
            key={d.docId}
            data-testid="capture-batch-result-doc"
            data-type={d.type}
            data-ok={d.ok ? "true" : "false"}
            className={cn(
              "rounded-xl border bg-card p-2.5",
              !d.ok && "border-red-200 bg-red-50/60 dark:border-red-500/30 dark:bg-red-500/10",
            )}
          >
            <div className="flex flex-wrap items-center gap-2">
              <TypeChip docType={d.type} label={d.title || d.label} className="min-w-0 max-w-full" />
              <span className={cn("ml-auto flex items-center gap-1 text-xs font-medium", d.ok ? "text-emerald-700 dark:text-emerald-400" : "text-red-700 dark:text-red-400")}>
                {d.ok ? <CheckCircle2 className="h-3.5 w-3.5" /> : <XCircle className="h-3.5 w-3.5" />}
                {d.ok ? (d.skipped === "duplicate" ? "už uložené" : d.purchasingPending ? "čeká na Nákup" : "uloženo") : "neuloženo"}
              </span>
            </div>
            {d.error && <p className="mt-1 text-xs text-red-700 dark:text-red-300">{d.error}</p>}
            {d.summary && <p className="mt-1 text-xs text-muted-foreground">{d.summary}</p>}
            {(d.links.length > 0 || canFileOnly) && (
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
                {d.links.map((l) => (
                  <Link key={l.href + l.label} href={l.href} onClick={onLink} className="inline-flex min-h-9 items-center gap-1 rounded-full bg-sky-50 px-3 font-medium text-sky-800 hover:underline dark:bg-sky-500/10 dark:text-sky-300">
                    <Paperclip className="h-3 w-3" /> {l.label}
                  </Link>
                ))}
                {canFileOnly && (
                  <button type="button" onClick={() => onFileOnly(d.docId)} disabled={busy} className="inline-flex min-h-9 items-center gap-1 rounded-full border px-3 font-medium text-foreground underline-offset-2 hover:underline disabled:opacity-50">
                    <Paperclip className="h-3 w-3" /> Uložit jen jako soubor
                  </button>
                )}
              </div>
            )}
          </li>
          );
        })}
      </ul>
      {excluded > 0 && <p className="mt-2 text-xs text-muted-foreground">Vyřazeno {excluded} — stránky se smazaly.</p>}

      {result.warnings.length > 0 && (
        <ul className="mt-3 w-full space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-left text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          {result.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /> {w}</li>
          ))}
        </ul>
      )}

      <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:flex-wrap sm:justify-center">
        {partial && (
          <>
            <Button type="button" size="lg" onClick={onEditRetry} disabled={busy} className="sm:min-w-44">
              <PencilLine /> Upravit a zkusit znovu
            </Button>
            <Button type="button" size="lg" variant="outline" onClick={onRetry} disabled={busy} className="sm:min-w-44">
              {busy ? <Loader2 className="animate-spin" /> : <RotateCcw />} Zkusit znovu
            </Button>
          </>
        )}
        {single?.jobId && !onJobPage(single.jobId) && (
          <Button asChild size="lg" variant={partial ? "outline" : "default"} className="sm:min-w-44">
            <Link href={`/orders/${single.jobId}`} onClick={onLink}>
              <ExternalLink /> {result.autoApplied ? "Upravit v zakázce" : "Otevřít zakázku"}
            </Link>
          </Button>
        )}
        {!partial && (
          <Button type="button" size="lg" onClick={onAnother} className="bg-rose-600 text-white hover:bg-rose-700 sm:min-w-44">
            <Camera /> Vyfotit další doklad
          </Button>
        )}
        <Button type="button" size="lg" variant="ghost" onClick={onClose} disabled={busy}>
          {single?.jobId && onJobPage(single.jobId) ? "Hotovo" : "Zavřít"}
        </Button>
      </div>
    </div>
  );
}
