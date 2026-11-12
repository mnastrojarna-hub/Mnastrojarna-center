"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { nudgeAnonymize } from "@/lib/anonymize/nudge-client";
import { isFileViewerOpen } from "@/components/file-viewer/viewer-bus";

/**
 * Neviditelný pomocník stránek se seznamem výkresů (Poptávky, Archiv výkresů): čekají-li výkresy na
 * anonymizaci, šťouchne do fronty (zpracuje route na serveru — bez plánovače i bez CRON_SECRET) a po
 * chvíli obnoví stránku, nejvýš ~12× (≈ 5 min; odložený pokus po přechodné chybě má odklad 5 min — majitel
 * 5. 11.: otevřená stránka ho má spustit sama). Nic nevykresluje.
 */
export function AnonQueueNudge({ table = "job_files", ids, intervalMs = 25_000, rounds = 13 }: {
  table?: "job_files" | "drawings";
  ids: string[];
  intervalMs?: number;
  rounds?: number;
}) {
  const router = useRouter();
  const key = ids.slice(0, 200).join(",");
  React.useEffect(() => {
    if (!key) return;
    const list = key.split(",");
    let n = 0;
    let cancelled = false;
    void nudgeAnonymize({ table, fileIds: list });
    const t = window.setInterval(() => {
      if (cancelled) return;
      // otevřený prohlížeč dokumentu: neobnovovat (tvrdé načtení stránky by ho zavřelo) — další kolo to dožene
      if (isFileViewerOpen()) return;
      n += 1;
      router.refresh();
      if (n >= rounds) window.clearInterval(t);
      else void nudgeAnonymize({ table, fileIds: list });
    }, intervalMs);
    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [key, table, intervalMs, rounds, router]);
  return null;
}
