"use client";

import * as React from "react";
import { AlertTriangle, RefreshCw, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { isChunkLoadError, reloadForStaleChunks } from "@/components/layout/chunk-reload";

/**
 * Chyba při vykreslení stránky uvnitř aplikace: místo prázdné plochy česká hláška s důvodem a dvěma
 * tlačítky. Zastaralé soubory po nasazení (chunk) → stránka se obnoví sama (jednou).
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  const stale = isChunkLoadError(error);
  React.useEffect(() => {
    if (stale) reloadForStaleChunks();
  }, [stale]);
  return (
    <div className="mx-auto mt-10 max-w-xl rounded-2xl border border-amber-200 bg-amber-50 p-6 text-amber-950 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-100" role="alert" data-testid="app-error">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-6 w-6 shrink-0 text-amber-600" aria-hidden />
        <div className="min-w-0 flex-1">
          <h2 className="text-lg font-semibold">{stale ? "Aplikace má novou verzi" : "Tuhle stránku se nepodařilo zobrazit"}</h2>
          <p className="mt-1 text-sm">
            {stale
              ? "Stránka ukazuje na starší soubory. Obnovuji ji — kdyby se neobnovila sama, stiskni tlačítko níže."
              : "Něco se při vykreslení pokazilo. Zkus to znovu; když to nepomůže, obnov stránku (Ctrl+F5)."}
          </p>
          <p className="mt-2 break-words font-mono text-xs opacity-80">{error.message}{error.digest ? ` · ${error.digest}` : ""}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button size="sm" onClick={() => reset()}><RotateCcw className="h-4 w-4" /> Zkusit znovu</Button>
            <Button size="sm" variant="outline" onClick={() => window.location.reload()}><RefreshCw className="h-4 w-4" /> Obnovit stránku</Button>
          </div>
        </div>
      </div>
    </div>
  );
}
