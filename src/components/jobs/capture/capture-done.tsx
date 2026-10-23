"use client";

import * as React from "react";
import Link from "next/link";
import { AlertTriangle, ArrowRight, Building2, Camera, CheckCircle2, ExternalLink, ListChecks, Paperclip, PenLine, Sparkles, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StageBadge } from "@/components/jobs/stage-badge";
import { TONES } from "@/components/jobs/capture/capture-parts";
import { resultHeadline } from "@/lib/jobs/capture-review";
import type { CaptureResult } from "@/lib/jobs/capture-types";
import { cn } from "@/lib/utils";

/** Krok 4 — hotovo: kam se doklad uložil, co se doplnilo, co dál. */
export function CaptureDone({
  result,
  onJobPage,
  onAnother,
  onClose,
}: {
  result: CaptureResult;
  /** Dialog je otevřený přímo v kartě této zakázky (odkaz „Otevřít" netřeba). */
  onJobPage: boolean;
  onAnother: () => void;
  onClose: () => void;
}) {
  const href = result.jobId ? `/orders/${result.jobId}` : "/orders";
  const items = (result.itemsAdded ?? 0) + (result.itemsMerged ?? 0);
  return (
    <div className="mx-auto flex min-h-full max-w-xl flex-col items-center justify-center py-6 text-center">
      <span className="relative flex h-20 w-20 items-center justify-center rounded-full bg-emerald-100 text-emerald-600 shadow-inner dark:bg-emerald-500/15 dark:text-emerald-300">
        <CheckCircle2 className="h-11 w-11" />
        {result.aiUsed && (
          <span className="absolute -right-1 -top-1 flex h-7 w-7 items-center justify-center rounded-full bg-fuchsia-500 text-white shadow">
            <Sparkles className="h-4 w-4" />
          </span>
        )}
      </span>
      <h3 className="mt-4 text-lg font-semibold" data-testid="capture-result-headline">{resultHeadline(result)}</h3>

      {result.autoApplied && (
        <p className={cn("mt-3 flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium", TONES.fuchsia)}>
          <Zap className="h-3.5 w-3.5" /> Uloženo automaticky (plná automatika) — když něco nesedí, uprav to v zakázce.
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
        {result.stageFrom && result.stageTo && result.stageFrom !== result.stageTo ? (
          <>
            <StageBadge stage={result.stageFrom} />
            <ArrowRight className="h-4 w-4 text-muted-foreground" />
            <StageBadge stage={result.stageTo} size="md" />
          </>
        ) : result.stageTo || result.stageFrom ? (
          <StageBadge stage={(result.stageTo ?? result.stageFrom)!} size="md" />
        ) : null}
      </div>
      {(result.fileIds?.length ?? 0) > 0 && (
        <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
          <Paperclip className="h-3.5 w-3.5" />
          {result.fileIds!.length === 1 ? "Doklad přiložen" : `${result.fileIds!.length} stránky dokladu přiloženy`} k zakázce v Dokumentech
        </p>
      )}

      {result.customerCreated && result.customerName && (
        <p className="mt-3 flex items-center gap-1.5 text-sm text-emerald-700 dark:text-emerald-400">
          <Building2 className="h-4 w-4" /> Založen nový zákazník <strong>{result.customerName}</strong>
        </p>
      )}

      {(result.filled.length > 0 || items > 0) && (
        <div className="mt-4 w-full rounded-2xl border bg-card p-3 text-left">
          <p className="mb-2 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground">
            {result.aiUsed ? <Sparkles className="h-3.5 w-3.5 text-fuchsia-500" /> : <PenLine className="h-3.5 w-3.5 text-sky-500" />}
            {result.aiUsed ? "Doplněno z dokladu" : "Doplněno"}
          </p>
          <ul className="flex flex-wrap gap-1.5">
            {result.filled.map((f) => (
              <li key={f} className={cn("rounded-full px-2 py-0.5 text-xs", result.aiUsed ? TONES.fuchsia : TONES.sky)}>{f}</li>
            ))}
            {(result.itemsAdded ?? 0) > 0 && (
              <li className={cn("rounded-full px-2 py-0.5 text-xs", TONES.teal)}>+ {result.itemsAdded} {result.itemsAdded === 1 ? "položka" : (result.itemsAdded ?? 0) < 5 ? "položky" : "položek"}</li>
            )}
            {(result.itemsMerged ?? 0) > 0 && (
              <li className={cn("rounded-full px-2 py-0.5 text-xs", TONES.teal)}>doplněno u {result.itemsMerged} {result.itemsMerged === 1 ? "položky" : "položek"}</li>
            )}
          </ul>
        </div>
      )}

      {result.flowNotes?.length ? (
        <ul aria-label="Stav dokladů" className="mt-3 w-full space-y-1 rounded-xl border border-indigo-200 bg-indigo-50 p-2.5 text-left text-xs text-indigo-900 dark:border-indigo-500/30 dark:bg-indigo-500/10 dark:text-indigo-100">
          {result.flowNotes.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <ListChecks className="mt-0.5 h-3.5 w-3.5 shrink-0 text-indigo-500" aria-hidden /> {w}
            </li>
          ))}
        </ul>
      ) : null}

      {result.warnings?.length ? (
        <ul className="mt-3 w-full space-y-1 rounded-xl border border-amber-200 bg-amber-50 p-2.5 text-left text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100">
          {result.warnings.map((w, i) => (
            <li key={i} className="flex items-start gap-1.5">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500" /> {w}
            </li>
          ))}
        </ul>
      ) : null}

      <div className="mt-6 flex w-full flex-col gap-2 sm:flex-row sm:justify-center">
        {!onJobPage && (
          <Button asChild size="lg" className="sm:min-w-44">
            <Link href={href} onClick={onClose}>
              <ExternalLink /> {result.autoApplied ? "Upravit v zakázce" : "Otevřít zakázku"}
            </Link>
          </Button>
        )}
        <Button type="button" size="lg" onClick={onAnother} className="bg-rose-600 text-white hover:bg-rose-700 sm:min-w-44">
          <Camera /> Vyfotit další doklad
        </Button>
        <Button type="button" size="lg" variant="ghost" onClick={onClose}>
          {onJobPage ? "Hotovo" : "Zavřít"}
        </Button>
      </div>
    </div>
  );
}
